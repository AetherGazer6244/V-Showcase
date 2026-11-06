/* ============================================================
 * 坏图自愈 — 缩略图加载失败的分级重试链
 * ------------------------------------------------------------
 * 背景:开屏几十张缩略图并发请求图床,浏览器把请求复用在
 * 少数几条 HTTP/2 连接上;某条连接瞬断/被重置时,搭在上面的
 * 几张流会一起失败。此前 @error 只把卡片标记为「已就绪」,
 * 坏图保持灰底直到轮换换掉或刷新,没有任何重试。
 *
 * 自愈链(每一级的 src 都与当前渲染值不同,保证 Vue 真正
 * 改写 src 属性、浏览器重新发起加载):
 *   初始渲染    thumb
 *   第 1 次失败 → thumb?vshowcase_retry=1(换查询串绕开可能被
 *                 污染的 CDN 负缓存 / 复用的坏连接)
 *   第 2 次失败 → url(原图直链,另一域名,独立故障域)
 *   第 3 次失败 → url?vshowcase_retry=2
 *   之后放弃,维持灰底(与旧行为一致)
 *   thumb === url 时(封面/兜底图,thumb 即原图直链),
 *   「换原图」无意义,三级全部用换查询串重试。
 *
 * 使用约定:
 *   - 键 = img.url(原图直链,与 FOCAL_POINTS / ALBUMS / TAGS
 *     的查表键约定一致,见 shared/types.ts)
 *   - 视图在 @error 里先照旧「计入就绪」再 onError —— 链在
 *     后台自愈,绝不拖慢开屏;@load 里调 onLoad 停掉在途重试
 *   - 同一张图在墙上可能渲染两份(无缝循环),两份 <img> 会对
 *     同一 src 各报一次 error,按键去重只记一次
 *   - overrides 不清理:轮换把图换下场后再登台,直接用最后
 *     已知的可用 src,失败则从链的下一级继续
 * ============================================================ */
import { ref, type Ref } from 'vue';

/** 每级重试前的延时(ms):给瞬断的网络/图床一点恢复时间 */
export const FALLBACK_RETRY_DELAY_MS = 1500;

/** 生成 cache-bust 变体(换查询串;7bu.top 缩略图无查询串,稳健起见兼容已有 ?) */
export function bustSrc(src: string, n: number): string {
  const sep = src.includes('?') ? '&' : '?';
  return `${src}${sep}vshowcase_retry=${n}`;
}

/** 自愈链:第 attempt 次失败后应依次尝试的 src(下标 0 = 首次重试) */
export function fallbackChain(thumb: string, url: string): string[] {
  if (thumb === url) {
    return [bustSrc(thumb, 1), bustSrc(thumb, 2), bustSrc(thumb, 3)];
  }
  return [bustSrc(thumb, 1), url, bustSrc(url, 2)];
}

interface ChainState {
  /** 已消耗的尝试数(0 = 初始渲染尚未失败过) */
  attempt: number;
  /** 非 null = 本次失败已登记,延时换 src 中(兼作同键去重标志) */
  timer: ReturnType<typeof setTimeout> | null;
}

export interface ImgFallback {
  /** 键 → 当前应渲染的 src(仅记录失败后改道的图;无条目 = 用视图默认 src) */
  readonly overrides: Ref<ReadonlyMap<string, string>>;
  /** <img> @error:登记一次失败并安排下一级尝试 */
  onError(key: string, thumb: string, url: string): void;
  /** <img> @load:成功即停掉该键的在途重试 */
  onLoad(key: string): void;
  /** 视图卸载:清所有在途计时器(overrides 保留,重进页面按最后已知最优 src 渲染) */
  dispose(): void;
}

export function createImgFallback(delayMs: number = FALLBACK_RETRY_DELAY_MS): ImgFallback {
  const overrides = ref(new Map<string, string>()) as Ref<Map<string, string>>;
  const states = new Map<string, ChainState>();
  let disposed = false;

  function onError(key: string, thumb: string, url: string): void {
    if (disposed) return;
    let st = states.get(key);
    if (!st) {
      st = { attempt: 0, timer: null };
      states.set(key, st);
    }
    // 该次失败已登记(双份渲染的另一份 <img> 迟到 error)→ 只记一次
    if (st.timer != null) return;
    const chain = fallbackChain(thumb, url);
    if (st.attempt >= chain.length) return; // 链已走完:放弃,维持灰底
    const nextSrc = chain[st.attempt];
    st.attempt += 1;
    st.timer = setTimeout(() => {
      st!.timer = null;
      if (disposed) return;
      const next = new Map(overrides.value);
      next.set(key, nextSrc);
      overrides.value = next;
    }, delayMs);
  }

  function onLoad(key: string): void {
    const st = states.get(key);
    if (st != null && st.timer != null) {
      clearTimeout(st.timer);
      st.timer = null;
    }
  }

  function dispose(): void {
    disposed = true;
    for (const st of states.values()) {
      if (st.timer != null) {
        clearTimeout(st.timer);
        st.timer = null;
      }
    }
  }

  return { overrides, onError, onLoad, dispose };
}
