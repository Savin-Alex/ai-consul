import React, { useState, useEffect } from 'react';
import './OllamaCheck.css';

interface OllamaCheckProps {
  onComplete: (connected: boolean, model?: string) => void;
}

const OllamaCheck: React.FC<OllamaCheckProps> = ({ onComplete }) => {
  const [status, setStatus] = useState<'checking' | 'connected' | 'not-found' | 'error'>('checking');
  const [model, setModel] = useState<string>('llama3:8b');
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    checkOllama();
  }, []);

  const checkOllama = async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (response.ok) {
        const data = await response.json();
        const models = data.models?.map((m: any) => m.name) || [];
        setAvailableModels(models);
        
        // Check if default model is available
        const defaultModel = 'llama3:8b';
        const hasModel = models.some((m: string) => m.includes('llama3') || m.includes('llama'));
        
        if (hasModel) {
          setStatus('connected');
          setModel(models.find((m: string) => m.includes('llama3')) || models[0] || defaultModel);
          onComplete(true, model);
        } else {
          setStatus('connected');
          setModel(models[0] || defaultModel);
          onComplete(true, models[0] || defaultModel);
        }
      } else {
        setStatus('not-found');
      }
    } catch (error) {
      setStatus('not-found');
    }
  };

  if (status === 'checking') {
    return (
      <div className="ollama-check">
        <p>Checking for Ollama...</p>
        <div className="spinner"></div>
      </div>
    );
  }

  if (status === 'not-found') {
    return (
      <div className="ollama-check">
        <p className="error-text">Ollama is not running or not installed.</p>
        <p>To use local AI features, please:</p>
        <ol>
          <li>Install Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer">ollama.ai</a></li>
          <li>Start Ollama on your system</li>
          <li>Pull a model: <code>ollama pull llama3:8b</code></li>
        </ol>
        <button onClick={checkOllama}>Retry Connection</button>
        <button onClick={() => onComplete(false)} className="skip-button">
          Skip (use cloud AI only)
        </button>
      </div>
    );
  }

  return (
    <div className="ollama-check">
      <p className="success-text">✓ Ollama is connected!</p>
      {availableModels.length > 0 && (
        <div className="model-selector">
          <label>Available Models:</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}
      <button onClick={() => onComplete(true, model)}>Continue</button>
    </div>
  );
};

export default OllamaCheck;

