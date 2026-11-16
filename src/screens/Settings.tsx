// 설정 — 알림, 휴대폰 알림 소리·진동 안내, 개인정보, 접속 코드
import { Bell, BellOff, BellRing, Download, FlaskConical, KeyRound, ShieldCheck, Smartphone, Timer, Vibrate } from 'lucide-react';
import { useState } from 'react';
import { clearAccessCode } from '../api/client';
import { sendTestPush } from '../push/subscribe';
import { turnOffPush, turnOnPush, usePush } from '../push/store';
import { ensureDemoSite } from '../data/sites';
import { navigate } from '../lib/router';
import { Header } from '../ui/parts';

export default function Settings({ onError, onInfo, onLocked }: { onError: (e: unknown) => void; onInfo: (m: string) => void; onLocked: () => void }) {
  const push = usePush();
  const [busy, setBusy] = useState(false);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const permText = { granted: '허용', denied: '차단', default: '확인 전', unsupported: '지원 안 함' }[push.permission];

  return (
    <>
      <Header title="설정" />
      <main className="page">
        <h3>알림</h3>
        <section className="card">
          <ul className="status">
            <li>
              <span className="label">
                <Smartphone size={18} aria-hidden /> 홈 화면 앱으로 실행
              </span>
              <b className={standalone ? 'on' : 'off'}>{standalone ? '예' : '아니요'}</b>
            </li>
            <li>
              <span className="label">
                <Bell size={18} aria-hidden /> 알림 권한
              </span>
              <b className={push.permission === 'granted' ? 'on' : 'off'}>{permText}</b>
            </li>
            <li>
              <span className="label">
                <BellRing size={18} aria-hidden /> 알림 연결
              </span>
              <b className={push.subscription ? 'on' : 'off'}>{push.subscription ? '연결됨' : '없음'}</b>
            </li>
          </ul>
          {!standalone && (
            <p className="hint">
              <Download size={15} aria-hidden />
              <span>크롬 메뉴 → “앱 설치”로 설치하면 앱처럼 쓸 수 있어요.</span>
            </p>
          )}
          {push.permission === 'denied' && <p className="hint err">알림이 차단되어 있어요. 휴대폰 설정 → 애플리케이션 → 순번알리미 → 알림에서 허용해 주세요.</p>}
          {!push.subscription ? (
            <button className="primary" disabled={busy || push.support !== 'ok'} onClick={() => run(async () => void (await turnOnPush()))}>
              <Bell size={20} aria-hidden /> 알림 켜기
            </button>
          ) : (
            <div className="stack">
              <button className="primary outline" disabled={busy} onClick={() => run(async () => { await sendTestPush(push.subscription!, 0); onInfo('테스트 알림을 보냈어요.'); })}>
                <BellRing size={18} aria-hidden /> 테스트 알림
              </button>
              <button className="primary outline" disabled={busy} onClick={() => run(async () => { await sendTestPush(push.subscription!, 15); onInfo('15초 뒤에 알림이 와요. 화면을 꺼 보세요.'); })}>
                <Timer size={18} aria-hidden /> 15초 뒤 테스트 알림
              </button>
              <button
                className="ghost"
                disabled={busy}
                onClick={() => confirm('알림을 끄면 감시 중이어도 알림을 받을 수 없어요. 끌까요?') && run(turnOffPush)}
              >
                <BellOff size={18} aria-hidden /> 알림 끄기
              </button>
            </div>
          )}
        </section>

        <h3>연습</h3>
        <section className="card">
          <p className="hint">방송이 없어도 15초마다 한 칸씩 진행되는 가짜 대기열로 알림이 어떻게 오는지 미리 볼 수 있어요. 사이트 목록에 ‘데모 대기열’이 추가돼요.</p>
          <button className="primary outline" onClick={() => run(async () => navigate(`/watch/new?site=${(await ensureDemoSite()).id}`))}>
            <FlaskConical size={18} aria-hidden /> 데모로 연습하기
          </button>
        </section>

        <h3>소리 · 진동</h3>
        <section className="card guide">
          <p>
            <Vibrate size={16} aria-hidden />
            <span>안드로이드는 휴대폰 설정에 따라 소리·진동이 정해져요.</span>
          </p>
          <ol>
            <li>휴대폰 설정 → 애플리케이션 → <b>순번알리미</b> → 알림</li>
            <li>알림 항목을 눌러 <b>소리</b>와 <b>진동</b>을 켜고, <b>팝업으로 표시</b>를 켜 주세요.</li>
            <li>무음·방해 금지 중에도 받으려면 방해 금지 설정의 <b>예외 앱</b>에 순번알리미를 추가해 주세요.</li>
          </ol>
        </section>

        <h3>개인정보 · 보안</h3>
        <section className="card guide">
          <p>
            <ShieldCheck size={16} aria-hidden />
            <span>사이트 목록, 닉네임, 알림 내역은 이 휴대폰에만 저장돼요.</span>
          </p>
          <ul>
            <li>서버에는 감시 작업 정보(닉네임 해시, 조건, 주기)와 알림 연결 정보만 있어요.</li>
            <li>사이트 로그인 정보·쿠키는 어디에도 보내지 않아요.</li>
            <li>감시를 삭제하면 서버의 작업도 바로 지워져요.</li>
          </ul>
        </section>

        <h3>접속 코드</h3>
        <section className="card">
          <p className="hint">이 휴대폰에 저장된 개인 접속 코드를 지우면 다음에 다시 입력해야 해요. 등록된 감시는 그대로 유지돼요.</p>
          <button
            className="ghost danger"
            onClick={() => confirm('이 휴대폰에서 접속 코드를 지울까요?') && clearAccessCode().then(onLocked)}
          >
            <KeyRound size={18} aria-hidden /> 접속 코드 지우기
          </button>
        </section>
        <p className="version">순번 알리미 · MVP</p>
      </main>
    </>
  );
}
