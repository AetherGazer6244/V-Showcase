/* ============================================================
 * postEnhance —— 文章正文的运行时增强(纯逻辑,不含 UI)
 * ------------------------------------------------------------
 * 文章正文是构建期渲染好的静态 HTML(v-html 注入),这里做三件事:
 *   1. 代码块加「复制」按钮
 *   2. 正文图片加「点击放大」提示(title + 光标)
 *   3. 阅读进度换算(纯函数,便于单测)
 * ============================================================ */

/* ---------- 代码块复制 ---------- */

/** 取代码块里的纯文本(去掉 highlight.js 注入的 span,只留文字) */
export function extractCodeText(pre: Element): string {
  const code = pre.querySelector('code');
  const src = code ?? pre;
  return (src.textContent || '').replace(/\n$/, '');
}

/**
 * 复制到剪贴板:优先用 navigator.clipboard(需要 https/安全上下文),
 * 不可用时退回 textarea + execCommand(老浏览器 / http 场景)。
 * 返回是否成功。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clip && typeof clip.writeText === 'function') {
      await clip.writeText(text);
      return true;
    }
  } catch {
    /* 继续走兜底 */
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export interface CodeEnhanceHandle {
  /** 处理了多少个代码块 */
  count: number;
  /** 移除所有注入的按钮(组件卸载时调用) */
  destroy(): void;
}

export interface EnhanceOptions {
  /** 按钮文案(默认「复制」/「已复制」） */
  labels?: { copy?: string; done?: string; fail?: string };
  /** 复制成功的提示停留时长(ms) */
  resetMs?: number;
}

/**
 * 给容器内每个 <pre> 加复制按钮。
 * 按钮是真实 <button>(可键盘聚焦),点击不触发外层事件委托。
 */
export function enhanceCodeBlocks(root: ParentNode, opts: EnhanceOptions = {}): CodeEnhanceHandle {
  const labels = { copy: '复制', done: '已复制', fail: '复制失败', ...(opts.labels || {}) };
  const resetMs = opts.resetMs ?? 1500;
  const buttons: HTMLButtonElement[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pres = Array.from(root.querySelectorAll('pre'));
  for (const pre of pres) {
    // 已有按钮(重复调用)先跳过
    if (pre.querySelector('.code-copy-btn')) continue;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy-btn';
    btn.textContent = labels.copy;
    btn.setAttribute('aria-label', '复制这段代码');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void copyToClipboard(extractCodeText(pre)).then((ok) => {
        btn.textContent = ok ? labels.done : labels.fail;
        btn.classList.add('is-done');
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          btn.textContent = labels.copy;
          btn.classList.remove('is-done');
        }, resetMs);
      });
    });

    pre.appendChild(btn);
    buttons.push(btn);
  }

  return {
    count: buttons.length,
    destroy() {
      if (timer) clearTimeout(timer);
      for (const b of buttons) b.remove();
      buttons.length = 0;
    },
  };
}

/* ---------- 正文图片:提示可放大 ---------- */

/** 给正文图片加 title 提示(灯箱已由 PostView 的事件委托接好) */
export function markImagesZoomable(root: ParentNode): number {
  const imgs = Array.from(root.querySelectorAll('img'));
  for (const img of imgs) {
    if (!img.getAttribute('title')) img.setAttribute('title', '点击放大');
  }
  return imgs.length;
}

/* ---------- 阅读进度(纯函数) ---------- */

/**
 * 阅读进度 0~1。
 * rect = 正文元素的 getBoundingClientRect();viewportH = 视口高度。
 * 进度 = 已经滚过的距离 / 能滚的总距离(总距离 ≤ 0 时按「读完即 100%」处理)。
 */
export function computeReadingProgress(rect: { top: number; height: number }, viewportH: number): number {
  const scrolled = -rect.top;                 // 已滚过多少(相对元素顶)
  const total = rect.height - viewportH;      // 全文需要滚过的距离
  if (total <= 0) return scrolled > 0 ? 1 : 0;
  const p = scrolled / total;
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(1, p));
}
