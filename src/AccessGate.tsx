import { KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { clearAccessCode, loadAccessCode, UnauthorizedError, verifyAndSaveAccessCode } from './api/client';

/** 개인 접속 코드가 저장되어 있어야 앱 화면을 보여 줌 */
export default function AccessGate({ children }: { children: (lock: () => void) => ReactNode }) {
  const [state, setState] = useState<'loading' | 'locked' | 'open'>('loading');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadAccessCode()
      .then((c) => setState(c ? 'open' : 'locked'))
      .catch(() => setState('locked'));
  }, []);

  const lock = () => {
    clearAccessCode().finally(() => {
      setError('저장된 접속 코드가 더 이상 맞지 않습니다. 다시 입력해 주세요.');
      setState('locked');
    });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    try {
      await verifyAndSaveAccessCode(code);
      setCode('');
      setState('open');
    } catch (err) {
      setError(err instanceof UnauthorizedError ? '접속 코드가 맞지 않습니다.' : '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="app center">
        <LoaderCircle className="spin" size={28} aria-label="불러오는 중" />
      </div>
    );
  }

  if (state === 'open') return <>{children(lock)}</>;

  return (
    <div className="app">
      <div className="gate">
        <div className="gate-icon">
          <LockKeyhole size={32} strokeWidth={2.2} aria-hidden />
        </div>
        <h1>순번 알리미</h1>
        <p className="sub">개인 접속 코드를 입력해 주세요. 이 휴대폰에 저장되어 다음부터는 묻지 않습니다.</p>
        <form className="card" onSubmit={submit}>
          <label className="field">
            <span>접속 코드</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
            />
          </label>
          {error && <p className="hint err">{error}</p>}
          <button className="primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? <LoaderCircle className="spin" size={20} aria-hidden /> : <KeyRound size={20} aria-hidden />}
            확인
          </button>
        </form>
      </div>
    </div>
  );
}
