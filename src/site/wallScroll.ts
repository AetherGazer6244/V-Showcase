/* ============================================================
 * 流动墙「真滚动」—— 纯函数集(便于单测,无 Vue/DOM 依赖)
 * ------------------------------------------------------------
 * v2.15:流动墙不再用 CSS transform 搬整行,改成浏览器真滚动
 * (scrollLeft)。
 *
 * 为什么换(用户反馈「滑动时模糊太严重」):
 *   旧做法 = 把整行当成一张大照片,靠 transform 动画搬。
 *   显卡只对整个图层栅格化一次,之后每帧把缓存的位图挪到
 *   (常常是)半像素位置 —— 显卡没法把照片画在半个像素上,
 *   只能「猜着画」→ 整行发虚。动画永不停止,永远停在半像素,
 *   于是永远糊。
 *   真滚动按物理像素对齐,浏览器按滚动位置取样 → 始终清晰。
 *
 * 坐标系:
 *   位置 pos ∈ [0, period);period = 一份内容的宽度(像素)。
 *   内容渲染成【至少两份】相同内容,滚到 period 处(= 第二份的起点)
 *   看到的画面与起点完全一致 → 回卷无缝。
 *   pos 增大 = 内容向左走(scrollLeft 增大)。
 * ============================================================ */

/** 行内相邻卡片的横向间距(与 styles/wall.css 的 --row-gap 一致) */
export const ROW_GAP = 16;

/**
 * 一份内容的宽度(px):卡片数 × (卡宽 + 间距)。
 * 非法输入(0 张卡 / 非法宽度)→ 0。
 */
export function contentWidth(cardCount: number, cardWidth: number, gap: number = ROW_GAP): number {
  if (!Number.isFinite(cardCount) || cardCount <= 0) return 0;
  const cell = Math.max(1, (Number.isFinite(cardWidth) ? cardWidth : 0) + (Number.isFinite(gap) ? gap : 0));
  return cardCount * cell;
}

/**
 * 需要渲染几份内容,才能让「滚动周期」覆盖视口。
 *
 * 内容重复的间隔 = 一份的宽度 W1 = 滚动周期 period。
 * 浏览器可滚动范围 = 总宽 - 视口宽 = 份数×W1 - 视口宽,
 * 要让回卷点(period = W1)落在范围内,必须:
 *     份数×W1 - 视口宽 ≥ W1  ⇔  (份数-1)×W1 ≥ 视口宽
 * 否则回卷点不可达(会被浏览器夹住 → 到点卡住/露白)。
 * 至少 2 份:滚到第二份才看得到同样的画面 → 回卷无缝。
 * 留一个单元格的余量,兜住实际渲染宽度与估算值的细微出入。
 */
export function copiesForViewport(
  cardCount: number,
  cardWidth: number,
  viewportW: number,
  gap: number = ROW_GAP,
): number {
  const w1 = contentWidth(cardCount, cardWidth, gap);
  if (w1 <= 0) return 2;
  const cell = Math.max(1, (Number.isFinite(cardWidth) ? cardWidth : 0) + (Number.isFinite(gap) ? gap : 0));
  const vw = Number.isFinite(viewportW) ? Math.max(0, viewportW) : 0;
  const need = Math.ceil((vw + cell) / w1) + 1;
  return Math.max(2, need);
}

/** 位置归一化到 [0, period);非法输入 → 0 */
export function wrapPos(pos: number, period: number): number {
  if (!Number.isFinite(period) || period <= 0) return 0;
  if (!Number.isFinite(pos)) return 0;
  let p = pos % period;
  if (p < 0) p += period;
  return p;
}

/**
 * 自动流动一步。
 * dir: +1 内容向左走(scrollLeft 增大),-1 内容向右走。
 */
export function flowPos(
  pos: number,
  period: number,
  dir: number,
  pxPerSec: number,
  dtMs: number,
): number {
  if (!Number.isFinite(pxPerSec) || !Number.isFinite(dtMs)) return wrapPos(pos, period);
  const delta = (pxPerSec * dtMs) / 1000;
  return wrapPos(pos + (dir < 0 ? -delta : delta), period);
}

/** 拖拽一步:手指右移 dx px → 内容跟着右移 → 滚动位置左移 */
export function dragPos(pos: number, period: number, dx: number): number {
  if (!Number.isFinite(dx)) return wrapPos(pos, period);
  return wrapPos(pos - dx, period);
}

/** 惯性一步(与拖拽同向:内容跟着手指走) */
export function flingPos(pos: number, period: number, dx: number): number {
  return dragPos(pos, period, dx);
}

/**
 * 一行走完一个内容周期所需时长(秒)。
 * 与旧 CSS 动画时长口径一致((40 + 行序×6) / 流速倍率),
 * 改这里等于改墙的流速观感。
 */
export function flowDurationSec(rowIndex: number, speed: number): number {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const r = Number.isFinite(rowIndex) && rowIndex > 0 ? rowIndex : 0;
  return (40 + r * 6) / s;
}

/** 由「周期 + 周期时长」算出线速度(px/秒) */
export function periodSpeed(periodPx: number, durationSec: number): number {
  if (!Number.isFinite(periodPx) || periodPx <= 0) return 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return periodPx / durationSec;
}
