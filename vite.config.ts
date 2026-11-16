import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** 배포마다 바뀌는 빌드 번호 + 최신 변경 내용 (changelog.json 맨 위) */
const BUILD_ID = Date.now().toString(36);
const [latest] = JSON.parse(readFileSync('changelog.json', 'utf8')) as { version: string; notes: string[] }[];

/** 화면 쪽 빌드에 version.json 을 함께 내보냄 — 앱이 이걸로 새 버전을 알아챔 */
function appVersion(): Plugin {
  const body = () => JSON.stringify({ build: BUILD_ID, version: latest.version, notes: latest.notes });
  return {
    name: 'app-version',
    applyToEnvironment: (env) => env.name === 'client',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: body() });
    },
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(body());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), appVersion()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __APP_VERSION__: JSON.stringify(latest.version),
  },
  server: { host: true },
});
