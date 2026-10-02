import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// Auto-recover from stale dynamic chunk imports following new deployments
window.addEventListener('vite:preloadError', (event) => {
  console.warn('[Vite] Stale chunk detected after deployment, reloading...', event);
  const key = 'kits_admin_chunk_reload_ts';
  const lastReload = Number(sessionStorage.getItem(key) || '0');
  const now = Date.now();
  if (now - lastReload > 8000) {
    sessionStorage.setItem(key, String(now));
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        console.warn('[PWA] Service worker registration error (non-fatal):', err);
      });
  });
}
