import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dependencyLoader } from './dynamic-loader';

let cachedPipeline: any | null = null;
let cachedEnv: any | null = null;
let envConfigured = false;

function configureTransformersEnv(): void {
  if (!cachedEnv || envConfigured) {
    return;
  }

  cachedEnv.allowRemoteModels = true;
  cachedEnv.allowLocalModels = true;
  cachedEnv.useBrowserCache = false;

  const cacheDir =
    process.env.TRANSFORMERS_CACHE ??
    process.env.HF_HOME ??
    path.join(os.homedir(), '.cache', 'ai-consul', 'transformers');

  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (error) {
    console.warn('[transformers] Failed to create cache directory:', error);
  }

  cachedEnv.cacheDir = cacheDir;
  cachedEnv.localModelPath = cacheDir;

  const token =
    process.env.HF_TOKEN ??
    process.env.HF_ACCESS_TOKEN ??
    process.env.HF_API_TOKEN ??
    process.env.HUGGINGFACE_TOKEN ??
    process.env.HUGGINGFACEHUB_API_TOKEN ??
    process.env.HUGGING_FACE_HUB_TOKEN;

  if (token) {
    process.env.HF_TOKEN ||= token;
    process.env.HF_ACCESS_TOKEN ||= token;
  }

  envConfigured = true;
}

export async function loadTransformers(): Promise<{ pipeline: any; env: any }> {
  if (!cachedPipeline || !cachedEnv) {
    const transformers = await dependencyLoader.load<typeof import('@xenova/transformers')>('@xenova/transformers');
    cachedPipeline = transformers.pipeline;
    cachedEnv = transformers.env;
    configureTransformersEnv();
  }
  return { pipeline: cachedPipeline, env: cachedEnv };
}


