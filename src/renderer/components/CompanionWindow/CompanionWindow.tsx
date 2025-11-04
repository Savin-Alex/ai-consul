import React, { useEffect, useState } from 'react';
import './CompanionWindow.css';

interface Suggestion {
  text: string;
  useCase?: string;
}

const CompanionWindow: React.FC = () => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    // Listen for suggestions from main process
    if (window.electronAPI) {
      window.electronAPI.on('suggestions-update', (data: Suggestion[]) => {
        setSuggestions(data);
      });
    }
  }, []);

  if (suggestions.length === 0) {
    return (
      <div className="companion-window">
        <div className="companion-placeholder">AI Consul Ready</div>
      </div>
    );
  }

  return (
    <div className="companion-window">
      <div className="suggestions-container">
        {suggestions.map((suggestion, index) => (
          <div key={index} className="suggestion-item">
            {suggestion.text}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CompanionWindow;

