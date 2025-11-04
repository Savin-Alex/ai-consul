import axios from 'axios';
import FormData from 'form-data';

export class CloudWhisper {
  private apiKey: string;
  private baseURL = 'https://api.openai.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required for cloud Whisper');
    }
  }

  async transcribe(audioChunk: Float32Array, sampleRate: number = 16000): Promise<string> {
    try {
      // Convert Float32Array to WAV format
      const wavBuffer = this.float32ToWav(audioChunk, sampleRate);

      // Create form data - for Node.js/Electron main process
      // We'll use axios's built-in form data handling
      const formData = new FormData();
      formData.append('file', wavBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
      });
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await axios.post(
        `${this.baseURL}/audio/transcriptions`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...formData.getHeaders(),
          },
        }
      );

      return response.data.text || '';
    } catch (error: any) {
      console.error('Cloud Whisper error:', error);
      throw new Error(`Cloud transcription failed: ${error.message}`);
    }
  }

  private float32ToWav(float32Array: Float32Array, sampleRate: number): Buffer {
    // Convert Float32Array to 16-bit PCM
    const length = float32Array.length;
    const buffer = Buffer.allocUnsafe(44 + length * 2);

    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + length * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // audio format (PCM)
    buffer.writeUInt16LE(1, 22); // number of channels
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(length * 2, 40);

    // Convert float32 to int16
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
    }

    return buffer;
  }
}

