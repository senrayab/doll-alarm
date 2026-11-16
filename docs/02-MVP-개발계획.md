# MVP 개발 계획 (STEP 2)

작성일: 2026-11-16
전제: [01-기술검증보고서.md](./01-기술검증보고서.md)

---

## 1. MVP 범위

**목표 한 문장**: 휴대폰에서 나나코어 닉네임을 등록하고 감시를 시작하면, 앱을 끄고 화면을 잠가도 순번 변화·내 차례 알림이 온다.

### 포함

- PWA (홈 화면 설치, 모바일 폭 전용 UI — PC에서도 같은 폭으로 가운데 표시)
- 사이트 관리: 추가·수정·삭제·활성화, 공식 지원 / 사용자 지정 / 지원 불가 구분
  - 처음엔 비어 있음. 사용자가 주소를 넣으면 주소로 판정: 나나코어 주소 → 공식 지원, 베베픽 주소 → 지원 불가(바로가기만), 그 외 → 직접 추가
  - 데모 대기열은 설정의 "데모로 연습하기"를 눌렀을 때만 추가
  - 알림 제목에 사이트 이름 표시 ("나나코어 · 차례 도달!")
- 나나코어 대기 순번 감시 (서버 감시 + Web Push)
  - 알림 조건 5종 개별 선택: 순번 변경 / 앞 인원 N명 이하 / 내 차례 / 사라짐 / 감시 오류
- 감시 시작·중지, 주기(15초~5분), 예약 시작·종료 시간
- 대시보드, 감시 상세(최근 변경 이력), 알림 내역
- 사용자 지정 사이트 **키워드 감시** (2026-11-16 MVP 편입)
  - 공개 페이지 URL + 키워드(여러 개 가능) 등록
  - 알림 조건: 키워드 등장 / 키워드 사라짐 / 감시 오류
  - 서버가 HTML을 받아 태그·스크립트를 걷어낸 본문 글자에서 검색 (대소문자·공백 무시)
  - 등록 전 연결 확인으로 감시 가능 여부를 먼저 판정 — 로그인 필요, robots.txt 금지, JS로만 그려지는 페이지는 등록 단계에서 "감시 불가"와 사유 표시
  - 주기는 1분 이상만 (일반 쇼핑몰 부담 고려), 요청에 앱 이름이 들어간 User-Agent 사용
- 알림 권한 요청, 테스트 알림
- JSON 백업·복원·초기화

### 제외 (MVP 이후)

- 상품·재입고·가격 감시 모듈 (구조만 열어 둠)
- 사용자 지정 사이트의 가격·재입고 판정 (사이트별 구조가 달라 전용 모듈 필요)
- 베베픽 리마인더 푸시

---

## 2. 폴더 구조

```
doll-alarm/
├ docs/
├ app/                          # PWA (Vite + React + TS)
│  ├ index.html
│  ├ public/  manifest.webmanifest, icons/
│  └ src/
│     ├ main.tsx, App.tsx
│     ├ sw.ts                   # Service Worker: 푸시 수신·알림 표시·알림 내역 저장
│     ├ db/                     # IndexedDB (idb 라이브러리)
│     │  ├ schema.ts
│     │  └ repo.ts              # sites / watches / events / settings
│     ├ api/client.ts           # Worker API 호출
│     ├ push/subscribe.ts       # 권한 요청·구독·해제
│     ├ sites/                  # 사이트별 "화면 쪽" 정의 (입력 폼·표시)
│     │  ├ registry.ts
│     │  ├ nanacore.tsx
│     │  └ unsupported.tsx      # 베베픽 등
│     ├ screens/                # 대시보드, 사이트 목록/추가/상세, 감시 상세, 알림 내역, 설정, 백업
│     └ ui/                     # 공통 컴포넌트
├ worker/                       # Cloudflare Worker
│  ├ wrangler.toml              # assets = ../app/dist, Durable Object 바인딩
│  └ src/
│     ├ index.ts                # 라우터 (/api/*), 나머지는 정적 파일
│     ├ watch-do.ts             # WatchJob Durable Object (alarm 루프)
│     ├ engine/
│     │  ├ types.ts             # SiteModule 인터페이스
│     │  ├ evaluate.ts          # 이전/현재 상태 비교 → 알림 이벤트 (공통)
│     │  └ dedupe.ts
│     ├ modules/                # 사이트별 서버 모듈 (서로 독립)
│     │  ├ registry.ts
│     │  ├ nanacore.ts
│     │  └ keyword.ts           # 사용자 지정 사이트 연결 확인 + 키워드 감시
│     └ push/webpush.ts         # VAPID 서명 + RFC 8291 암호화 (WebCrypto)
└ shared/                       # app·worker가 같이 쓰는 타입
   └ types.ts
```

새 사이트 추가 = `worker/src/modules/<site>.ts` + `app/src/sites/<site>.tsx` 두 파일 + registry에 한 줄. 기존 모듈은 건드리지 않는다.

---

## 3. 데이터 구조

### 3-1. IndexedDB (휴대폰)

```ts
Site {
  id: string; name: string; url: string;
  kind: 'queue' | 'product' | 'new-product' | 'restock' | 'etc';
  moduleId: 'nanacore' | 'keyword' | 'unsupported';
  support: 'official' | 'custom' | 'unsupported';
  unsupportedReason?: string;           // "로그인 필요 · 자동 수집 금지" 등
  needsLogin: boolean; enabled: boolean; description?: string; iconUrl?: string;
  createdAt: number;
}

Watch {
  id: string; siteId: string; label: string;
  target: { nickname: string } | { url: string; keywords: string[] };   // 닉네임 평문은 여기에만
  conditions: { positionChange: boolean; aheadAtMost?: number; myTurn: boolean;
                disappeared: boolean; error: boolean };
  intervalSec: 15 | 30 | 60 | 180 | 300;
  schedule?: { start: string; end: string };   // "19:00" ~ "23:30"
  running: boolean;
  server?: { jobId: string; deleteToken: string };
  lastSnapshot?: Snapshot; lastCheckedAt?: number;
}

Event { id; watchId; type; title; body; at; }   // 알림 내역 (SW가 푸시 받을 때 기록)
Settings { pushSubscription?: PushSubscriptionJSON; ... }
```

### 3-2. 서버 (Durable Object 1개 = 감시 작업 1개)

```ts
JobState {
  moduleId: 'nanacore';
  params: { nicknameHash: string; salt: string };   // 평문 닉네임 없음
  conditions; intervalSec; schedule?; tz: 'Asia/Seoul';
  push: { endpoint; keys: { p256dh; auth } };
  deleteTokenHash: string;
  last?: { position?: number; ahead?: number; status?: string; seen: boolean; ok: boolean };
  lastNotified: { [eventKey: string]: number };     // 중복 방지
  consecutiveErrors: number;
}
```

### 3-3. API

| 메서드 | 경로 | 내용 |
|---|---|---|
| POST | `/api/jobs` | 작업 생성 → `{ jobId, deleteToken }` |
| PATCH | `/api/jobs/:id` | 조건·주기·예약 변경, 시작·중지 (토큰 필요) |
| DELETE | `/api/jobs/:id` | 작업과 저장소 전체 삭제 (토큰 필요) |
| GET | `/api/jobs/:id/state` | 마지막 확인 결과 (앱 화면 갱신용, 토큰 필요) |
| POST | `/api/push/test` | 테스트 알림 |
| POST | `/api/probe` | 사용자 지정 URL 연결 확인 (1회 조회, 결과만 반환·저장 안 함) |
| GET | `/api/vapid-public-key` | 공개키 |

---

## 4. 사이트 모듈 구조

```ts
// worker/src/engine/types.ts
interface SiteModule<P, S> {
  id: string;
  minIntervalSec: number;                         // 나나코어 15
  fetchSnapshot(params: P, env): Promise<S>;      // 실패 시 throw → "감시 오류"
  // 공통 엔진이 S 이전/현재를 evaluate.ts 로 비교
}
```

- 모듈은 "데이터 읽기 + 내 상태 뽑기"만 한다. 비교·알림·중복 방지는 공통 엔진이 한다.
- 응답 검증: 필드·타입이 예상과 다르면 throw한다. 빈 배열은 "명단 비움"으로 정상 처리한다 (사라짐 판정).

---

## 5. 푸시 알림 흐름

```
[등록]
앱: 감시 시작 탭 → Notification.requestPermission() (탭 이벤트 안에서)
   → pushManager.subscribe({ applicationServerKey: VAPID 공개키 })
   → POST /api/jobs { 구독, moduleId, nicknameHash, salt, 조건, 주기, 예약 }
   → jobId·deleteToken 을 IndexedDB 에 저장

[감시] (Durable Object alarm)
예약 시간 밖이면 → 다음 시작 시각으로 alarm 만 다시 걸고 끝
fetchSnapshot → evaluate(이전, 현재) → 이벤트 목록
  → 조건에 맞고 lastNotified 로 중복 아닌 것만 → Web Push (Urgency: high, TTL 300)
  → 상태 저장 → setAlarm(now + intervalSec)
오류: 연속 3회 실패 시 "감시 오류" 1회 알림, 회복 시 "감시 재개" 1회
내 차례 도달: 알림 후 주기를 유지하고, 완료(done) 또는 사라짐이면 자동 중지 + 알림

[수신] (휴대폰 Service Worker)
push 이벤트 → showNotification → Event 를 IndexedDB 에 기록
알림 탭 → 앱의 해당 감시 상세 화면 열기

[정리]
중지/삭제 → DELETE /api/jobs/:id → DO deleteAlarm + deleteAll
푸시 응답 404/410 → 작업 자동 삭제
```

**중복 방지 키 예시**: `position:15`, `ahead<=3`, `turn`, `gone`, `error`. 같은 키는 다시 보내지 않는다. 순번이 다시 바뀌면 새 키가 된다.

---

## 6. 개발 순서

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **0. 선행 확인** | 나나코어 Supabase REST 1회 호출 확인, Cloudflare 계정·`wrangler login` — **완료** | JSON 명단 응답 확인 |
| **1. 푸시 왕복 (가장 먼저)** | 최소 PWA + Worker + VAPID + 테스트 알림 버튼, 접속 코드, 배포 — **완료: 2026-11-16 안드로이드 잠금 화면에서 15초 뒤 알림 수신 확인** | **실제 휴대폰을 잠근 상태에서 테스트 알림 수신** |
| **2. 서버 감시 엔진** | WatchJob DO, alarm 루프, nanacore 모듈, evaluate, 중복 방지, 데모 대기열 — **배포 완료 (데모 흐름 확인), 실제 방송 확인 대기** | 단위 테스트 + 실제 방송 중 순번 변경 알림 |
| **3. 앱 화면** | 모바일 폭 UI, 사이트 관리, 감시 등록·상세, 대시보드, 알림 내역 — **배포 완료, 실기기 확인 대기** | 휴대폰만으로 등록→감시→알림→중지 |
| **4. 마무리** | 예약 시간, 백업·복원·초기화, 사용자 지정 사이트 연결 확인 + 키워드 감시, 오류 처리 | 6장 테스트 전체 통과 |

푸시 왕복을 1번으로 둔 이유: 프로젝트의 전제 전체가 "잠긴 휴대폰에서 알림 수신"이다. 이게 안 되면 나머지가 의미 없으므로 가장 먼저 실기기로 검증한다.

---

## 7. 테스트 계획

**자동 테스트 (vitest)**
- `evaluate`: 순번 변경 / 앞 인원 감소 / 내 차례 / 완료 / 사라짐 / 명단 비움 / 같은 닉네임 여러 행 / 오류와 도달 구분
- `dedupe`: 같은 이벤트 반복 시 1회만
- `nanacore` 파서: 정상 응답, 필드 누락, 빈 배열, HTTP 오류
- 닉네임 정규화·해시 일치 (앱·서버 같은 결과)

**실기기 테스트 (체크리스트)**
- [ ] 안드로이드 / 아이폰(홈 화면 추가) 각각 테스트 알림 수신
- [ ] 앱 종료 + 화면 잠금 상태에서 순번 변경 알림 수신
- [ ] PC 꺼진 상태에서 동작 (서버 감시라 무관함을 확인)
- [ ] 비행기 모드 후 복귀 시 지난 알림 처리 (TTL 만료분 미수신 정상)
- [ ] 감시 중지 후 실제로 알림이 멈추는지 (서버 작업 삭제 확인)
- [ ] 중복 알림 없음
- [ ] 서버 저장소에 평문 닉네임·쿠키·개인정보 없음 (DO 저장 내용 덤프로 확인)

---

## 8. 확정된 결정 (2026-11-16)

| 항목 | 결정 |
|---|---|
| 휴대폰 | 안드로이드 (크롬) — iOS 제약은 고려하지 않음 |
| 배포 | 사용자 Cloudflare 계정, 무료 플랜으로 시작 |
| 프레임워크 | Vite + React + TypeScript, Worker 하나로 화면·API 제공 (`@cloudflare/vite-plugin`) |
| 화면 폭 | 모바일 폭 전용 (최대 480px, PC 에서도 가운데 같은 폭) |
| 아이콘 | lucide (`lucide-react`) |
| 이모지 | Tossface — `public/fonts/tossface` 에 내려받아 사이트 안에서 제공. 숫자·`#`·`*` 는 글꼴 범위에서 빼서 이모지로 보이지 않음 (`scripts/fetch-tossface.mjs`) |
| 베베픽 | 순서표(`/live/queue`)도 로그인 필요 → 자동 감시 제외. 나나코어만 먼저 진행 |
