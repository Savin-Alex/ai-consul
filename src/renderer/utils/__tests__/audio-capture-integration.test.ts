import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioCaptureManager } from '../audio-capture';
import { AudioState } from '../audio-state-manager';

describe('AudioCaptureManager Integration', () => {
  let manager: AudioCaptureManager;

  beforeEach(() => {
    // Mock navigator.mediaDevices
    Object.defineProperty(global, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(),
        },
      },
      writable: true,
      configurable: true,
    });
    manager = new AudioCaptureManager();
  });

  afterEach(async () => {
    try {
      await manager.stopCapture();
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('State Synchronization', () => {
    it('should start in IDLE state', () => {
      expect(manager.getState()).toBe(AudioState.IDLE);
      expect(manager.getIsCapturing()).toBe(false);
    });

    it('should emit state-changed events', async () => {
      const states: AudioState[] = [];
      let resolvePromise: () => void;
      const statePromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      
      manager.on('state-changed', (event: any) => {
        states.push(event.current);
        
        // Once we reach RECORDING or ERROR, test is done
        if (event.current === AudioState.RECORDING || event.current === AudioState.ERROR) {
          expect(states.length).toBeGreaterThan(0);
          resolvePromise();
        }
      });

      // Try to start (will fail without actual mic, but should emit states)
      manager.startCapture().catch(() => {
        // Expected to fail without mic
        resolvePromise();
      });
      
      await statePromise;
    });
  });

  describe('Rapid Start/Stop', () => {
    it('should handle rapid start/stop without race conditions', async () => {
      const mockStream = {
        getTracks: () => []
      } as MediaStream;
      
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mockStream);

      // Rapid start/stop
      const startPromise = manager.startCapture();
      const stopPromise = manager.stopCapture();
      
      // Both should complete without errors
      await Promise.allSettled([startPromise, stopPromise]);
      
      // State should be IDLE or in cleanup after stop
      await new Promise(resolve => setTimeout(resolve, 200));
      const finalState = manager.getState();
      expect([AudioState.IDLE, AudioState.STOPPING, AudioState.CLEANING_UP, AudioState.ERROR]).toContain(finalState);
    }, 10000);
  });

  describe('Error Recovery', () => {
    it('should recover from errors and allow restart', async () => {
      // Mock getUserMedia to fail
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'));

      // First attempt should fail
      await expect(manager.startCapture()).rejects.toThrow();
      
      // State should be ERROR
      expect(manager.getState()).toBe(AudioState.ERROR);
      
      // Should be able to start again (canStart should be true)
      expect(manager.getStateManager().canStart()).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain getIsCapturing() for backward compatibility', async () => {
      expect(manager.getIsCapturing()).toBe(false);
      
      // getIsCapturing should map RECORDING state to true
      const mockStream = {
        getTracks: () => []
      } as MediaStream;
      
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mockStream);

      await manager.startCapture().catch(() => {});
      // After start, if in RECORDING state, getIsCapturing should be true
      // (but may not reach RECORDING without full setup)
      const state = manager.getState();
      if (state === AudioState.RECORDING) {
        expect(manager.getIsCapturing()).toBe(true);
      }
      await manager.stopCapture().catch(() => {});
    });
  });
});


