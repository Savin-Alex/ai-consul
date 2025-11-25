/**
 * AudioWorklet processor for low-latency audio capture
 * Processes audio in real-time with minimal latency
 * 
 * This file is loaded as a worklet module and runs in the audio rendering thread
 */

// TypeScript definitions for AudioWorkletProcessor
declare class AudioWorkletProcessor {
  port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare const sampleRate: number;
declare const currentTime: number;

class StreamingAudioProcessor extends AudioWorkletProcessor {
  private ringBuffer: Float32Array[] = [];
  private targetSampleRate: number = 16000;
  // Increased chunk size to 4KB (4096 samples = 256ms at 16kHz) for better transcription compatibility
  private chunkSize: number = 4096; // ~256ms at 16kHz (4KB of Int16 data)
  private samplesCollected: number = 0;
  private sourceSampleRate: number = sampleRate;
  private needsDownsampling: boolean = false;
  private downsamplingBuffer: Float32Array | null = null;
  private downsamplingBufferIndex: number = 0;
  private flushRequested: boolean = false;
  private isStopped: boolean = false;
  private consecutiveEmptyInputs: number = 0;
  private readonly MAX_EMPTY_INPUTS = 10; // Stop after 10 empty inputs (~23ms at 48kHz)
  private portClosed: boolean = false; // Track port state to handle closure gracefully

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    
    // Validate sample rate
    if (!sampleRate || sampleRate <= 0 || !isFinite(sampleRate)) {
      console.error('[AudioWorklet] Invalid sample rate:', sampleRate);
      this.port.postMessage({
        type: 'error',
        message: `Invalid sample rate: ${sampleRate}`,
      });
      return;
    }
    
    // Determine if downsampling is needed
    this.sourceSampleRate = sampleRate;
    this.needsDownsampling = this.sourceSampleRate !== this.targetSampleRate;
    
    // Calculate chunk size based on target sample rate (100ms chunks)
    this.chunkSize = Math.floor(this.targetSampleRate * 0.1);
    
    // Validate chunk size
    if (this.chunkSize <= 0) {
      console.error('[AudioWorklet] Invalid chunk size:', this.chunkSize);
      this.port.postMessage({
        type: 'error',
        message: `Invalid chunk size: ${this.chunkSize}`,
      });
      return;
    }
    
    if (this.needsDownsampling) {
      const ratio = this.sourceSampleRate / this.targetSampleRate;
      const bufferSize = Math.ceil(ratio * this.chunkSize);
      if (bufferSize > 0 && isFinite(bufferSize)) {
        this.downsamplingBuffer = new Float32Array(bufferSize);
        this.downsamplingBufferIndex = 0;
      } else {
        console.error('[AudioWorklet] Failed to create downsampling buffer, size:', bufferSize);
        this.needsDownsampling = false;
      }
    }

    // Notify main thread that processor is ready
    this.port.postMessage({
      type: 'processor-ready',
      sourceSampleRate: this.sourceSampleRate,
      targetSampleRate: this.targetSampleRate,
    });
  }

  /**
   * Downsample audio from source rate to target rate with anti-aliasing
   * Uses simple averaging filter to prevent aliasing artifacts
   */
  private downsample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
    if (sourceRate === targetRate) {
      return input;
    }

    const ratio = sourceRate / targetRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    
    // Anti-aliasing: average samples instead of simple interpolation
    // This prevents high frequencies from folding back into the spectrum
    const filterSize = Math.ceil(ratio);
    
    for (let i = 0; i < outputLength; i++) {
      const sourceStart = Math.floor(i * ratio);
      const sourceEnd = Math.min(sourceStart + filterSize, input.length);
      
      // Average samples in the filter window to reduce aliasing
      let sum = 0;
      let count = 0;
      for (let j = sourceStart; j < sourceEnd; j++) {
        sum += input[j];
        count++;
      }
      output[i] = count > 0 ? sum / count : 0;
    }

    return output;
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    // If stopped or port closed, don't process any more audio
    if (this.isStopped || this.portClosed) {
      return false; // Terminate processor
    }

    // Check for flush request (checked each process call)
    if (this.flushRequested) {
      this.flush();
      this.flushRequested = false;
      this.isStopped = true; // Mark as stopped after flush
      return false; // Terminate processor after flush
    }
    
    try {
      const input = inputs[0];
      
      if (!input || input.length === 0) {
        // Track consecutive empty inputs to detect disconnection
        this.consecutiveEmptyInputs++;
        if (this.consecutiveEmptyInputs >= this.MAX_EMPTY_INPUTS) {
          // Likely disconnected, flush and stop
          this.flush();
          this.isStopped = true;
          return false;
        }
        return true; // Keep processor alive for now
      }

      const inputChannel = input[0];
      if (!inputChannel || inputChannel.length === 0) {
        // Track consecutive empty inputs
        this.consecutiveEmptyInputs++;
        if (this.consecutiveEmptyInputs >= this.MAX_EMPTY_INPUTS) {
          this.flush();
          this.isStopped = true;
          return false;
        }
        return true;
      }

      // Reset empty input counter when we receive valid audio
      this.consecutiveEmptyInputs = 0;

      let processedAudio: Float32Array;

      if (this.needsDownsampling) {
        // Validate downsampling buffer exists
        if (!this.downsamplingBuffer) {
          console.error('[AudioWorklet] Downsampling buffer not initialized');
          this.port.postMessage({
            type: 'error',
            message: 'Downsampling buffer not initialized',
          });
          return true;
        }
        
        // Handle downsampling with proper buffer management
        let inputOffset = 0;
        let hasProcessedAudio = false;
        
        while (inputOffset < inputChannel.length) {
          const remainingSpace = this.downsamplingBuffer.length - this.downsamplingBufferIndex;
          
          if (remainingSpace === 0) {
            // Buffer is full, downsample and process
            processedAudio = this.downsample(
              this.downsamplingBuffer,
              this.sourceSampleRate,
              this.targetSampleRate
            );
            
            // Process the downsampled audio
            this.addToRingBuffer(processedAudio);
            hasProcessedAudio = true;
            
            // Reset buffer for next batch
            this.downsamplingBufferIndex = 0;
          } else {
            // Copy as much as we can into the buffer
            const samplesToCopy = Math.min(
              inputChannel.length - inputOffset,
              remainingSpace
            );
            
            this.downsamplingBuffer.set(
              inputChannel.subarray(inputOffset, inputOffset + samplesToCopy),
              this.downsamplingBufferIndex
            );
            this.downsamplingBufferIndex += samplesToCopy;
            inputOffset += samplesToCopy;
            
            // If buffer is now full, downsample and process
            if (this.downsamplingBufferIndex >= this.downsamplingBuffer.length) {
              processedAudio = this.downsample(
                this.downsamplingBuffer,
                this.sourceSampleRate,
                this.targetSampleRate
              );
              
              // Process the downsampled audio
              this.addToRingBuffer(processedAudio);
              hasProcessedAudio = true;
              
              // Reset buffer for next batch
              this.downsamplingBufferIndex = 0;
            }
          }
        }
        
        // If we didn't process anything (buffer not full yet), return early
        if (!hasProcessedAudio || this.ringBuffer.length === 0) {
          return true;
        }
        
        // processedAudio is guaranteed to be set if hasProcessedAudio is true
        // But we need it for the chunk emission check below
        if (!processedAudio && this.ringBuffer.length > 0) {
          processedAudio = this.ringBuffer[this.ringBuffer.length - 1];
        }
      } else {
        processedAudio = inputChannel;
        this.addToRingBuffer(processedAudio);
      }
      
      // Ensure processedAudio is defined
      if (!processedAudio) {
        return true;
      }

      // Send chunk when we have enough samples (100ms at target rate)
      if (this.samplesCollected >= this.chunkSize) {
        this.emitChunk();
      }

      return true; // Keep processor alive
    } catch (error) {
      // Log error and notify main thread
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[AudioWorklet] Error in process:', error);
      
      // Notify main thread of error
      try {
        this.port.postMessage({
          type: 'error',
          message: `Process error: ${errorMessage}`,
        });
      } catch (postError) {
        // If we can't send error message, at least log it
        console.error('[AudioWorklet] Failed to send error message:', postError);
      }
      
      return true; // Keep processor alive to prevent crashes
    }
  }

  /**
   * Add audio to ring buffer and update sample count
   * Prevents buffer overflow by limiting maximum buffer size
   */
  private addToRingBuffer(audio: Float32Array): void {
    // Maximum buffer size: 5 seconds of audio at target sample rate
    const MAX_BUFFER_SAMPLES = this.targetSampleRate * 5;
    
    // Check if adding this audio would exceed maximum
    if (this.samplesCollected + audio.length > MAX_BUFFER_SAMPLES) {
      console.warn('[AudioWorklet] Buffer overflow prevented, flushing buffer');
      // Flush existing buffer to prevent overflow
      this.emitChunk();
    }
    
    this.ringBuffer.push(audio);
    this.samplesCollected += audio.length;
  }

  /**
   * Emit accumulated chunk to main thread
   * Sends Float32Array data directly using Transferable objects to avoid GC pressure
   */
  private emitChunk(): void {
    try {
      if (this.samplesCollected === 0 || this.ringBuffer.length === 0 || this.portClosed) {
        return; // Nothing to emit or port is closed
      }
      
      // Combine buffered samples
      const chunk = new Float32Array(this.samplesCollected);
      let offset = 0;
      for (const buffer of this.ringBuffer) {
        chunk.set(buffer, offset);
        offset += buffer.length;
      }

      // CRITICAL: Check port state before sending
      try {
        // Send to main thread using Transferable to avoid GC pressure
        // Float32Array is sent directly (not converted to Int16) as VAD/transcription expect Float32
        this.port.postMessage({
          type: 'audio-chunk',
          data: chunk, // Float32Array sent directly
          timestamp: currentTime,
          sampleRate: this.targetSampleRate,
        }, [chunk.buffer] as Transferable[]); // Transfer ownership to avoid copying
      } catch (error) {
        // Port may be closed - mark as closed and stop processing
        if (error instanceof DOMException && error.name === 'InvalidStateError') {
          console.warn('[AudioWorklet] Port closed, stopping processor');
          this.portClosed = true;
          this.isStopped = true;
          // Reset buffer to prevent memory leak
          this.ringBuffer = [];
          this.samplesCollected = 0;
          return;
        }
        throw error; // Re-throw other errors
      }

      // Reset buffer
      this.ringBuffer = [];
      this.samplesCollected = 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[AudioWorklet] Error emitting chunk:', error);
      
      // CRITICAL: Mark port as closed if postMessage fails with InvalidStateError
      if (error instanceof DOMException && error.name === 'InvalidStateError') {
        this.portClosed = true;
        this.isStopped = true;
      }
      
      // Notify main thread of error (if port is still open)
      if (!this.portClosed) {
        try {
          this.port.postMessage({
            type: 'error',
            message: `Emit chunk error: ${errorMessage}`,
          });
        } catch (postError) {
          // Port closed during error notification
          if (postError instanceof DOMException && postError.name === 'InvalidStateError') {
            this.portClosed = true;
            this.isStopped = true;
          }
          console.error('[AudioWorklet] Failed to send error message:', postError);
        }
      }
      
      // Reset buffer even on error to prevent memory leak
      this.ringBuffer = [];
      this.samplesCollected = 0;
    }
  }
  
  /**
   * Request flush on next process() call
   * Note: AudioWorklet processors can't receive messages directly,
   * so we use a flag checked in process() method
   */
  requestFlush(): void {
    this.flushRequested = true;
  }
  
  /**
   * Flush any remaining buffered audio (called on stop)
   * Returns true if there was data to flush, false otherwise
   */
  flush(): void {
    try {
      let hadData = false;
      
      // Flush downsampling buffer if it has data
      if (this.needsDownsampling && this.downsamplingBuffer && this.downsamplingBufferIndex > 0) {
        const remainingSamples = this.downsamplingBuffer.subarray(0, this.downsamplingBufferIndex);
        const processedAudio = this.downsample(
          remainingSamples,
          this.sourceSampleRate,
          this.targetSampleRate
        );
        this.addToRingBuffer(processedAudio);
        this.downsamplingBufferIndex = 0;
        hadData = true;
      }
      
      // Emit any remaining chunks (even if smaller than chunkSize)
      if (this.samplesCollected > 0) {
        this.emitChunk();
        hadData = true;
      }
      
      // Notify main thread that flush is complete
      try {
        this.port.postMessage({ 
          type: 'flush-complete',
          hadData: hadData 
        });
      } catch (error) {
        // Ignore errors during flush notification
      }
    } catch (error) {
      console.error('[AudioWorklet] Error in flush:', error);
    }
  }
}

// Register the processor
registerProcessor('streaming-audio-processor', StreamingAudioProcessor);

