/* ============================================================
 * 胶囊位置 — 按「视口比例」记忆
 * ------------------------------------------------------------
 * 背景:浏览器缩放会改变视口的 CSS 像素尺寸
 *      (1920×1080 @100% → 1280×720 @150%)。
 *      位置若存「距屏幕左上角多少像素」这种绝对坐标,缩放后会:
 *        ① 跑到屏幕外,被夹回边上 —— 看起来位置突变
 *        ② 来回缩放几次后一步步往角落漂,原来放的地方找不回
 * 方案:改存「视口比例」(0~1 的小数)。缩放/改窗口大小时按比例还原,
 *      胶囊永远待在屏幕同一个相对位置,不再跑。
 *
 * 旧数据(v1:绝对像素 {x,y})在读取时按当前视口换算成比例,自动兼容。
 * ============================================================ */

/** 视口比例:x/y 方向各占视口的百分之几(0~1) */
export interface CapsuleFraction {
  fx: number;
  fy: number;
}

/** localStorage 键(与 v1 相同,格式升级由 parseCapsulePos 兼容) */
export const CAPSULE_POS_KEY = 'vshowcase.capsule-pos';

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** 像素坐标 → 视口比例(视口尺寸为 0 时按 0 处理,避免除零/NaN) */
export function toFraction(x: number, y: number, vw: number, vh: number): CapsuleFraction {
  return {
    fx: vw > 0 ? clamp01(x / vw) : 0,
    fy: vh > 0 ? clamp01(y / vh) : 0,
  };
}

/** 视口比例 → 像素坐标 */
export function fromFraction(f: CapsuleFraction, vw: number, vh: number): { x: number; y: number } {
  return { x: f.fx * vw, y: f.fy * vh };
}

/**
 * 解析 localStorage 里的胶囊位置。
 *   v2 新格式 {fx, fy} — 视口比例,直接用
 *   v1 老格式 {x, y}  — 绝对像素,按当前视口换算成比例(一次性近似迁移)
 * @param raw localStorage 原始字符串
 * @param vw 当前视口宽(innerWidth)
 * @param vh 当前视口高(innerHeight)
 * @returns 解析不出返回 null(首访 → 走 CSS 默认停靠点)
 */
export function parseCapsulePos(
  raw: string | null,
  vw: number,
  vh: number,
): CapsuleFraction | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null; // 坏数据当首访
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;

  // ⚠️ 必须先判类型再用 Number() 转换:
  //    Number(null) === 0、Number('') === 0、Number([]) === 0,
  //    这些坏值会被当成合法的 0 比例,把胶囊丢到屏幕左上角。
  const fx = o.fx;
  const fy = o.fy;
  if (typeof fx === 'number' && typeof fy === 'number' && Number.isFinite(fx) && Number.isFinite(fy)) {
    return { fx: clamp01(fx), fy: clamp01(fy) };
  }

  // v1 兼容:绝对像素 → 比例
  const x = o.x;
  const y = o.y;
  if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
    return toFraction(x, y, vw, vh);
  }
  return null;
}

/** 比例 → 存储字符串 */
export function serializeCapsulePos(f: CapsuleFraction): string {
  return JSON.stringify({ fx: f.fx, fy: f.fy });
}
