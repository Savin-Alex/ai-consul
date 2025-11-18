## Local Model Setup

This project expects the Whisper ASR and VAD weights to be present on disk so the Electron app can run fully offline. The application looks for models in `src/models/Xenova/…`. Follow the steps below whenever you need to (re)download the model bundles.

### Requirements
- Node.js environment (same version used by the repo)
- `pnpm install` completed (ensures `@xenova/transformers` is available)
- Network access to Hugging Face
- Optional: Hugging Face access token (`HF_TOKEN`) if downloading gated models

### Download Script
Run the following script from the project root to pull the models into the shared cache (`~/.cache/ai-consul/transformers`). It downloads:
- `Xenova/whisper-small` – non-quantized (two ONNX models)
- `Xenova/ast-finetuned-speech-commands-v2` – quantized VAD model

```bash
cd /Users/alexander/Documents/CriticalSuccess/Ai\ Consul

# Optional if the model is gated; replace with your token.
export HF_TOKEN=hf_xxx
export HF_ACCESS_TOKEN=$HF_TOKEN

node -e "(async () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { pipeline, env } = await import('@xenova/transformers');

  const cacheDir = path.join(os.homedir(), '.cache', 'ai-consul', 'transformers');
  fs.mkdirSync(cacheDir, { recursive: true });

  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.cacheDir = cacheDir;
  env.localModelPath = cacheDir;

  console.log('Downloading Xenova/whisper-small...');
  await pipeline('automatic-speech-recognition', 'Xenova/whisper-small');

  console.log('Downloading Xenova/ast-finetuned-speech-commands-v2...');
  await pipeline('audio-classification', 'Xenova/ast-finetuned-speech-commands-v2', {
    quantized: true,
  });

  console.log('Model downloads completed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});"
```

### Copying Into `src/models`
After the downloads finish, sync the cached folders into the repo directory used at runtime:

```bash
rsync -a --delete ~/.cache/ai-consul/transformers/Xenova/ src/models/Xenova/
```

The resulting structure should be:
```
src/models/Xenova/whisper-small/...
src/models/Xenova/ast-finetuned-speech-commands-v2/...
```

> **Note:** `src/models/` is listed in `.gitignore` to keep the large ONNX files out of Git history. Whenever you clone on a new machine, redo the steps above before running `pnpm run dev`.









