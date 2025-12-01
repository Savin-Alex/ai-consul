/**
 * Circular buffer implementation for efficient memory management
 * Automatically overwrites oldest entries when capacity is reached
 */
export class CircularBuffer<T> {
  private buffer: (T | null)[];
  private head = 0;
  private tail = 0;
  private size = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
  }

  /**
   * Add an item to the buffer
   * If buffer is full, overwrites oldest item
   */
  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.size < this.capacity) {
      this.size++;
    } else {
      // Buffer is full, move head forward
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * Remove and return the oldest item
   */
  pop(): T | null {
    if (this.size === 0) {
      return null;
    }

    const item = this.buffer[this.head];
    this.buffer[this.head] = null;
    this.head = (this.head + 1) % this.capacity;
    this.size--;

    return item;
  }

  /**
   * Get all items in order (oldest to newest)
   */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.size; i++) {
      const index = (this.head + i) % this.capacity;
      const item = this.buffer[index];
      if (item !== null) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Get items in reverse order (newest to oldest)
   */
  toArrayReversed(): T[] {
    const result: T[] = [];
    for (let i = this.size - 1; i >= 0; i--) {
      const index = (this.head + i) % this.capacity;
      const item = this.buffer[index];
      if (item !== null) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Get the number of items currently in the buffer
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Get the maximum capacity of the buffer
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this.size === this.capacity;
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Clear all items from the buffer
   */
  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  /**
   * Get the oldest item without removing it
   */
  peek(): T | null {
    if (this.size === 0) {
      return null;
    }
    return this.buffer[this.head];
  }

  /**
   * Get the newest item without removing it
   */
  peekLast(): T | null {
    if (this.size === 0) {
      return null;
    }
    const lastIndex = (this.tail - 1 + this.capacity) % this.capacity;
    return this.buffer[lastIndex];
  }
}




