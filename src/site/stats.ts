/* ============================================================
 * 站长统计 —— 数据取用与清洗(纯逻辑,不含 UI)
 * ------------------------------------------------------------
 * 取数:/api/stats,请求头带 x-owner-key(站长密码)
 * 存储:站长密码只放在 sessionStorage(关标签页即失效),
 *       绝不入 localStorage(那是访客偏好,会被别的脚本读到)
 * ============================================================ */

export interface StatsDaily {
  /** UTC 日期 'YYYY-MM-DD' */
  day: string;
  /** 页面访问次数 */
  pv: number;
  /** 独立访客数 */
  uv: number;
}

export interface StatsLikes {
  /** 图片直链 */
  url: string;
  /** 点赞数 */
  count: number;
}

export interface StatsTotals {
  pv: number;
  uv: number;
  today: { pv: number; uv: number };
}

export interface StatsData {
  totals: StatsTotals;
  daily: StatsDaily[];
  likes: StatsLikes[];
}

/** 站长密码在 sessionStorage 的键 */
export const OWNER_KEY_STORAGE = 'vshowcase.owner-key';

/** 接口报错(带 HTTP 状态,便于页面区分「密码错」和「没配置」) */
export class StatsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'StatsError';
    this.status = status;
  }
}

function toCount(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 把后端返回的任意结构洗成规整数据(缺字段/脏类型都不会让页面崩) */
export function sanitizeStats(raw: unknown): StatsData {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const totals = (o.totals && typeof o.totals === 'object' ? o.totals : {}) as Record<string, unknown>;
  const today = (totals.today && typeof totals.today === 'object' ? totals.today : {}) as Record<string, unknown>;

  const daily: StatsDaily[] = Array.isArray(o.daily)
    ? o.daily
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
        .map((d) => ({ day: String(d.day || ''), pv: toCount(d.pv), uv: toCount(d.uv) }))
        .filter((d) => d.day)
    : [];

  const likes: StatsLikes[] = Array.isArray(o.likes)
    ? o.likes
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) => ({ url: String(l.url || ''), count: toCount(l.count) }))
        .filter((l) => l.url)
    : [];

  return {
    totals: {
      pv: toCount(totals.pv),
      uv: toCount(totals.uv),
      today: { pv: toCount(today.pv), uv: toCount(today.uv) },
    },
    daily,
    likes,
  };
}

/** 拉统计数据;失败抛 StatsError(带状态码) */
export async function fetchStats(ownerKey: string): Promise<StatsData> {
  let res: Response;
  try {
    res = await fetch('/api/stats', { headers: { 'x-owner-key': ownerKey } });
  } catch {
    throw new StatsError('网络异常,请稍后重试', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!res.ok) {
    throw new StatsError(String(o.message || `请求失败(${res.status})`), res.status);
  }
  if (!o.status) {
    throw new StatsError(String(o.message || '统计数据不可用'), res.status);
  }
  return sanitizeStats(o.data);
}

/* ---------- 图表刻度(纯计算,方便单测) ---------- */

export interface ChartBar {
  day: string;
  pv: number;
  uv: number;
  /** 柱高比例 0~1(PV 柱) */
  pvH: number;
  /** 柱高比例 0~1(UV 柱) */
  uvH: number;
}

export interface ChartScale {
  /** 峰值(PV/UV 共用同一刻度,两列才可比) */
  max: number;
  bars: ChartBar[];
}

/**
 * 趋势图刻度:PV 与 UV 共用同一 max,两列高度才具可比性。
 * 全 0 时 max 兜底为 1,避免除零。
 */
export function chartScale(daily: StatsDaily[]): ChartScale {
  const max = daily.reduce((m, d) => Math.max(m, d.pv, d.uv), 0);
  const scale = max > 0 ? max : 1;
  return {
    max,
    bars: daily.map((d) => ({
      day: d.day,
      pv: d.pv,
      uv: d.uv,
      pvH: d.pv / scale,
      uvH: d.uv / scale,
    })),
  };
}

/* ---------- 站长密码存取(sessionStorage) ---------- */

function safeSession(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;   // 隐私模式等场景下访问会抛错
  }
}

export function loadOwnerKey(): string {
  try {
    return safeSession()?.getItem(OWNER_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function saveOwnerKey(key: string): void {
  try {
    safeSession()?.setItem(OWNER_KEY_STORAGE, key);
  } catch {
    /* 存不下就算了:下次再输一次 */
  }
}

export function clearOwnerKey(): void {
  try {
    safeSession()?.removeItem(OWNER_KEY_STORAGE);
  } catch {
    /* 忽略 */
  }
}
