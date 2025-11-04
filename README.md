# AI Consul

A privacy-first, real-time AI assistant for conversations, interviews, meetings, and educational sessions.

## Features

- **Privacy-First**: All processing local by default, cloud requires explicit opt-in
- **Low-Latency**: Optimized audio-to-suggestion pipeline (<5s target)
- **Local-First**: Fully functional offline using local LLMs (Ollama) and Whisper
- **Mode-Aware**: Supports interviews, meetings, education, chat, and simulation modes
- **Real-Time Suggestions**: Provides concise, actionable suggestions during live conversations

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm run dev

# Build for production
pnpm run build

# Build for macOS
pnpm run build:mac

# Build for Windows
pnpm run build:win
```

## Requirements

- Node.js 18+
- pnpm
- Ollama (for local LLM support)

## Environment Variables

Copy `.env.example` to `.env` and fill in your API keys for cloud fallback services.

