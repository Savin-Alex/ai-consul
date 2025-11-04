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

## Testing

```bash
# Run tests
pnpm test

# Run tests with UI
pnpm run test:ui

# Run tests with coverage
pnpm run test:coverage
```

## Requirements

- Node.js 18+
- pnpm
- Ollama (for local LLM support)

## Environment Variables

Copy `.env.example` to `.env` and fill in your API keys for cloud fallback services:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
SENTRY_DSN=https://...
UPDATE_ENDPOINT=https://updates.yourapp.com
```

## Project Structure

```
src/
├── main/          # Electron main process
├── renderer/      # React UI components
├── core/          # AI engine core
│   ├── audio/     # Audio capture and transcription
│   ├── llm/       # LLM integrations (local and cloud)
│   ├── context/   # Conversation context and RAG
│   ├── prompts/   # Prompt building and validation
│   ├── modes/     # Special modes (simulation, coaching)
│   └── security/  # Privacy and security
└── utils/         # Shared utilities
```

## License

MIT
