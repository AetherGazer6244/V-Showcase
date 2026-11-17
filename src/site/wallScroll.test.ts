/* ============================================================
 * wallScroll 单测 —— 流动墙「真滚动」的纯逻辑
 *   重点:周期/份数计算、回卷不变量、拖拽与惯性方向
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import {
  contentWidth,
  copiesForViewport,
  wrapPos,
  flowPos,
  dragPos,
  flingPos,
  flowDurationSec,
  periodSpeed,
  ROW_GAP,
} from './wallScroll';

describe('contentWidth 一份内容的宽度', () => {
  it('卡片数 × (卡宽 + 间距)', () => {
    expect(contentWidth(10, 300)).toBe(10 * (300 + ROW_GAP));
  });

  it('自定义间距', () => {
    expect(contentWidth(4, 100, 8)).toBe(4 * 108);
  });

  it('0 张卡 / 非法输入 → 0', () => {
    expect(contentWidth(0, 300)).toBe(0);
    expect(contentWidth(-3, 300)).toBe(0);
    expect(contentWidth(NaN, 300)).toBe(0);
  });
});

describe('copiesForViewport 份数计算', () => {
  it('内容足够宽 → 2 份(与旧实现的双份一致)', () => {
    // 10 张卡 × 316 = 3160px,视口 1920 → 两份就够
    expect(copiesForViewport(10, 300, 1920)).toBe(2);
  });

  it('内容窄于视口 → 加份数', () => {
    const n = copiesForViewport(2, 300, 1920);
    expect(n).toBeGreaterThan(2);
  });

  it('份数保证:回卷点(一份宽)落在可滚动范围内', () => {
    for (const [cards, vw] of [[1, 1920], [2, 1920], [3, 800], [7, 3840]] as const) {
      const n = copiesForViewport(cards, 300, vw);
      const w1 = contentWidth(cards, 300);
      // 可滚动范围 = 份数×一份宽 - 视口宽,必须 ≥ 一份宽(回卷点)
      expect(n * w1 - vw).toBeGreaterThanOrEqual(w1);
    }
  });

  it('0 张卡 → 兜底 2 份', () => {
    expect(copiesForViewport(0, 300, 1920)).toBe(2);
  });

  it('非法视口宽 → 2 份', () => {
    expect(copiesForViewport(10, 300, NaN)).toBe(2);
    expect(copiesForViewport(10, 300, 0)).toBe(2);
  });
});

describe('wrapPos 回卷不变量', () => {
  it('落在 [0, period) 内', () => {
    expect(wrapPos(100, 300)).toBe(100);
    expect(wrapPos(300, 300)).toBe(0);
    expect(wrapPos(450, 300)).toBe(150);
    expect(wrapPos(-50, 300)).toBe(250);
  });

  it('非法输入 → 0', () => {
    expect(wrapPos(100, 0)).toBe(0);
    expect(wrapPos(NaN, 300)).toBe(0);
    expect(wrapPos(100, NaN)).toBe(0);
  });

  it('回卷前后画面等价:pos 与 pos+period 归一化后相同', () => {
    const period = 3160;
    for (const p of [0, 1, 999.5, 3159, 3160, 6320]) {
      expect(wrapPos(p, period)).toBeCloseTo(wrapPos(p + period, period), 6);
    }
  });
});

describe('flowPos 自动流动', () => {
  it('dir=+1(内容向左)→ 位置增大', () => {
    expect(flowPos(100, 1000, 1, 100, 1000)).toBe(200);   // 100px/s × 1s
  });

  it('dir=-1(内容向右)→ 位置减小', () => {
    expect(flowPos(100, 1000, -1, 100, 1000)).toBe(0);
  });

  it('越过周期 → 回卷到区间内', () => {
    const next = flowPos(950, 1000, 1, 100, 1000);
    expect(next).toBe(50);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(1000);
  });

  it('非法速度/时长 → 位置不变(只回卷)', () => {
    expect(flowPos(120, 1000, 1, NaN, 16)).toBe(120);
    expect(flowPos(120, 1000, 1, 100, NaN)).toBe(120);
  });
});

describe('dragPos / flingPos 拖拽与惯性', () => {
  it('手指右移 → 内容右移 → 位置左移', () => {
    expect(dragPos(500, 1000, 30)).toBe(470);
  });

  it('手指左移 → 位置右移', () => {
    expect(dragPos(500, 1000, -30)).toBe(530);
  });

  it('拖出边界 → 回卷(画面连续)', () => {
    expect(dragPos(20, 1000, 50)).toBe(970);
    expect(dragPos(980, 1000, -50)).toBe(30);
  });

  it('flingPos 与 dragPos 同向', () => {
    expect(flingPos(500, 1000, 30)).toBe(dragPos(500, 1000, 30));
  });

  it('非法位移 → 位置不变', () => {
    expect(dragPos(500, 1000, NaN)).toBe(500);
  });
});

describe('flowDurationSec / periodSpeed 流速', () => {
  it('时长口径与旧 CSS 动画一致', () => {
    expect(flowDurationSec(0, 1)).toBe(40);
    expect(flowDurationSec(1, 1)).toBe(46);
    expect(flowDurationSec(2, 1)).toBe(52);
  });

  it('流速倍率线性缩放时长', () => {
    expect(flowDurationSec(0, 2)).toBe(20);
    expect(flowDurationSec(0, 0.5)).toBe(80);
  });

  it('非法流速 → 按 1 算', () => {
    expect(flowDurationSec(0, 0)).toBe(40);
    expect(flowDurationSec(0, NaN)).toBe(40);
  });

  it('线速度 = 周期 / 时长', () => {
    expect(periodSpeed(3160, 40)).toBe(79);
    expect(periodSpeed(0, 40)).toBe(0);
    expect(periodSpeed(3160, 0)).toBe(0);
  });
});
