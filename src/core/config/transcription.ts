export type TranscriptionMode =
  | 'local-only'
  | 'local-first'
  | 'balanced'
  | 'cloud-first'
  | 'cloud-only';

export type VADProviderType = 'default' | 'silero';

export interface TranscriptionPriorityConfig {
  mode: TranscriptionMode;
  localTimeoutMs: number;
  cloudTimeoutMs: number;
  costLimitUsd: number;
  privacyMode: boolean;
  allowCloud: boolean;
  allowLocal: boolean;
  failoverOrder: Array<'local-whisper' | 'local-onnx' | 'whisper-native' | 'cloud-assembly' | 'cloud-deepgram'>;
  vadProvider?: VADProviderType;
}

const MODE_FAILOVER_MAP: Record<TranscriptionMode, Array<TranscriptionPriorityConfig['failoverOrder'][number]>> = {
  'local-only': ['whisper-native', 'local-whisper', 'local-onnx'],
  'local-first': ['whisper-native', 'local-whisper', 'local-onnx', 'cloud-assembly', 'cloud-deepgram'],
  balanced: ['whisper-native', 'local-whisper', 'cloud-assembly', 'local-onnx', 'cloud-deepgram'],
  'cloud-first': ['cloud-assembly', 'cloud-deepgram', 'whisper-native', 'local-whisper', 'local-onnx'],
  'cloud-only': ['cloud-assembly', 'cloud-deepgram'],
};

const DEFAULTS: TranscriptionPriorityConfig = {
  mode: 'local-first',
  localTimeoutMs: 2000,
  cloudTimeoutMs: 750,
  costLimitUsd: 15,
  privacyMode: false,
  allowCloud: true,
  allowLocal: true,
  failoverOrder: MODE_FAILOVER_MAP['local-first'],
  vadProvider: 'silero',
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value === 'undefined') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeMode(rawMode?: string): TranscriptionMode {
  if (!rawMode) {
    return DEFAULTS.mode;
  }
  const normalized = rawMode.toLowerCase() as TranscriptionMode;
  if (Object.keys(MODE_FAILOVER_MAP).includes(normalized)) {
    return normalized;
  }
  return DEFAULTS.mode;
}

function normalizeVADProvider(rawProvider?: string): VADProviderType {
  if (!rawProvider) {
    return DEFAULTS.vadProvider || 'silero';
  }
  const normalized = rawProvider.toLowerCase() as VADProviderType;
  if (normalized === 'silero' || normalized === 'default') {
    return normalized;
  }
  return DEFAULTS.vadProvider || 'silero';
}

export function resolveTranscriptionConfig(
  overrides: Partial<TranscriptionPriorityConfig> = {},
): TranscriptionPriorityConfig {
  const envMode = normalizeMode(process.env.TRANSCRIPTION_MODE);
  const mode = overrides.mode ?? envMode;

  const privacyMode = overrides.privacyMode ?? parseBoolean(process.env.TRANSCRIPTION_PRIVACY_MODE, DEFAULTS.privacyMode);

  const allowCloudEnv = parseBoolean(process.env.TRANSCRIPTION_ALLOW_CLOUD, DEFAULTS.allowCloud);
  const allowCloud = overrides.allowCloud ?? (privacyMode ? false : allowCloudEnv);

  const allowLocalEnv = parseBoolean(process.env.TRANSCRIPTION_ALLOW_LOCAL, DEFAULTS.allowLocal);
  const allowLocal = overrides.allowLocal ?? allowLocalEnv;

  const vadProvider = overrides.vadProvider ?? normalizeVADProvider(process.env.VAD_PROVIDER);

  const config: TranscriptionPriorityConfig = {
    mode,
    localTimeoutMs: overrides.localTimeoutMs ?? parseNumber(process.env.TRANSCRIPTION_LOCAL_TIMEOUT_MS, DEFAULTS.localTimeoutMs),
    cloudTimeoutMs: overrides.cloudTimeoutMs ?? parseNumber(process.env.TRANSCRIPTION_CLOUD_TIMEOUT_MS, DEFAULTS.cloudTimeoutMs),
    costLimitUsd: overrides.costLimitUsd ?? parseNumber(process.env.TRANSCRIPTION_COST_LIMIT, DEFAULTS.costLimitUsd),
    privacyMode,
    allowCloud,
    allowLocal,
    failoverOrder: overrides.failoverOrder ?? MODE_FAILOVER_MAP[mode],
    vadProvider,
  };

  if (config.mode === 'local-only' || privacyMode) {
    config.allowCloud = false;
    config.failoverOrder = MODE_FAILOVER_MAP['local-only'];
  }

  if (config.mode === 'cloud-only') {
    config.allowLocal = false;
    config.failoverOrder = MODE_FAILOVER_MAP['cloud-only'];
  }

  return config;
}

