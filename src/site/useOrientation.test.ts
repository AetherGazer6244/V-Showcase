/* ============================================================
 * useOrientation — 方向标记组合函数
 * vi.mock 注入测试数据(不依赖仓库里的真实 ORIENTATIONS 内容)
 * ============================================================ */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./orientations', () => ({
  ORIENTATIONS: {
    'https://a/1.jpg': 90,
    'https://b/2.jpg': 180,
    'https://c/3.jpg': 270,
    'https://bad/4.jpg': 45,     // 非法值 → 视同 0
    'https://zero/5.jpg': 0,
  },
}));

import { useOrientation } from './useOrientation';

describe('useOrientation', () => {
  const { orientationOf, orientClass, orientStyle } = useOrientation();

  it('orientationOf:命中 90/180/270,其余(0/缺失/非法)回 0', () => {
    expect(orientationOf('https://a/1.jpg')).toBe(90);
    expect(orientationOf('https://b/2.jpg')).toBe(180);
    expect(orientationOf('https://c/3.jpg')).toBe(270);
    expect(orientationOf('https://zero/5.jpg')).toBe(0);
    expect(orientationOf('https://bad/4.jpg')).toBe(0);
    expect(orientationOf('https://missing.jpg')).toBe(0);
  });

  it('orientClass:非 0 返回 orient-N,0 返回空串', () => {
    expect(orientClass('https://a/1.jpg')).toBe('orient-90');
    expect(orientClass('https://bad/4.jpg')).toBe('');
    expect(orientClass('https://missing.jpg')).toBe('');
  });

  it('orientStyle:输出 --rot 角度变量', () => {
    expect(orientStyle('https://a/1.jpg')).toEqual({ '--rot': '90deg' });
    expect(orientStyle('https://missing.jpg')).toEqual({ '--rot': '0deg' });
  });
});
