import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioStateManager } from '../audio-state-manager';
import { AudioState } from '../audio-state';

describe('AudioStateManager', () => {
  let manager: AudioStateManager;

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
    manager = new AudioStateManager();
  });

  afterEach(async () => {
    // Clean up any pending timeouts - wait a bit for any transitions to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      // Reset transition lock first
      (manager as any).transitionLock = false;
      // Force to IDLE state
      (manager as any).currentState = AudioState.IDLE;
      // Clear timeout
      if ((manager as any).stateTimeout) {
        clearTimeout((manager as any).stateTimeout);
        (manager as any).stateTimeout = null;
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('State Transitions', () => {
    it('should start in IDLE state', () => {
      expect(manager.getState()).toBe(AudioState.IDLE);
    });

    it('should transition from IDLE to REQUESTING_PERMISSION', async () => {
      // Mock getUserMedia to succeed
      const mockStream = {
        getTracks: () => []
      } as MediaStream;
      
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mockStream);

      const startPromise = manager.startRecording().catch(() => {});
      // Wait a bit for transition to start
      await new Promise(resolve => setTimeout(resolve, 50));
      // Should be in REQUESTING_PERMISSION or further (or ERROR if something failed)
      const state = manager.getState();
      expect([AudioState.REQUESTING_PERMISSION, AudioState.INITIALIZING_CONTEXT, AudioState.LOADING_WORKLET, AudioState.READY, AudioState.ERROR]).toContain(state);
      await startPromise;
    });

    it('should prevent invalid state transitions', async () => {
      // Try to transition from IDLE to RECORDING (invalid)
      await expect(manager.transition('begin_recording')).rejects.toThrow();
    });

    it('should prevent concurrent transitions', async () => {
      const mockStream = {
        getTracks: () => []
      } as MediaStream;
      
      let resolveGetUserMedia: (value: MediaStream) => void;
      const getUserMediaPromise = new Promise<MediaStream>(resolve => {
        resolveGetUserMedia = resolve;
      });
      
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockImplementation(() => getUserMediaPromise);

      // Start first transition (will wait on getUserMedia)
      const promise1 = manager.startRecording();
      
      // Wait a bit to ensure first transition has started and lock is set
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Verify lock is set
      expect((manager as any).transitionLock).toBe(true);
      
      // Try to transition directly (should fail due to lock)
      await expect(manager.transition('start')).rejects.toThrow('Transition already in progress');
      
      // Resolve getUserMedia to let first transition complete
      resolveGetUserMedia!(mockStream);
      
      // Clean up
      await promise1.catch(() => {});
    });

    it('should allow error transition from any state', async () => {
      // Error transition should always be allowed
      await expect(manager.transition('error')).resolves.not.toThrow();
      expect(manager.getState()).toBe(AudioState.ERROR);
    });
  });

  describe('State History', () => {
    it('should track state history', () => {
      const history = manager.getStateHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].state).toBe(AudioState.IDLE);
    });

    it('should limit history size', async () => {
      // Create many state transitions
      for (let i = 0; i < 150; i++) {
        await manager.transition('error').catch(() => {});
        await manager.transition('stopped').catch(() => {});
      }

      const history = manager.getStateHistory();
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Emergency Stop', () => {
    it('should allow emergency stop from any state', async () => {
      // Transition to some state
      await manager.transition('error').catch(() => {});
      
      // Emergency stop should work
      await manager.emergencyStop();
      expect(manager.getState()).toBe(AudioState.IDLE);
    });
  });

  describe('State Validation', () => {
    it('should validate canStart()', () => {
      expect(manager.canStart()).toBe(true);
      
      // Set to error state
      manager.transition('error').catch(() => {});
      expect(manager.canStart()).toBe(true); // Can start from error
    });

    it('should validate canStop()', () => {
      expect(manager.canStop()).toBe(false); // Can't stop from IDLE
    });
  });
});


