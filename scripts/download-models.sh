#!/bin/bash
# Download Whisper models for @fugood/whisper.node

set -e

MODELS_DIR="./models/whisper"
mkdir -p "$MODELS_DIR"

echo "Downloading Whisper models for @fugood/whisper.node..."

# Base English model (recommended for real-time)
echo "Downloading base.en model..."
curl -L -o "$MODELS_DIR/ggml-base.en.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

# Tiny model (fastest, lower accuracy)
echo "Downloading tiny.en model..."
curl -L -o "$MODELS_DIR/ggml-tiny.en.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"

# Small model (balanced)
echo "Downloading small.en model..."
curl -L -o "$MODELS_DIR/ggml-small.en.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"

echo ""
echo "✅ Models downloaded to $MODELS_DIR"
echo ""
echo "Model sizes:"
du -h "$MODELS_DIR"/*.bin | awk '{printf "  %-8s %s\n", $1, $2}'

