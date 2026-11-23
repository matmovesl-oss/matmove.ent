import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.tsx';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !rootElement.contains(image)) return;
    if (image.closest('.mapboxgl-map, .gm-style, [data-no-image-fallback]')) return;
    if (image.dataset.matmoveFallbackApplied === 'true' || image.getAttribute('src') === '/image-unavailable.svg') return;
    image.dataset.matmoveFallbackApplied = 'true';
    image.src = '/image-unavailable.svg';
  }, true);
}

import {
  AuthProvider,
} from './context/AuthContext.tsx';

import {
  PortalErrorBoundary,
} from './components/PortalErrorBoundary';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(error => {
      console.warn('MatMove offline shell registration was unavailable.', error);
    });
  });
}

createRoot(
  document.getElementById('root')!
).render(
  <StrictMode>
    <PortalErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </PortalErrorBoundary>
  </StrictMode>
);