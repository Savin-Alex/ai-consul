import React, { useEffect, useState } from 'react';
import './TranscriptionWindow.css';

interface TranscriptEntry {
  text: string;
  timestamp: number;
}

const formatTimestamp = (value: number): string => {
  try {
    return new Date(value).toLocaleTimeString();
  } catch (error) {
    console.warn('Failed to format transcript timestamp', error);
    return '';
  }
};

const TranscriptionWindow: React.FC = () => {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);

  useEffect(() => {
    if (!window.electronAPI) {
      console.warn('[TranscriptionWindow] electronAPI not available');
      return;
    }

    const handleUpdate = (data: TranscriptEntry[]) => {
      console.log('[TranscriptionWindow] Received transcriptions update:', {
        count: data?.length ?? 0,
        entries: data?.map(t => t.text.substring(0, 50)) ?? []
      });
      setEntries(data || []);
    };

    console.log('[TranscriptionWindow] Setting up transcriptions-update listener');
    window.electronAPI.on('transcriptions-update', handleUpdate);

    return () => {
      if (window.electronAPI?.removeListener) {
        window.electronAPI.removeListener('transcriptions-update', handleUpdate);
      }
    };
  }, []);

  return (
    <div className="transcription-window">
      <header className="transcription-header">
        <h2>Live Transcript</h2>
        <p className="transcription-subtitle">Monitor how AI Consul hears your speech.</p>
      </header>
      <div className="transcription-body">
        {entries.length === 0 ? (
          <div className="transcription-placeholder">
            Waiting for microphone input...
          </div>
        ) : (
          entries.map((entry, index) => (
            <article key={`${entry.timestamp}-${index}`} className="transcription-entry">
              <time className="transcription-time" dateTime={new Date(entry.timestamp).toISOString()}>
                {formatTimestamp(entry.timestamp)}
              </time>
              <p className="transcription-text">{entry.text}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
};

export default TranscriptionWindow;
