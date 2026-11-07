/* ============================================================
 * Cloudflare Pages Function — 登出(GET /api/logout)
 * ------------------------------------------------------------
 * 清掉会话 cookie 后回首页:middleware 发现无有效会话 → 登录页,
 * 登录页识别 ?logout=1 显示「已退出登录」。
 * 入口:站点底部胶囊「退出」链接(site App.vue footer)。
 * ============================================================ */

import { clearSessionCookieHeader } from '../lib/auth.js';

export async function onRequestGet() {
  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': clearSessionCookieHeader(),
      Location: '/?logout=1',
      'Cache-Control': 'no-store',
    },
  });
}
