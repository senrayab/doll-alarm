// 페이지 주소 — 기본은 사이트 주소를 쓰고, 필요할 때만 다른 주소를 넣도록 접어 둠
import { Link2 } from 'lucide-react';
import { useState } from 'react';

function hostPath(url: string) {
  try {
    const u = new URL(url);
    return (u.host + (u.pathname === '/' ? '' : u.pathname)).slice(0, 48);
  } catch {
    return url;
  }
}

export function PageUrlField({ value, siteUrl, onChange }: { value: string; siteUrl: string; onChange: (v: string) => void }) {
  const custom = value.trim() !== '' && value.trim() !== siteUrl;
  const [open, setOpen] = useState(custom);
  if (!open) {
    return (
      <div className="page-url">
        <Link2 size={15} aria-hidden />
        <span>
          페이지: <b>{hostPath(siteUrl)}</b> <small>(사이트 주소)</small>
        </span>
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          다른 주소 쓰기
        </button>
      </div>
    );
  }
  return (
    <label className="field">
      <span>페이지 주소</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={siteUrl} inputMode="url" autoCapitalize="off" autoCorrect="off" />
      <small>
        상품 상세 페이지처럼 키워드가 나올 페이지예요.{' '}
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            onChange(siteUrl);
            setOpen(false);
          }}
        >
          사이트 주소로 되돌리기
        </button>
      </small>
    </label>
  );
}
