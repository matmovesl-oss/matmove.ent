import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.tsx';
import './index.css';

import {
  AuthProvider,
} from './context/AuthContext.tsx';

import {
  PortalErrorBoundary,
} from './components/PortalErrorBoundary';

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