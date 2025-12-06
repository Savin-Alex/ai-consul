#!/bin/bash
# Download Silero VAD model for @fugood/whisper.node

set -e

MODELS_DIR="./models/vad"
mkdir -p "$MODELS_DIR"

echo "Downloading Silero VAD model for @fugood/whisper.node..."

# Note: Check whisper.cpp repository for correct VAD model path
# This is a placeholder - verify the actual URL
echo "Downloading VAD model..."
curl -L -o "$MODELS_DIR/ggml-vad.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/models/ggml-vad.bin" || {
  echo "⚠️  VAD model download failed. Check whisper.cpp repository for correct URL."
  echo "   You may need to download manually from:"
  echo "   https://github.com/ggml-org/whisper.cpp/tree/main/models"
  exit 1
}

echo ""
echo "✅ VAD model downloaded to $MODELS_DIR"
du -h "$MODELS_DIR"/*.bin | awk '{printf "  %-8s %s\n", $1, $2}'

