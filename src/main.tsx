import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AccessGate from './AccessGate';
import App from './App';
import { registerServiceWorker } from './push/subscribe';
import './styles.css';

registerServiceWorker().catch((e) => console.error('SW 등록 실패', e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate>{(lock) => <App onLocked={lock} />}</AccessGate>
  </StrictMode>,
);
