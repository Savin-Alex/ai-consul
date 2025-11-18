/**
 * Ring buffer for efficient audio chunk buffering
 * Used by AudioWorklet for low-latency audio processing
 */

export class RingBuffer {
  private buffer: Float32Array;
  private writeIndex: number = 0;
  private readIndex: number = 0;
  private size: number;
  private available: number = 0;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Float32Array(size);
  }

  /**
   * Write data to the ring buffer
   * @param data - Audio data to write
   * @returns Number of samples actually written
   */
  write(data: Float32Array): number {
    const dataLength = data.length;
    const spaceAvailable = this.size - this.available;
    const samplesToWrite = Math.min(dataLength, spaceAvailable);

    if (samplesToWrite === 0) {
      return 0;
    }

    // Write in two parts if we wrap around
    const firstPart = Math.min(samplesToWrite, this.size - this.writeIndex);
    this.buffer.set(data.subarray(0, firstPart), this.writeIndex);

    if (samplesToWrite > firstPart) {
      const secondPart = samplesToWrite - firstPart;
      this.buffer.set(data.subarray(firstPart), 0);
    }

    this.writeIndex = (this.writeIndex + samplesToWrite) % this.size;
    this.available += samplesToWrite;

    return samplesToWrite;
  }

  /**
   * Read data from the ring buffer
   * @param length - Number of samples to read
   * @returns Float32Array with requested samples, or empty array if not enough data
   */
  read(length: number): Float32Array {
    const samplesToRead = Math.min(length, this.available);

    if (samplesToRead === 0) {
      return new Float32Array(0);
    }

    const result = new Float32Array(samplesToRead);

    // Read in two parts if we wrap around
    const firstPart = Math.min(samplesToRead, this.size - this.readIndex);
    result.set(this.buffer.subarray(this.readIndex, this.readIndex + firstPart), 0);

    if (samplesToRead > firstPart) {
      const secondPart = samplesToRead - firstPart;
      result.set(this.buffer.subarray(0, secondPart), firstPart);
    }

    this.readIndex = (this.readIndex + samplesToRead) % this.size;
    this.available -= samplesToRead;

    return result;
  }

  /**
   * Get number of samples available for reading
   */
  getAvailable(): number {
    return this.available;
  }

  /**
   * Check if buffer has enough samples for reading
   */
  hasEnough(length: number): boolean {
    return this.available >= length;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
    this.buffer.fill(0);
  }

  /**
   * Get current buffer capacity
   */
  getCapacity(): number {
    return this.size;
  }
}



