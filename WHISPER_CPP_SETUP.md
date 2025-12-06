# Whisper.cpp Setup Guide

This guide explains how to set up whisper.cpp for use with AI Consul.

## Option 1: Clone and Build (Recommended)

### Step 1: Clone whisper.cpp

```bash
cd /Users/alexander/Documents/CriticalSuccess/Ai\ Consul
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
```

**Note:** The repository has moved from `ggerganov/whisper.cpp` to `ggml-org/whisper.cpp`. Use the new URL.

### Step 2: Build

**macOS:**
```bash
make
```

**Linux:**
```bash
make
```

**Windows:**
```bash
# Use CMake or Visual Studio
mkdir build
cd build
cmake ..
cmake --build . --config Release
```

### Step 3: Download Model

The whisper.cpp repository includes a download script in the `models/` directory. Use it to download models:

```bash
# Download base model (recommended for balance of speed and accuracy)
bash ./models/download-ggml-model.sh base

# Or download other models:
bash ./models/download-ggml-model.sh tiny      # Fastest, ~75 MB
bash ./models/download-ggml-model.sh small    # Better accuracy, ~466 MB
bash ./models/download-ggml-model.sh medium   # Best accuracy, ~1.5 GB
```

**Available Models:**
- `tiny` / `tiny.en` - Fastest, English-only option available
- `base` / `base.en` - Balanced (recommended), English-only option available
- `small` / `small.en` - Better accuracy, English-only option available
- `medium` - Best accuracy (no English-only version)

**Quantized Models (Smaller, Faster):**
- `tiny-q5_1`, `tiny-q8_0` - Quantized tiny models
- `base-q5_1`, `base-q8_0` - Quantized base models
- `small-q5_1` - Quantized small model

Models are downloaded to `whisper.cpp/models/` directory.

**Alternative: Manual Download**

If the script doesn't work, download directly from Hugging Face:

```bash
mkdir -p models
cd models
curl -L -o ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

See the [whisper.cpp models directory](https://github.com/ggml-org/whisper.cpp/tree/master/models) for all available models.

### Step 4: Test

```bash
./main -m models/ggml-base.bin -f samples/jfk.wav
```

### Step 5: Configure AI Consul

The app will automatically detect the binary at:
- `./whisper.cpp/main` (relative to project root)

Or set the environment variable:
```bash
export WHISPER_CPP_BINARY=/path/to/whisper.cpp/main
```

## Option 2: Use Pre-built Binary

If you have a pre-built whisper.cpp binary:

1. Place it in your PATH, or
2. Set `WHISPER_CPP_BINARY` environment variable

## Model Setup

### Download Models

Models should be placed in one of these locations (checked in order):

1. `./models/whisper/ggml-{size}.bin` (project directory)
2. `~/.cache/ai-consul/whisper/ggml-{size}.bin` (user cache)
3. Environment variable `WHISPER_MODEL_PATH`

### Available Model Sizes

According to the [whisper.cpp models directory](https://github.com/ggml-org/whisper.cpp/tree/master/models), the following models are available:

**Standard Models:**
- `tiny` / `tiny.en` - Fastest, least accurate (~75 MB)
- `base` / `base.en` - Balanced (recommended) (~142 MB)
- `small` / `small.en` - Better accuracy (~466 MB)
- `medium` / `medium.en` - Best accuracy (~1.5 GB)
- `large-v1`, `large-v2`, `large-v3` - Largest models (~3 GB)

**Quantized Models (Smaller, Faster):**
- `tiny-q5_1`, `tiny-q8_0` - Quantized tiny models
- `base-q5_1`, `base-q8_0` - Quantized base models
- `small-q5_1`, `small-q8_0` - Quantized small models
- `medium-q5_0`, `medium-q8_0` - Quantized medium models
- `large-v2-q5_0`, `large-v2-q8_0` - Quantized large-v2
- `large-v3-q5_0` - Quantized large-v3
- `large-v3-turbo`, `large-v3-turbo-q5_0`, `large-v3-turbo-q8_0` - Turbo variants

**Special Models:**
- `small.en-tdrz` - TinyDiarize model for speaker diarization

**Note:** Models with `.en` suffix are English-only and are smaller/faster than multilingual versions.

### Download Methods

**Method 1: Using whisper.cpp's Download Script (Recommended)**

If you've cloned whisper.cpp:
```bash
cd whisper.cpp
bash ./models/download-ggml-model.sh base
```

**Method 2: Using AI Consul's Download Script**

```bash
./scripts/download-whisper-models.sh base
```

**Method 3: Manual Download from Hugging Face**

```bash
mkdir -p models/whisper
curl -L -o models/whisper/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

**All models are available from Hugging Face:**
- Base URL: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin`

**Example downloads:**
```bash
# Standard models
curl -L -o ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin
curl -L -o ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
curl -L -o ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
curl -L -o ggml-medium.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin

# Quantized models (smaller, faster)
curl -L -o ggml-base-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin
curl -L -o ggml-base-q8_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin
```

See the complete list of available models in the [whisper.cpp models directory](https://github.com/ggml-org/whisper.cpp/tree/master/models). The official download script (`models/download-ggml-model.sh`) supports all these models.

## Configuration

In your engine config, set:

```typescript
models: {
  transcription: {
    primary: 'whisper-cpp-base', // or whisper-cpp-tiny, whisper-cpp-small, whisper-cpp-medium
    fallback: 'cloud-whisper'
  }
}
```

## Troubleshooting

### Binary Not Found

If you get "Whisper.cpp binary not found":

1. Check that `whisper.cpp/main` exists relative to project root
2. Or set `WHISPER_CPP_BINARY` environment variable
3. Or ensure `whisper` is in your PATH

### Model Not Found

If you get "Whisper model not found":

1. Download a model using the script: `./scripts/download-whisper-models.sh base`
2. Or set `WHISPER_MODEL_PATH` environment variable
3. Or place model in `./models/whisper/ggml-{size}.bin`

### Permission Denied

If you get permission errors:

```bash
chmod +x whisper.cpp/main
```

## Performance Tips

- Use `tiny` or `base` for real-time transcription
- Use `small` or `medium` for higher accuracy (slower)
- Adjust thread count in `whisper-cpp.ts` (default: 4) based on CPU cores

