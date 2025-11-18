/**
 * AudioWorklet processor for low-latency audio capture
 * 
 * IMPORTANT: This JS file exists because Electron's audioWorklet.addModule()
 * requires a .js extension and loads modules directly from the file system.
 * 
 * The source of truth is audio-worklet-processor.ts. This JS file should
 * be kept in sync with the compiled TypeScript output, or replaced with
 * a build step that automatically generates it from the TS source.
 * 
 * TODO: Configure build pipeline to auto-generate this from .ts source
 */

class StreamingAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    this.ringBuffer = [];
    this.targetSampleRate = 16000;
    this.chunkSize = 1600; // 100ms at 16kHz
    this.samplesCollected = 0;
    this.sourceSampleRate = sampleRate;
    this.needsDownsampling = this.sourceSampleRate !== this.targetSampleRate;
    this.downsamplingBuffer = null;
    this.downsamplingBufferIndex = 0;
    
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
  downsample(input, sourceRate, targetRate) {
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

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (!input || input.length === 0) {
      return true; // Keep processor alive
    }

    const inputChannel = input[0];
    if (!inputChannel || inputChannel.length === 0) {
      return true;
    }

    let processedAudio;

    if (this.needsDownsampling) {
      // Accumulate samples for downsampling
      const remainingSpace = this.downsamplingBuffer.length - this.downsamplingBufferIndex;
      const samplesToCopy = Math.min(inputChannel.length, remainingSpace);
      
      this.downsamplingBuffer.set(
        inputChannel.subarray(0, samplesToCopy),
        this.downsamplingBufferIndex
      );
      this.downsamplingBufferIndex += samplesToCopy;

      // When buffer is full, downsample and process
      if (this.downsamplingBufferIndex >= this.downsamplingBuffer.length) {
        processedAudio = this.downsample(
          this.downsamplingBuffer,
          this.sourceSampleRate,
          this.targetSampleRate
        );
        
        // Reset buffer and handle any remaining samples
        this.downsamplingBufferIndex = 0;
        if (samplesToCopy < inputChannel.length) {
          const remaining = inputChannel.subarray(samplesToCopy);
          const remainingSpace = this.downsamplingBuffer.length - this.downsamplingBufferIndex;
          const toCopy = Math.min(remaining.length, remainingSpace);
          this.downsamplingBuffer.set(remaining.subarray(0, toCopy), 0);
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
      this.port.postMessage({
        type: 'audio-chunk',
        data: Array.from(chunk), // Convert to array for message passing
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

