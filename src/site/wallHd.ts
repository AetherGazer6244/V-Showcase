/* ============================================================
 * 主页墙「闲时升级原画」— 纯逻辑(便于单测,无 DOM 依赖)
 * ------------------------------------------------------------
 * 墙先用 600w 缩略图开屏(快、省流量);就绪后按「流量允许」的
 * 前提,只对真正出现在屏幕上的卡片一张一张预载原图,载好即换
 * (原图进了浏览器缓存,换 src 不闪不卡,之后点灯箱看大图也是秒开)。
 *
 * 判定与选择逻辑放这里;DOM 编排(观察/预载/队列)在 HomeView。
 * ============================================================ */

/** Network Information API 的最小形状
 *  (Chromium/Android 有;Firefox/Safari 没有 → 检测不到时按允许处理) */
export interface ConnInfo {
  saveData?: boolean;
  effectiveType?: string;
}

/** 原图预载超时(ms):超过就当这张失败,继续下一张,别把队列卡死 */
export const HD_PRELOAD_TIMEOUT_MS = 15000;

/** 单次会话最多升级多少张:墙会一直循环,不加上限等于把整个图库
 *  都下成原图(几百张 × 几 MB)。这是「有多余流量就上原画」的兜底闸门。 */
export const HD_MAX_UPGRADES = 80;

/** 是否允许升级成原画
 *  - 省流模式(saveData)开着 → 不升级
 *  - 网络是 2g / slow-2g → 不升级(原图动辄几 MB,2G 扛不住)
 *  - 检测不到(浏览器没这 API)→ 允许(桌面端基本都是宽带/Wi-Fi) */
export function shouldUpgradeHd(conn?: ConnInfo | null): boolean {
  if (!conn) return true;
  if (conn.saveData === true) return false;
  const t = (conn.effectiveType || '').toLowerCase();
  if (t === 'slow-2g' || t === '2g') return false;
  return true;
}

/** 这张图值不值得升级:图床没生成缩略图时 url === thumb,本来就是原画 */
export function needsHdUpgrade(url: string, thumb: string): boolean {
  return !!url && !!thumb && url !== thumb;
}

/** 该显示哪张:已升级 → 原图;否则缩略图;坏图回退地址优先 */
export function pickHdSrc(
  url: string,
  thumb: string,
  hdReady: boolean,
  override?: string,
): string {
  if (override) return override;
  return hdReady ? url : thumb;
}
