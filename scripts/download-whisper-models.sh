#!/bin/bash
set -e

MODELS_DIR="./models/whisper"
mkdir -p "$MODELS_DIR"

echo "Downloading Whisper models for @fugood/whisper.node (whisper.cpp)..."
echo "Models will be saved to: $MODELS_DIR"

# Base URL for Hugging Face model repository
BASE_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

# Download models (English-only versions are smaller)
models=(
  "ggml-tiny.en.bin"
  "ggml-base.en.bin"
  "ggml-small.en.bin"
)

for model in "${models[@]}"; do
  echo ""
  echo "Downloading $model..."
  curl -L -f -o "$MODELS_DIR/$model" "$BASE_URL/$model" || {
    echo "Warning: Failed to download $model"
    continue
  }
  echo "✅ Downloaded $model"
done

echo ""
echo "✅ Models downloaded to $MODELS_DIR"
echo ""
echo "Model sizes:"
du -h "$MODELS_DIR"/*.bin 2>/dev/null | awk '{printf "  %-8s %s\n", $1, $2}' || echo "  No models found"

echo ""
echo "Note: For medium/large models, download manually from:"
echo "  https://huggingface.co/ggerganov/whisper.cpp/tree/main"

