import { KeyRound, LoaderCircle, RotateCw } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { clearAccessCode, loadAccessCode, UnauthorizedError, verifyAndSaveAccessCode } from './api/client';
import { dbBlocked } from './db/local';
import { Aura } from './ui/Aura';

/** 개인 접속 코드가 저장되어 있어야 앱 화면을 보여 줌 */
export default function AccessGate({ children }: { children: (lock: () => void) => ReactNode }) {
  const [state, setState] = useState<'loading' | 'locked' | 'open'>('loading');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** 저장소 여는 게 오래 걸림 (이전 버전 창이 붙잡고 있는 경우 등) */
  const [slow, setSlow] = useState<'blocked' | 'slow' | null>(null);

  useEffect(() => {
    const onBlocked = () => setSlow('blocked');
    dbBlocked.listeners.add(onBlocked);
    if (dbBlocked.value) onBlocked();
    const t = setTimeout(() => setSlow((s) => s ?? 'slow'), 4000);
    loadAccessCode()
      .then((c) => setState(c ? 'open' : 'locked'))
      .catch(() => setState('locked'))
      .finally(() => clearTimeout(t));
    return () => {
      clearTimeout(t);
      dbBlocked.listeners.delete(onBlocked);
    };
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
        <div className="loading">
          <LoaderCircle className="spin" size={28} aria-label="불러오는 중" />
          {slow && (
            <>
              <p>
                {slow === 'blocked'
                  ? '이전 버전 앱 화면이 아직 열려 있어 업데이트를 마치지 못하고 있어요.'
                  : '불러오는 데 시간이 걸리고 있어요.'}
                <br />
                최근 앱 목록에서 순번알리미를 <b>완전히 닫은 뒤</b> 다시 열어 주세요.
              </p>
              <button className="primary outline" onClick={() => location.reload()}>
                <RotateCw size={18} aria-hidden /> 다시 시도
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (state === 'open') return <>{children(lock)}</>;

  return (
    <div className="app">
      <div className="gate">
        <Aura tone="near" className="gate-aura" />
        <h1>순번 알리미</h1>
        <p className="sub">개인 접속 코드를 입력해 주세요. 이 휴대폰에 저장되어 다음부터는 묻지 않아요.</p>
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
