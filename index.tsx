import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx'; // <- extensión explícita para evitar "App fantasma"
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    {/* Overlay para confirmar ENTRY sin reemplazar App */}
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 999999,
        fontFamily: 'monospace',
        fontSize: 12,
        padding: '6px 8px',
        borderRadius: 8,
        background: 'rgba(0,0,0,.6)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,.15)',
      }}
    >
      BestSeller ✅ (Tu libro con dos clic)
    </div>

    <App />
  </React.StrictMode>
);
