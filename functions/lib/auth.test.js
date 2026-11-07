// @vitest-environment node
/* ============================================================
 * functions/lib/auth.js 单测 —— 密码登录会话签名体系
 * node 环境:Workers WebCrypto 在 Node 18+ 由 globalThis.crypto 提供
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import {
  signSession,
  verifySession,
  timingSafeEqualStr,
  readCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
  SESSION_COOKIE,
} from './auth.js';

const SECRET = 'test-secret-password';
const DAY = 24 * 60 * 60 * 1000;

describe('signSession / verifySession 往返', () => {
  it('正确签发并验证', async () => {
    const token = await signSession(SECRET, Date.now() + DAY);
    expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    await expect(verifySession(SECRET, token)).resolves.toBe(true);
  });

  it('过期令牌被拒', async () => {
    const token = await signSession(SECRET, Date.now() - 1);
    await expect(verifySession(SECRET, token)).resolves.toBe(false);
  });

  it('篡改过期时间被拒(签名对不上)', async () => {
    const token = await signSession(SECRET, Date.now() + DAY);
    const forged = token.replace(/^\d+/, String(Date.now() + 2 * DAY));
    await expect(verifySession(SECRET, forged)).resolves.toBe(false);
  });

  it('换密钥(改密码)后旧会话失效 —— 全员下线语义', async () => {
    const token = await signSession('old-password', Date.now() + DAY);
    await expect(verifySession('new-password', token)).resolves.toBe(false);
  });

  it('垃圾输入一律 false 而不是抛错', async () => {
    await expect(verifySession(SECRET, '')).resolves.toBe(false);
    await expect(verifySession(SECRET, 'garbage')).resolves.toBe(false);
    await expect(verifySession(SECRET, '.abc')).resolves.toBe(false);
    await expect(verifySession(SECRET, 'notanumber.sig')).resolves.toBe(false);
    await expect(verifySession(SECRET, null)).resolves.toBe(false);
  });
});

describe('timingSafeEqualStr 恒时比较', () => {
  it('相同为真,不同为假,长度差异也不抛错', async () => {
    await expect(timingSafeEqualStr('abc', 'abc')).resolves.toBe(true);
    await expect(timingSafeEqualStr('abc', 'abd')).resolves.toBe(false);
    await expect(timingSafeEqualStr('abc', 'abcdef')).resolves.toBe(false);
    await expect(timingSafeEqualStr('', '')).resolves.toBe(true);
  });
});

describe('readCookie 解析', () => {
  it('多个 cookie / 带空格 / 缺失', () => {
    const header = 'a=1; vs_session=tok123;  b = xyz ';
    expect(readCookie(header, 'vs_session')).toBe('tok123');
    expect(readCookie(header, 'b')).toBe('xyz');
    expect(readCookie(header, 'missing')).toBeNull();
    expect(readCookie(null, 'vs_session')).toBeNull();
  });
});

describe('cookie 头构造', () => {
  it('签发头带安全属性与 30 天有效期', () => {
    const h = sessionCookieHeader('tok');
    expect(h).toContain(`${SESSION_COOKIE}=tok`);
    expect(h).toContain('HttpOnly');
    expect(h).toContain('Secure');
    expect(h).toContain('SameSite=Lax');
    expect(h).toContain('Max-Age=' + 30 * 24 * 60 * 60);
  });
  it('清除头 Max-Age=0', () => {
    expect(clearSessionCookieHeader()).toContain('Max-Age=0');
  });
});
