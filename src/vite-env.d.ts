/// <reference types="vite/client" />

/** 배포마다 바뀌는 빌드 번호 (vite.config.ts) */
declare const __BUILD_ID__: string;
/** changelog.json 맨 위 버전 */
declare const __APP_VERSION__: string;
