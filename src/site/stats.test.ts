/* ============================================================
 * stats.ts 单测 —— 站长统计的数据清洗与图表刻度
 * ============================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeStats,
  chartScale,
  fetchStats,
  StatsError,
  loadOwnerKey,
  saveOwnerKey,
  clearOwnerKey,
  OWNER_KEY_STORAGE,
} from './stats';

describe('sanitizeStats 数据清洗', () => {
  it('正常结构原样保留', () => {
    const out = sanitizeStats({
      totals: { pv: 10, uv: 4, today: { pv: 2, uv: 1 } },
      daily: [{ day: '2026-11-01', pv: 3, uv: 2 }],
      likes: [{ url: 'https://x/a.jpg', count: 5 }],
    });
    expect(out.totals).toEqual({ pv: 10, uv: 4, today: { pv: 2, uv: 1 } });
    expect(out.daily[0]).toEqual({ day: '2026-11-01', pv: 3, uv: 2 });
    expect(out.likes[0]).toEqual({ url: 'https://x/a.jpg', count: 5 });
  });

  it('缺字段/脏类型 → 安全默认值,不抛错', () => {
    const out = sanitizeStats({ totals: { pv: 'x', uv: null, today: 'nope' }, daily: 'x', likes: [null, 3] });
    expect(out.totals.pv).toBe(0);
    expect(out.totals.uv).toBe(0);
    expect(out.totals.today).toEqual({ pv: 0, uv: 0 });
    expect(out.daily).toEqual([]);
    expect(out.likes).toEqual([]);
  });

  it('负数与小数归一到非负整数', () => {
    const out = sanitizeStats({ totals: { pv: -5, uv: 2.7 }, daily: [{ day: 'd', pv: -1, uv: 3.9 }] });
    expect(out.totals.pv).toBe(0);
    expect(out.totals.uv).toBe(2);
    expect(out.daily[0].pv).toBe(0);
    expect(out.daily[0].uv).toBe(3);
  });

  it('null / undefined / 字符串 → 空结构', () => {
    for (const raw of [null, undefined, 'x', 42]) {
      const out = sanitizeStats(raw);
      expect(out.totals.pv).toBe(0);
      expect(out.daily).toEqual([]);
    }
  });
});

describe('chartScale 图表刻度', () => {
  it('PV/UV 共用同一刻度,高度是 0~1 比例', () => {
    const { max, bars } = chartScale([
      { day: 'a', pv: 10, uv: 5 },
      { day: 'b', pv: 4, uv: 8 },
    ]);
    expect(max).toBe(10);
    expect(bars[0].pvH).toBe(1);
    expect(bars[0].uvH).toBe(0.5);
    expect(bars[1].pvH).toBeCloseTo(0.4);
    expect(bars[1].uvH).toBeCloseTo(0.8);
  });

  it('全 0 → max 兜底 1,不出 NaN', () => {
    const { max, bars } = chartScale([{ day: 'a', pv: 0, uv: 0 }]);
    expect(max).toBe(0);
    expect(bars[0].pvH).toBe(0);
    expect(Number.isNaN(bars[0].uvH)).toBe(false);
  });

  it('空数组 → 空柱子', () => {
    expect(chartScale([])).toEqual({ max: 0, bars: [] });
  });
});

describe('fetchStats', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('成功 → 返回清洗后的数据,并带上 x-owner-key 头', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: { totals: { pv: 3, uv: 1, today: { pv: 1, uv: 1 } }, daily: [], likes: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchStats('secret');
    expect(out.totals.pv).toBe(3);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-owner-key']).toBe('secret');
  });

  it('401 → StatsError 带状态码与后端文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ status: false, message: '站长密码不正确' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )));
    await expect(fetchStats('bad')).rejects.toBeInstanceOf(StatsError);
    await expect(fetchStats('bad')).rejects.toMatchObject({ status: 401, message: '站长密码不正确' });
  });

  it('503(没配置站长密码)→ 同样抛 StatsError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ status: false, message: '未配置站长密码(OWNER_PASSWORD)' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )));
    await expect(fetchStats('x')).rejects.toMatchObject({ status: 503 });
  });

  it('网络异常 → StatsError(status 0)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(fetchStats('x')).rejects.toMatchObject({ status: 0 });
  });
});

describe('站长密码存取(sessionStorage)', () => {
  it('存 → 读 → 清', () => {
    saveOwnerKey('abc');
    expect(loadOwnerKey()).toBe('abc');
    expect(window.sessionStorage.getItem(OWNER_KEY_STORAGE)).toBe('abc');
    clearOwnerKey();
    expect(loadOwnerKey()).toBe('');
  });

  it('没有存过 → 空串', () => {
    clearOwnerKey();
    expect(loadOwnerKey()).toBe('');
  });
});
