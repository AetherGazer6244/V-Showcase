/* ============================================================
 * 密码登录共享逻辑(HMAC 签名会话:无状态、零依赖、不需要 D1)
 * ------------------------------------------------------------
 * 会话 cookie 形如:vs_session = `<过期毫秒>.<base64url(HMAC-SHA256)>`
 *
 * 签名密钥 = SITE_PASSWORD 本身 —— 改密码 = 旧签名全部失效 = 全员下线。
 * 刻意【不】引入独立的 AUTH_SECRET:若设了它,改密码后 30 天内的旧会话
 * 依然有效(密钥没变),与「改密码踢人」的直觉相悖(2026-11 方案评审定案)。
 *
 * 恒时比较:先 SHA-256 归一化再逐字节异或累加,不因首个不同字符提前短路,
 * 避免逐字符比较的时序侧信道。
 * 全部使用 Workers WebCrypto 原生能力,零 npm 依赖。
 * ============================================================ */

const SESSION_VERSION = 'v1';
const ENCODER = new TextEncoder();

function toBase64Url(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(SESSION_VERSION + '.' + message));
  return toBase64Url(sig);
}

/** 签发会话令牌:`<过期毫秒>.<签名>` */
export async function signSession(secret, expiresAtMs) {
  return expiresAtMs + '.' + (await hmac(secret, String(expiresAtMs)));
}

/** 校验会话令牌:格式 / 签名 / 有效期三关,任何一关不过即 false */
export async function verifySession(secret, token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expMs = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expMs) || !sig) return false;
  if (Date.now() >= expMs) return false;
  const expected = await hmac(secret, String(expMs));
  return timingSafeEqualStr(expected, sig);
}

/** 恒时字符串比较(先 SHA-256 归一长度,再逐字节异或累加) */
export async function timingSafeEqualStr(a, b) {
  const pair = await Promise.all([
    crypto.subtle.digest('SHA-256', ENCODER.encode(String(a))),
    crypto.subtle.digest('SHA-256', ENCODER.encode(String(b))),
  ]);
  const ba = new Uint8Array(pair[0]);
  const bb = new Uint8Array(pair[1]);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/** 从 Cookie 请求头里读单个键值(找不到返回 null) */
export function readCookie(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export const SESSION_COOKIE = 'vs_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 天免登录

export function sessionCookieHeader(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax`;
}
