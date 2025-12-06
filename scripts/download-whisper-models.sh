#!/bin/bash
# Download Whisper.cpp models
# Usage: ./scripts/download-whisper-models.sh [tiny|base|small|medium]

set -e

MODEL_SIZE=${1:-base}
MODELS_DIR="./models/whisper"

# Create models directory if it doesn't exist
mkdir -p "$MODELS_DIR"

# Model URLs from Hugging Face
declare -A MODEL_URLS=(
  ["tiny"]="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
  ["base"]="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
  ["small"]="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
  ["medium"]="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
)

declare -A MODEL_NAMES=(
  ["tiny"]="ggml-tiny.bin"
  ["base"]="ggml-base.bin"
  ["small"]="ggml-small.bin"
  ["medium"]="ggml-medium.bin"
)

if [[ ! -v MODEL_URLS[$MODEL_SIZE] ]]; then
  echo "Error: Invalid model size '$MODEL_SIZE'"
  echo "Valid sizes: tiny, base, small, medium"
  exit 1
fi

MODEL_URL=${MODEL_URLS[$MODEL_SIZE]}
MODEL_NAME=${MODEL_NAMES[$MODEL_SIZE]}
MODEL_PATH="$MODELS_DIR/$MODEL_NAME"

echo "Downloading Whisper.cpp $MODEL_SIZE model..."
echo "URL: $MODEL_URL"
echo "Destination: $MODEL_PATH"

if [ -f "$MODEL_PATH" ]; then
  echo "Model already exists at $MODEL_PATH"
  read -p "Overwrite? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Skipping download."
    exit 0
  fi
fi

# Download using curl
curl -L -o "$MODEL_PATH" "$MODEL_URL"

if [ $? -eq 0 ]; then
  echo "✓ Successfully downloaded $MODEL_NAME"
  echo "Model saved to: $MODEL_PATH"
  ls -lh "$MODEL_PATH"
else
  echo "✗ Download failed"
  exit 1
fi

