# Music Filtering Fix

## Problem
Transcription was showing "[Music]" instead of transcribing actual speech. This happened because:
1. VAD was detecting music/background audio as speech
2. Whisper was transcribing the music and outputting "[Music]" as the text

## Solution

### 1. Transcription Result Filtering (`src/core/session.ts`)
Added filtering to reject transcriptions that contain "[Music]":
- Filters out `[music]`, `[Music]`, and variations
- Filters out very short transcriptions (< 3 characters) that are likely noise
- Already had filtering for `[blank_audio]`

### 2. VAD Music Detection (`src/core/audio/vad-default.ts`)
Enhanced VAD to better distinguish speech from music:

**Label-based filtering:**
- Detects music-related labels (music, song, melody, tune)
- Only accepts known speech command keywords (yes, no, up, down, numbers, etc.)

**Audio characteristic filtering:**
- Added `computeEnergyVariation()` method to analyze audio patterns
- Music typically has:
  - Lower energy variation (more consistent)
  - Higher average amplitude
  - Higher peak energy
- Speech typically has:
  - Higher energy variation (more dynamic)
  - Lower average amplitude
  - More variable patterns

**Detection logic:**
```typescript
const looksLikeMusic = energyVariation < 0.3 && avgAmplitude > 0.1 && energyLevel > 0.3;
const isSpeech = !isMusic && !looksLikeMusic && (isSpeechCommand || ...) && ...
```

## Testing

1. **Restart the app**:
   ```bash
   pnpm run dev
   ```

2. **Check VAD logs** (with `DEBUG_AUDIO=true`):
   - Look for `isMusic` and `looksLikeMusic` flags
   - Check `energyVariation` values (music < 0.3, speech > 0.3)
   - Verify `isSpeech` is `false` when music is playing

3. **Test scenarios**:
   - **Music playing**: Should NOT trigger transcription
   - **Speech**: Should trigger transcription normally
   - **Background music + speech**: Should prioritize speech

## Expected Behavior

- **Music only**: VAD detects `isMusic: true` or `looksLikeMusic: true` → No transcription
- **Speech**: VAD detects `isSpeech: true` → Transcription proceeds
- **"[Music]" output**: Filtered out at transcription result level

## Debugging

If music is still being transcribed:

1. **Check VAD logs** - Look for what labels are being detected
2. **Adjust thresholds** in `vad-default.ts`:
   - `energyVariation` threshold (currently 0.3)
   - `avgAmplitude` threshold (currently 0.1)
   - `energyLevel` threshold (currently 0.3)

3. **Check audio source** - Make sure you're using microphone, not system audio

## Files Changed

1. `src/core/session.ts` - Added "[Music]" filtering
2. `src/core/audio/vad-default.ts` - Added music detection logic

