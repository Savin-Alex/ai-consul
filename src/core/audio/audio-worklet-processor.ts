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

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    
    // Determine if downsampling is needed
    this.sourceSampleRate = sampleRate;
    this.needsDownsampling = this.sourceSampleRate !== this.targetSampleRate;
    
    // Calculate chunk size based on target sample rate
    this.chunkSize = Math.floor(this.targetSampleRate * 0.1); // 100ms chunks
    
    if (this.needsDownsampling) {
      const ratio = this.sourceSampleRate / this.targetSampleRate;
      this.downsamplingBuffer = new Float32Array(Math.ceil(ratio * this.chunkSize));
      this.downsamplingBufferIndex = 0;
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
      // Accumulate samples for downsampling
      const remainingSpace = this.downsamplingBuffer!.length - this.downsamplingBufferIndex;
      const samplesToCopy = Math.min(inputChannel.length, remainingSpace);
      
      this.downsamplingBuffer!.set(
        inputChannel.subarray(0, samplesToCopy),
        this.downsamplingBufferIndex
      );
      this.downsamplingBufferIndex += samplesToCopy;

      // When buffer is full, downsample and process
      if (this.downsamplingBufferIndex >= this.downsamplingBuffer!.length) {
        processedAudio = this.downsample(
          this.downsamplingBuffer!,
          this.sourceSampleRate,
          this.targetSampleRate
        );
        
        // Reset buffer and handle any remaining samples
        this.downsamplingBufferIndex = 0;
        if (samplesToCopy < inputChannel.length) {
          const remaining = inputChannel.subarray(samplesToCopy);
          const remainingSpace = this.downsamplingBuffer!.length - this.downsamplingBufferIndex;
          const toCopy = Math.min(remaining.length, remainingSpace);
          this.downsamplingBuffer!.set(remaining.subarray(0, toCopy), 0);
          this.downsamplingBufferIndex = toCopy;
        }
      } else {
        return true; // Not enough samples yet
      }
    } else {
      processedAudio = inputChannel;
    }

    // Add to ring buffer
    this.ringBuffer.push(processedAudio);
    this.samplesCollected += processedAudio.length;

    // Send chunk when we have enough samples (100ms at target rate)
    if (this.samplesCollected >= this.chunkSize) {
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
    }

    return true; // Keep processor alive
  }
}

// Register the processor
registerProcessor('streaming-audio-processor', StreamingAudioProcessor);

