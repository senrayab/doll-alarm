# 순번 알리미 (doll-alarm)

대기 순번이 바뀌거나 내 차례가 오면 휴대폰으로 푸시 알림을 보내는 개인용 PWA.
감시는 Cloudflare Worker 가 하므로 앱을 끄거나 화면을 잠가도 알림이 온다.

- 기술 검증: [docs/01-기술검증보고서.md](docs/01-기술검증보고서.md)
- 개발 계획: [docs/02-MVP-개발계획.md](docs/02-MVP-개발계획.md)

## 명령

| 명령 | 내용 |
|---|---|
| `npm run dev` | 로컬 개발 서버 (http://localhost:5173) — 화면 + Worker API |
| `npm test` | 단위 테스트 |
| `npm run build` | 타입 검사 + 빌드 |
| `npm run deploy` | 빌드 후 Cloudflare 배포 |
| `npm run vapid` | VAPID 키 생성 (처음 한 번) |

## 처음 설정

1. `npm install` 후 `npm run cf-typegen` (Worker 타입 파일 생성)
2. `npm run vapid` → 공개키는 `wrangler.jsonc`, 개인키는 `.dev.vars` (커밋 안 됨)
3. 배포 전: `npx wrangler login`, `npx wrangler secret put VAPID_PRIVATE_KEY` (값은 `.dev.vars`)
