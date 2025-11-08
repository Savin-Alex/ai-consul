/** @vitest-environment jsdom */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import Settings from '../Settings';
import { useAppStore } from '../../../stores/app-state';

const mockDevice = (overrides: Partial<MediaDeviceInfo> = {}): MediaDeviceInfo => {
  const base: MediaDeviceInfo = {
    deviceId: 'device-1',
    kind: 'audioinput',
    label: 'Test Microphone',
    groupId: 'group-1',
    toJSON() {
      return this;
    },
  } as MediaDeviceInfo;

  return { ...base, ...overrides } as MediaDeviceInfo;
};

const setupStore = () => {
  const deviceOne = mockDevice();
  const deviceTwo = mockDevice({ deviceId: 'device-2', label: 'iPhone Microphone' });

  useAppStore.setState({
    isOnboardingComplete: true,
    audioSource: 'mic-only',
    privacyMode: 'local-first',
    performanceTier: 'auto-detected',
    ollamaConnected: false,
    ollamaModel: 'llama3:8b',
    microphones: [deviceOne, deviceTwo],
    selectedMicrophoneId: 'default',
  });
};

describe('Settings microphone controls', () => {
  const originalMediaDevices = navigator.mediaDevices;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalPlay = HTMLMediaElement.prototype.play;

  beforeEach(() => {
    vi.useRealTimers();
    setupStore();

    const mockStream = {
      getTracks: vi.fn(() => [
        {
          stop: vi.fn(),
        },
      ]),
    } as unknown as MediaStream;

    navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([mockDevice(), mockDevice({ deviceId: 'device-2', label: 'iPhone Microphone' })]),
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    } as unknown as MediaDevices;

    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    navigator.mediaDevices = originalMediaDevices;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLMediaElement.prototype.play = originalPlay;
    vi.restoreAllMocks();
  });

  it('requests permission when selecting a new microphone', async () => {
    render(<Settings />);

    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /settings/i }));

    const select = screen
      .getByText('System Default')
      .closest('select') as HTMLSelectElement;

    const iphoneOption = screen.getByRole('option', { name: /iphone microphone/i });

    await act(async () => {
      await user.selectOptions(select, iphoneOption);
    });

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: {
          deviceId: { exact: 'device-2' },
        },
      });
    });

    expect(useAppStore.getState().selectedMicrophoneId).toBe('device-2');
  });

  it('records and plays back a microphone test clip', async () => {
    const user = userEvent.setup();

    const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        queueMicrotask(() => (callback as () => void)());
      }
      return 0 as unknown as number;
    });

    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout').mockImplementation(() => {});

    class MockMediaRecorder {
      public static isTypeSupported = vi.fn().mockReturnValue(true);
      public state: 'inactive' | 'recording' = 'inactive';
      private handlers: Record<string, (event?: { data?: Blob; size?: number }) => void> = {};

      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

      addEventListener(event: string, handler: (event?: { data?: Blob; size?: number }) => void) {
        this.handlers[event] = handler;
      }

      start() {
        this.state = 'recording';
        const blob = new Blob(['sample-data'], { type: 'audio/webm' });
        this.handlers['dataavailable']?.({ data: blob, size: blob.size });
      }

      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.handlers['stop']?.();
      }

      removeEventListener() {}
    }

    vi.stubGlobal('MediaRecorder', MockMediaRecorder as unknown as typeof MediaRecorder);

    render(<Settings />);

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.click(screen.getByRole('button', { name: /test microphone/i }));

    expect(await screen.findByText(/playing back your recording/i)).toBeInTheDocument();

    const audioElement = document.querySelector('.mic-test-audio') as HTMLAudioElement;
    fireEvent.ended(audioElement);
    await act(async () => {});

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    const replayButton = await screen.findByRole('button', { name: /play again/i });
    await user.click(replayButton);

    expect(await screen.findByText(/replaying your recording/i)).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);

    timeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});

