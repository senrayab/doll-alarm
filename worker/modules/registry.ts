// 사이트 모듈 목록 — 새 사이트는 모듈 파일을 만들고 여기 한 줄 추가
import type { SiteModule } from '../engine/types';
import { demo } from './demo';
import { nanacore } from './nanacore';

const MODULES: Record<string, SiteModule> = {
  [nanacore.id]: nanacore as SiteModule,
  [demo.id]: demo as SiteModule,
};

export function getModule(id: string): SiteModule | undefined {
  return Object.hasOwn(MODULES, id) ? MODULES[id] : undefined;
}
