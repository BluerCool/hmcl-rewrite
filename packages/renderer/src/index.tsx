import { createRoot } from 'react-dom/client';
import { App } from './App';
import './global.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

// Surface fatal renderer errors on-screen instead of a silent blank window.
function showFatalError(message: string): void {
  const box = document.createElement('pre');
  box.style.cssText =
    'color:#f87171;background:#1d2026;padding:16px;white-space:pre-wrap;font:12px monospace';
  box.textContent = message;
  document.body.appendChild(box);
}

window.addEventListener('error', (event) => {
  if (document.body.childElementCount > 0) {
    showFatalError(`Uncaught error: ${event.message}`);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  showFatalError(`Unhandled rejection: ${String(event.reason)}`);
});

try {
  createRoot(container).render(<App />);
} catch (error) {
  showFatalError(`Render failed: ${String(error)}`);
}
