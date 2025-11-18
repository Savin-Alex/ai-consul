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
  private chunkSize: number = 1600; // 100ms at 16kHz
  private samplesCollected: number = 0;
  private sourceSampleRate: number = sampleRate;
  private needsDownsampling: boolean = false;
  private downsamplingBuffer: Float32Array | null = null;
  private downsamplingBufferIndex: number = 0;
  private flushRequested: boolean = false;

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
   * Downsample audio from source rate to target rate using linear interpolation
   */
  private downsample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
    if (sourceRate === targetRate) {
      return input;
    }

    const ratio = sourceRate / targetRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i * ratio;
      const indexFloor = Math.floor(sourceIndex);
      const indexCeil = Math.min(indexFloor + 1, input.length - 1);
      const weight = sourceIndex - indexFloor;

      output[i] = input[indexFloor] + (input[indexCeil] - input[indexFloor]) * weight;
    }

    return output;
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    // Check for flush request (checked each process call)
    if (this.flushRequested) {
      this.flush();
      this.flushRequested = false;
    }
    
    try {
      const input = inputs[0];
      
      if (!input || input.length === 0) {
        return true; // Keep processor alive
      }

      const inputChannel = input[0];
      if (!inputChannel || inputChannel.length === 0) {
        return true;
      }

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
   */
  private emitChunk(): void {
    try {
      if (this.samplesCollected === 0 || this.ringBuffer.length === 0) {
        return; // Nothing to emit
      }
      
      // Combine buffered samples
      const chunk = new Float32Array(this.samplesCollected);
      let offset = 0;
      for (const buffer of this.ringBuffer) {
        chunk.set(buffer, offset);
        offset += buffer.length;
      }

      // Send to main thread
      // Note: Float32Array must be converted to array for message passing
      this.port.postMessage({
        type: 'audio-chunk',
        data: Array.from(chunk), // Convert to array for cross-thread message passing
        timestamp: currentTime,
        sampleRate: this.targetSampleRate,
      });

      // Reset buffer
      this.ringBuffer = [];
      this.samplesCollected = 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[AudioWorklet] Error emitting chunk:', error);
      
      // Notify main thread of error
      try {
        this.port.postMessage({
          type: 'error',
          message: `Emit chunk error: ${errorMessage}`,
        });
      } catch (postError) {
        console.error('[AudioWorklet] Failed to send error message:', postError);
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
   */
  flush(): void {
    try {
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
      }
      
      // Emit any remaining chunks
      if (this.samplesCollected > 0) {
        this.emitChunk();
      }
      
      // Notify main thread that flush is complete
      try {
        this.port.postMessage({ type: 'flush-complete' });
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

