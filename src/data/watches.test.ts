import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../db/local', () => ({}));
vi.mock('../db/inbox', () => ({}));
vi.mock('./events', () => ({ emit: vi.fn() }));
import type { Watch } from '../db/local';
import { watchTone } from './watches';

const w = (running: boolean, last: object | null): Watch =>
  ({
    id: 'x', siteId: 's', moduleId: 'demo', label: 'a', token: 't', intervalSec: 15, conditions: {}, schedule: null, createdAt: 0,
    view: { moduleId: 'demo', running, intervalSec: 15, schedule: null, conditions: {}, inWindow: true, nextCheckAt: null, lastCheckedAt: null, lastOkAt: null, last, lastError: null, consecutiveErrors: 0, history: [] },
  }) as unknown as Watch;

describe('중지한 모니터링의 오라', () => {
  it('지난 결과가 "내 차례"여도 중지면 쉬는 모습(idle)', () => {
    expect(watchTone(w(false, { found: true, status: 'current', ahead: 0 }))).toBe('idle');
    expect(watchTone(w(false, { found: true, status: 'pending', ahead: 1 }))).toBe('idle');
  });
  it('돌고 있으면 그대로', () => {
    expect(watchTone(w(true, { found: true, status: 'current', ahead: 0 }))).toBe('hot');
    expect(watchTone(w(true, { found: true, status: 'pending', ahead: 4 }))).toBe('near');
  });
});
