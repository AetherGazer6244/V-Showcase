/* ============================================================
 * Cloudflare Pages Function — 登录接口(POST /api/login)
 * ------------------------------------------------------------
 * 被根 _middleware.js 白名单放行,校验通过后签发 30 天签名会话 cookie。
 *
 * 反暴力穷举(2026-11 方案评审定案,勿回退):
 *   1. 密码恒时比较(见 lib/auth.js timingSafeEqualStr)
 *   2. 失败响应固定延迟 1s —— 不影响正确密码的体感,专拖穷举吞吐
 *   3. README 建议 CF 免费版 WAF 限流规则(10 次/分钟/IP)兜底
 * ============================================================ */

import {
  signSession,
  timingSafeEqualStr,
  sessionCookieHeader,
  SESSION_MAX_AGE_SECONDS,
} from '../lib/auth.js';

export async function onRequestPost({ request, env }) {
  const password = env.SITE_PASSWORD;
  if (!password) {
    return json(503, { status: false, message: '站点未配置密码(SITE_PASSWORD)' });
  }

  let body = null;
  try { body = await request.json(); } catch { /* 非法载荷按空处理 */ }
  const candidate = body && typeof body.password === 'string' ? body.password : '';

  if (!(await timingSafeEqualStr(password, candidate))) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return json(401, { status: false, message: '密码不正确' });
  }

  const token = await signSession(password, Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  return json(200, { status: true, message: '登录成功' }, { 'Set-Cookie': sessionCookieHeader(token) });
}

function json(status, obj, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, extraHeaders || {}),
  });
}
