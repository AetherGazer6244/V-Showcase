/* ============================================================
 * 胶囊位置(视口比例)—— 纯函数测试
 * ------------------------------------------------------------
 * 覆盖:比例换算 / v1 绝对像素兼容 / 坏数据兜底
 * ============================================================ */
import { describe, it, expect } from 'vitest';

import {
  toFraction,
  fromFraction,
  parseCapsulePos,
  serializeCapsulePos,
} from './capsulePos';

describe('toFraction / fromFraction', () => {
  it('像素 → 比例 → 像素 可还原', () => {
    const f = toFraction(960, 540, 1920, 1080);
    expect(f.fx).toBeCloseTo(0.5);
    expect(f.fy).toBeCloseTo(0.5);
    const back = fromFraction(f, 1920, 1080);
    expect(back.x).toBeCloseTo(960);
    expect(back.y).toBeCloseTo(540);
  });

  it('缩放后比例不变 → 相对位置不漂移(本 bug 的核心)', () => {
    const f = toFraction(1696, 1000, 1920, 1080);   // 100% 缩放,右下角附近
    const at150 = fromFraction(f, 1280, 720);       // 150% 缩放 → 视口变小
    expect(at150.x / 1280).toBeCloseTo(f.fx);
    expect(at150.y / 720).toBeCloseTo(f.fy);
    const back100 = fromFraction(f, 1920, 1080);    // 再缩回 100%
    expect(back100.x).toBeCloseTo(1696);
    expect(back100.y).toBeCloseTo(1000);
  });

  it('越界坐标夹到 0~1', () => {
    expect(toFraction(-50, 99999, 1920, 1080)).toEqual({ fx: 0, fy: 1 });
  });

  it('视口尺寸为 0 不产生 NaN', () => {
    const f = toFraction(100, 100, 0, 0);
    expect(Number.isFinite(f.fx)).toBe(true);
    expect(Number.isFinite(f.fy)).toBe(true);
  });
});

describe('parseCapsulePos', () => {
  it('v2 新格式(视口比例)直接读出', () => {
    const f = parseCapsulePos(JSON.stringify({ fx: 0.25, fy: 0.75 }), 1920, 1080);
    expect(f).toEqual({ fx: 0.25, fy: 0.75 });
  });

  it('v1 老格式(绝对像素)按当前视口换算成比例', () => {
    const f = parseCapsulePos(JSON.stringify({ x: 960, y: 540 }), 1920, 1080);
    expect(f?.fx).toBeCloseTo(0.5);
    expect(f?.fy).toBeCloseTo(0.5);
  });

  it('v1 老格式在缩放后仍落在屏幕内(比例被夹到 0~1)', () => {
    const f = parseCapsulePos(JSON.stringify({ x: 1696, y: 1000 }), 1280, 720);
    expect(f?.fx).toBeLessThanOrEqual(1);
    expect(f?.fy).toBeLessThanOrEqual(1);
  });

  it('坏数据 / 空值 → null(首访走 CSS 默认停靠)', () => {
    expect(parseCapsulePos(null, 1920, 1080)).toBeNull();
    expect(parseCapsulePos('not-json', 1920, 1080)).toBeNull();
    expect(parseCapsulePos('[]', 1920, 1080)).toBeNull();
    expect(parseCapsulePos(JSON.stringify({ x: 'a', y: null }), 1920, 1080)).toBeNull();
    // null/空串会被 Number() 变成 0,必须先判类型再转换
    expect(parseCapsulePos(JSON.stringify({ fx: null, fy: 0.5 }), 1920, 1080)).toBeNull();
    expect(parseCapsulePos(JSON.stringify({ fx: '', fy: 0.5 }), 1920, 1080)).toBeNull();
    expect(parseCapsulePos(JSON.stringify({ fx: NaN, fy: 0.5 }), 1920, 1080)).toBeNull();
  });
});

describe('serializeCapsulePos', () => {
  it('写出 v2 格式并能读回(往返一致)', () => {
    const raw = serializeCapsulePos({ fx: 0.1, fy: 0.9 });
    expect(JSON.parse(raw)).toEqual({ fx: 0.1, fy: 0.9 });
    expect(parseCapsulePos(raw, 1920, 1080)).toEqual({ fx: 0.1, fy: 0.9 });
  });
});
