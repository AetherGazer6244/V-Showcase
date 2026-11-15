// @vitest-environment node
/* ============================================================
 * functions/api/stats.js 单测 —— 站长统计接口
 * ------------------------------------------------------------
 * 重点覆盖「锁」的三种状态:
 *   没配 OWNER_PASSWORD → 503(fail-closed,不能退化成谁都能看)
 *   密码不对           → 401
 *   密码对             → 200 + 正确的统计数据
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import { onRequest } from './stats.js';

const OWNER_PW = 'owner-secret';

/* ---------- 假 D1:按 SQL 关键字分流,不引入真 SQLite ---------- */
function fakeDb(daily, likes) {
  function run(sql, args) {
    if (/SUM\(pv\)/.test(sql)) {
      return { pv: daily.reduce((a, r) => a + r.pv, 0), uv: daily.reduce((a, r) => a + r.uv, 0) };
    }
    if (/ORDER BY day DESC/.test(sql)) {
      const limit = Number(args[0] || daily.length);
      return daily.slice(-limit).reverse();   // SQL:倒序取最近 N
    }
    if (/WHERE day =/.test(sql)) {
      return daily.find((r) => r.day === args[0]) || { pv: 0, uv: 0 };
    }
    if (/FROM likes/.test(sql)) {
      const limit = Number(args[0] || likes.length);
      return likes.slice().sort((a, b) => b.count - a.count).slice(0, limit);
    }
    throw new Error('未预期的 SQL:' + sql);
  }
  return {
    prepare(sql) {
      // 未 bind 的语句也要带 sql/args(与真 D1 一致:bind() 返回新语句)
      return {
        sql,
        args: [],
        bind(...args) {
          return { sql, args };
        },
      };
    },
    async batch(stmts) {
      // 真 D1:batch() 返回【数组】,每项是 { results: [...] }
      return stmts.map((s) => {
        const out = run(s.sql, s.args);
        return { results: Array.isArray(out) ? out : [out] };
      });
    },
  };
}

/**
 * 调一次接口
 * @param {{ method?: string, key?: string | null, env?: Record<string, unknown> }} [opts]
 */
function call({ method = 'GET', key = OWNER_PW, env = {} } = {}) {
  const headers = new Headers();
  if (key !== null) headers.set('x-owner-key', key);
  return onRequest({ request: new Request('https://x/api/stats', { method, headers }), env });
}

const DAILY = [
  { day: '2026-11-01', pv: 10, uv: 4 },
  { day: '2026-11-02', pv: 5, uv: 2 },
  { day: '2026-11-03', pv: 7, uv: 3 },
];
const LIKES = [
  { url: 'https://bu.dusays.com/a.jpg', count: 9 },
  { url: 'https://bu.dusays.com/b.jpg', count: 4 },
];

function envWith(extra = {}) {
  return {
    OWNER_PASSWORD: OWNER_PW,
    DB: fakeDb(DAILY, LIKES),
    ...extra,
  };
}

describe('/api/stats 站长锁', () => {
  it('未配置 OWNER_PASSWORD → 503 且不放行数据', async () => {
    const res = await call({ env: { DB: fakeDb(DAILY, LIKES) } });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe(false);
    expect(body.message).toContain('OWNER_PASSWORD');
    expect(body.data).toEqual({});
  });

  it('站长密码不对 → 401', async () => {
    const res = await call({ key: 'wrong-password', env: envWith() });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.status).toBe(false);
    expect(body.data).toEqual({});
  });

  it('没带 x-owner-key → 401', async () => {
    const res = await call({ key: null, env: envWith() });
    expect(res.status).toBe(401);
  });

  it('非 GET → 405', async () => {
    const res = await call({ method: 'POST', env: envWith() });
    expect(res.status).toBe(405);
  });
});

describe('/api/stats 数据', () => {
  it('密码正确 → 返回总计 / 今日 / 趋势 / 点赞排行', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await call({
      env: envWith({ DB: fakeDb([...DAILY, { day: today, pv: 3, uv: 2 }], LIKES) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe(true);

    const d = body.data;
    expect(d.totals.pv).toBe(10 + 5 + 7 + 3);
    expect(d.totals.uv).toBe(4 + 2 + 3 + 2);
    expect(d.totals.today).toEqual({ pv: 3, uv: 2 });

    // 趋势:正序(左旧右新),且不含今天以外的乱序
    expect(d.daily.map((x) => x.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', today]);
    expect(d.daily[0]).toEqual({ day: '2026-11-01', pv: 10, uv: 4 });

    // 点赞:按数量倒序
    expect(d.likes[0]).toEqual({ url: 'https://bu.dusays.com/a.jpg', count: 9 });
    expect(d.likes[1].count).toBe(4);
  });

  it('未绑定 D1 → status:false,不报错', async () => {
    const res = await call({ env: { OWNER_PASSWORD: OWNER_PW } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe(false);
    expect(body.message).toContain('D1');
  });

  it('空表 → 全 0,不抛错', async () => {
    const res = await call({ env: { OWNER_PASSWORD: OWNER_PW, DB: fakeDb([], []) } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.totals.pv).toBe(0);
    expect(body.data.daily).toEqual([]);
    expect(body.data.likes).toEqual([]);
  });
});
