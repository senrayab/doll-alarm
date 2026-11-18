// 사이트 추가·수정
import { BadgeCheck, Info, Save, ShieldAlert, Plus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { getSite, type Site, type SiteKind } from '../db/local';
import { canWatch, detectKnown, siteLives, isDemo, normalizeUrl, saveSite } from '../data/sites';
import { goBack, navigate } from '../lib/router';
import { Header, Toggle } from '../ui/parts';

/** next=watch: 모니터링 추가 화면에서 왔으면 저장 후 그 사이트 모니터링 등록으로 이어감 */
export default function SiteForm({ id, next, onError }: { id?: string; next?: string | null; onError: (e: unknown) => void }) {
  const [site, setSite] = useState<Site | null | undefined>(id ? undefined : null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  // 사이트 유형은 더 이상 고르지 않음 (종류는 모니터링을 추가할 때 고름) — 예전 값은 그대로 유지
  const [kind, setKind] = useState<SiteKind>('etc');
  const [description, setDescription] = useState('');
  const [lives, setLives] = useState<{ name: string; url: string }[]>([]);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getSite(id).then((s) => {
      setSite(s ?? null);
      if (!s) return;
      setName(s.name);
      setUrl(s.url);
      setKind(s.kind);
      setDescription(s.description ?? '');
      setLives(siteLives(s));
      setNeedsLogin(s.needsLogin);
      setEnabled(s.enabled);
    });
  }, [id]);

  if (id && site === undefined) return null;
  if (id && site === null) {
    return (
      <>
        <Header title="사이트 수정" back="/" />
        <main className="page">
          <p className="muted">사이트를 찾을 수 없어요.</p>
        </main>
      </>
    );
  }
  const demo = !!site && isDemo(site);
  const normalized = normalizeUrl(url);
  const known = normalized ? detectKnown(normalized) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await saveSite({ name, url, kind, description, lives, needsLogin, enabled }, site ?? undefined);
      if (site) goBack(`/sites/${saved.id}`);
      else if (next === 'watch' && canWatch(saved)) navigate(`/watch/new?site=${saved.id}`, { replace: true });
      else navigate(`/sites/${saved.id}`, { replace: true });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header title={site ? '사이트 수정' : '사이트 추가'} back={site ? `/sites/${site.id}` : next === 'watch' ? '/watch/new' : '/'} />
      <main className="page">
        <form className="card form" onSubmit={submit}>
          <label className="field">
            <span>사이트 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 나나코어" maxLength={30} required />
          </label>
          <label className="field">
            <span>사이트 주소</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              disabled={demo}
              required={!demo}
            />
            {demo && <small>데모 대기열은 주소가 없어요.</small>}
            {known?.support === 'official' && (
              <small className="ok-text">
                <BadgeCheck size={14} aria-hidden /> 지원 사이트: {known.label} — 대기 순번 자동 모니터링을 쓸 수 있어요.
              </small>
            )}
            {known?.support === 'unsupported' && (
              <small className="err-text">
                <ShieldAlert size={14} aria-hidden /> {known.label}: {known.unsupportedReason}
              </small>
            )}
          </label>
          <div className="field">
            <span>유튜브 라이브 (선택)</span>
            {lives.map((l, i) => (
              <div key={i} className="live-row">
                <input
                  className="live-name"
                  value={l.name}
                  onChange={(e) => setLives(lives.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder={lives.length > 1 ? `${i + 1}호점` : '이름'}
                  maxLength={12}
                />
                <input
                  value={l.url}
                  onChange={(e) => setLives(lives.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                  placeholder="@채널아이디 또는 주소"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <button type="button" className="live-del" aria-label="라이브 삭제" onClick={() => setLives(lives.filter((_, j) => j !== i))}>
                  <X size={16} />
                </button>
              </div>
            ))}
            <button type="button" className="chip add-live" onClick={() => setLives([...lives, { name: '', url: '' }])}>
              <Plus size={14} aria-hidden /> 라이브 추가
            </button>
            <small>1호점·2호점처럼 채널이 여러 개면 하나씩 추가해 주세요. @채널아이디만 넣어도 돼요.</small>
          </div>
          <label className="field">
            <span>설명 (선택)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={200} />
          </label>
          <div className="settings-list">
            <div className="setting">
              <div>
                <b>로그인이 필요한 사이트</b>
                <small>로그인해야 보이는 정보는 자동 모니터링할 수 없어요</small>
              </div>
              <Toggle label="로그인 필요" checked={known ? known.needsLogin : needsLogin} onChange={setNeedsLogin} disabled={demo || !!known} />
            </div>
            <div className="setting">
              <div>
                <b>사용</b>
                <small>끄면 이 사이트의 새 모니터링을 등록할 수 없어요</small>
              </div>
              <Toggle label="사용" checked={enabled} onChange={setEnabled} />
            </div>
          </div>
          {!site && !known && (
            <p className="note">
              <Info size={16} aria-hidden />
              <span>저장하면 서버가 주소를 한 번 열어 보고, 공개 페이지면 <b>키워드 모니터링</b>(재입고·신규 상품·가격 문구 등)를 쓸 수 있게 해요.</span>
            </p>
          )}
          <button className="primary" type="submit" disabled={busy}>
            <Save size={20} aria-hidden /> {busy ? '연결 확인 중…' : '저장'}
          </button>
        </form>
      </main>
    </>
  );
}
