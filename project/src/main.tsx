import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.tsx';
import './index.css';
import { isSupabaseConfigured } from './lib/supabase';

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

import { AuthProvider } from './context/AuthContext.tsx';
import { PortalErrorBoundary } from './components/PortalErrorBoundary';

function SecurePreviewDisconnected() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <section
        role="status"
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-200/60"
      >
        <img src="/logo.png" alt="MatMove" className="mx-auto mb-6 h-12 w-auto object-contain" />
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Secure preview mode
        </p>
        <h1 className="text-xl font-bold text-slate-900">
          Preview is not connected to a test database
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This build is intentionally disconnected from live MatMove accounts, wallets and payment services.
          Sign-in and money movement are disabled until a dedicated non-production backend is configured.
        </p>
        <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
          The production app continues to use its configured Supabase connection.
        </p>
      </section>
    </main>
  );
}

if (import.meta.env.PROD && isSupabaseConfigured && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(error => {
      console.warn('MatMove offline shell registration was unavailable.', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PortalErrorBoundary>
      {isSupabaseConfigured ? (
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      ) : (
        <SecurePreviewDisconnected />
      )}
    </PortalErrorBoundary>
  </StrictMode>
);
