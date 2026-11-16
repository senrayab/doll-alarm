import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AccessGate from './AccessGate';
import App from './App';
import { registerServiceWorker } from './push/subscribe';
// 글꼴은 앱 안에 포함 (외부 글꼴 서버 접속 없음) — 한글 Pretendard, 숫자·영문 Outfit
import '@fontsource-variable/outfit';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';

registerServiceWorker().catch((e) => console.error('SW 등록 실패', e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate>{(lock) => <App onLocked={lock} />}</AccessGate>
  </StrictMode>,
);
