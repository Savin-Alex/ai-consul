# Russian Language Support in Whisper.cpp

## Overview

All standard whisper.cpp models (tiny, base, small, medium, large) are **multilingual** and support Russian language transcription. You don't need special Russian-only models - the standard models work for Russian.

## Language Codes

Whisper.cpp supports language codes for transcription:
- `en` - English (default)
- `ru` - Russian
- `auto` - Auto-detect language
- And many others (see full list below)

## Using Russian Language

### Method 1: Update Code to Pass Language Parameter

The `WhisperCpp.transcribe()` method now supports a language parameter:

```typescript
// Transcribe Russian audio
const text = await whisperCpp.transcribe(audioChunk, 16000, 'ru');

// Auto-detect language
const text = await whisperCpp.transcribe(audioChunk, 16000, 'auto');
```

### Method 2: Set Environment Variable

You can also set the default language via environment variable (if we add support):

```bash
export WHISPER_LANGUAGE=ru
```

## Supported Language Codes

Whisper supports 99 languages. Common ones include:

- `en` - English
- `ru` - Russian
- `es` - Spanish
- `fr` - French
- `de` - German
- `it` - Italian
- `pt` - Portuguese
- `ja` - Japanese
- `ko` - Korean
- `zh` - Chinese
- `ar` - Arabic
- `hi` - Hindi
- `auto` - Auto-detect

Full list: https://github.com/openai/whisper/blob/main/whisper/tokenizer.py

## Russian-Specific Fine-Tuned Models

While standard whisper.cpp models work well for Russian, there are fine-tuned Russian models available on Hugging Face:

1. **Whisper Large V3 Russian** - Fine-tuned for Russian, reduces WER from 9.84% to 6.39%
2. **Whisper Large V3 Turbo Russian** - Optimized for Russian ASR
3. **Whisper Small RU** - Fine-tuned from Whisper-small for Russian

**Note:** These fine-tuned models may need to be converted to GGML format to work with whisper.cpp. The standard multilingual models work well for Russian out of the box.

## Testing Russian Transcription

To test Russian transcription with whisper.cpp:

```bash
cd whisper.cpp
./build/bin/whisper-cli -m models/ggml-base.bin -f your_audio.wav -l ru
```

## Integration in AI Consul

To use Russian language in your app:

1. **Update engine configuration** to pass language parameter
2. **Or modify the transcribe call** to include language:

```typescript
// In your session/engine code
const transcription = await engine.transcribe(audioChunk, sampleRate);
// This will use the language from config or default to 'en'

// To use Russian specifically:
// You'll need to update the engine.transcribe() method to accept language
// and pass it through to whisper-cpp
```

## Performance Tips for Russian

- **Use `base` or `small` models** for best Russian accuracy
- **Set language to `ru`** instead of `auto` for faster processing
- **Use `large-v3` model** for highest accuracy (if you have the resources)
- **Consider fine-tuned Russian models** if you need maximum accuracy

## References

- [Whisper Language Codes](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py)
- [Russian Whisper Models on Hugging Face](https://huggingface.co/models?search=whisper+russian)
- [Whisper.cpp Documentation](https://github.com/ggml-org/whisper.cpp)

