/* ============================================================
 * Cloudflare Pages Function — 站长统计(仅站长)
 * ------------------------------------------------------------
 * 路由:/api/stats(目录即路由:functions/api/stats.js)
 *
 *   GET  返回访问趋势与点赞排行(仅站长)
 *        请求头需带 x-owner-key = env.OWNER_PASSWORD
 *        → { status: true, data: { totals, daily, likes } }
 *
 * 为什么单独一把锁(2026-11 设计):
 *   全站密码是「进站的门」——进站的朋友都是被邀请的访客。
 *   统计是站长自己的经营数据(访问量、哪张图最受欢迎),
 *   不该让访客看到,所以再加一把 OWNER_PASSWORD:
 *     · 与 SITE_PASSWORD 独立,改一个不影响另一个
 *     · 不进 cookie、不签会话,只在请求头里带
 *     · 恒时比较(复用 lib/auth.js timingSafeEqualStr)
 *   fail-closed:OWNER_PASSWORD 没配 → 503 明确报错,不放行。
 *
 * 数据来源(只读,不改表结构):
 *   daily_stats(day, pv, uv) → 趋势与总计
 *   likes(url, count)        → 点赞排行
 * ============================================================ */

import { timingSafeEqualStr } from '../lib/auth.js';

/** 趋势天数:近 30 天 */
const TREND_DAYS = 30;
/** 点赞排行条数 */
const TOP_LIKES = 10;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return json(405, { status: false, message: 'Method Not Allowed', data: {} }, { Allow: 'GET' });
  }

  const ownerPassword = env.OWNER_PASSWORD;
  if (!ownerPassword) {
    // fail-closed:没配就明确报错,绝不退化成「谁都能看」
    return json(503, {
      status: false,
      message: '未配置站长密码(OWNER_PASSWORD),请联系站长在 Cloudflare 后台配置',
      data: {},
    });
  }

  const key = request.headers.get('x-owner-key') || '';
  if (!(await timingSafeEqualStr(ownerPassword, key))) {
    return json(401, { status: false, message: '站长密码不正确', data: {} });
  }

  const db = env.DB;
  if (!db) return json(200, { status: false, message: '未绑定 D1 数据库', data: {} });

  try {
    const today = new Date().toISOString().slice(0, 10);
    // 一次 batch 拿全:总计数 / 近 30 天 / 今天 / 点赞 Top10
    const [sum, trend, todayRow, likes] = await db.batch([
      db.prepare('SELECT COALESCE(SUM(pv), 0) AS pv, COALESCE(SUM(uv), 0) AS uv FROM daily_stats'),
      db.prepare('SELECT day, pv, uv FROM daily_stats ORDER BY day DESC LIMIT ?1').bind(TREND_DAYS),
      db.prepare('SELECT pv, uv FROM daily_stats WHERE day = ?1').bind(today),
      db.prepare('SELECT url, count FROM likes ORDER BY count DESC LIMIT ?1').bind(TOP_LIKES),
    ]);

    const s = row(sum, 0);
    const t = row(todayRow, 0);
    const days = (trend.results || [])
      .map((r) => ({ day: String(r.day || ''), pv: num(r.pv), uv: num(r.uv) }))
      .filter((d) => d.day)
      .reverse();   // SQL 是倒序(取最近 30 天),图表要正序(左旧右新)

    return json(200, {
      status: true,
      data: {
        totals: {
          pv: num(s.pv),
          uv: num(s.uv),
          today: { pv: num(t.pv), uv: num(t.uv) },
        },
        daily: days,
        likes: (likes.results || []).map((r) => ({ url: String(r.url || ''), count: num(r.count) })),
      },
    });
  } catch (err) {
    return json(500, { status: false, message: '统计读取失败:' + errMsg(err), data: {} });
  }
}

/* ---------- 小工具 ---------- */

function json(status, obj, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(extraHeaders || {}) },
  });
}

/** batch 结果的第 0 行(没有就返回空对象) */
function row(batchResult, index) {
  return (batchResult.results && batchResult.results[index]) || {};
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function errMsg(err) {
  return err && err.message ? err.message : String(err);
}
