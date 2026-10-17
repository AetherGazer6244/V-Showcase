/* ============================================================
 * useOrientation — 图片方向标记
 * ------------------------------------------------------------
 * 图床转存剥 EXIF,少数图片横躺存储;ORIENTATIONS 记录
 * 「显示时应旋转的角度」,站点渲染时转正。
 * ★ 键约定:ORIENTATIONS 的键 = Image.url(原图直链)。
 * ============================================================ */
import type { CSSProperties } from 'vue';
import { ORIENTATIONS } from './orientations';

export type Orientation = 0 | 90 | 180 | 270;

export function useOrientation() {
  const store = ORIENTATIONS as Record<string, number>;

  /** 该图的显示旋转角;缺失/非法值一律 0(不旋转) */
  function orientationOf(url: string): Orientation {
    const v = store[url];
    return v === 90 || v === 180 || v === 270 ? v : 0;
  }

  /** 给定图片的旋转类名;0 度返回空串 */
  function orientClass(url: string): string {
    const v = orientationOf(url);
    return v ? `orient-${v}` : '';
  }

  /** --rot 变量(Ken Burns / 常规 transform 组合旋转用) */
  function orientStyle(url: string): CSSProperties {
    return { '--rot': orientationOf(url) + 'deg' } as CSSProperties;
  }

  return { orientationOf, orientClass, orientStyle };
}
