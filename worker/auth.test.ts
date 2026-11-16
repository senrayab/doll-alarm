import { describe, expect, it } from 'vitest';
import { checkAccessCode, normalizeCode } from './auth';

describe('접속 코드', () => {
  it('대소문자·하이픈·공백 무시', async () => {
    expect(normalizeCode(' ab3d-efgh-jk2m ')).toBe('AB3DEFGHJK2M');
    expect(await checkAccessCode('ab3d efgh jk2m', 'AB3D-EFGH-JK2M')).toBe(true);
  });
  it('틀리거나 없으면 거부', async () => {
    expect(await checkAccessCode('AB3D-EFGH-JK2N', 'AB3D-EFGH-JK2M')).toBe(false);
    expect(await checkAccessCode(null, 'AB3D-EFGH-JK2M')).toBe(false);
    expect(await checkAccessCode('', 'AB3D-EFGH-JK2M')).toBe(false);
    expect(await checkAccessCode('AB3D-EFGH-JK2M', undefined)).toBe(false);
  });
});
