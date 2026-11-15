/* ============================================================
 * postEnhance 单测 —— 代码块复制 / 图片提示 / 阅读进度
 * ============================================================ */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractCodeText,
  copyToClipboard,
  enhanceCodeBlocks,
  markImagesZoomable,
  computeReadingProgress,
} from './postEnhance';

function makeProse(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('extractCodeText', () => {
  it('取 code 里的纯文本(highlight.js 的 span 被剥掉)', () => {
    const root = makeProse('<pre><code class="hljs"><span class="hljs-keyword">const</span> a = 1;</code></pre>');
    expect(extractCodeText(root.querySelector('pre')!)).toBe('const a = 1;');
  });

  it('没有 code 标签时退回 pre 自身', () => {
    const root = makeProse('<pre>plain</pre>');
    expect(extractCodeText(root.querySelector('pre')!)).toBe('plain');
  });

  it('去掉结尾多余换行', () => {
    const root = makeProse('<pre><code>x\n</code></pre>');
    expect(extractCodeText(root.querySelector('pre')!)).toBe('x');
  });
});

describe('copyToClipboard', () => {
  it('有 navigator.clipboard → 用它并返回 true', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('clipboard 抛错 → 退回 textarea 方案', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
    });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // 兜底用的临时 textarea 要被清掉
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('没有任何可用通道 → 返回 false,不抛错', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });
});

describe('enhanceCodeBlocks', () => {
  it('每个 pre 加一个复制按钮', () => {
    const root = makeProse('<pre><code>a</code></pre><pre><code>b</code></pre><p>无代码</p>');
    const handle = enhanceCodeBlocks(root);
    expect(handle.count).toBe(2);
    expect(root.querySelectorAll('.code-copy-btn').length).toBe(2);
    expect(root.querySelectorAll('pre')[0].querySelector('.code-copy-btn')!.textContent).toBe('复制');
  });

  it('点按钮 → 复制代码内容,文案变「已复制」', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const root = makeProse('<pre><code>const x = 1;</code></pre>');
    // resetMs 给足:按钮文案是「已复制 → 一段时间后变回复制」,太短会错过断言
    enhanceCodeBlocks(root, { resetMs: 5000 });

    const btn = root.querySelector<HTMLButtonElement>('.code-copy-btn')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe('已复制'));
    expect(writeText).toHaveBeenCalledWith('const x = 1;');
    expect(btn.classList.contains('is-done')).toBe(true);
  });

  it('重复调用不会叠按钮', () => {
    const root = makeProse('<pre><code>a</code></pre>');
    enhanceCodeBlocks(root);
    enhanceCodeBlocks(root);
    expect(root.querySelectorAll('.code-copy-btn').length).toBe(1);
  });

  it('destroy() 清掉所有按钮', () => {
    const root = makeProse('<pre><code>a</code></pre>');
    const handle = enhanceCodeBlocks(root);
    handle.destroy();
    expect(root.querySelectorAll('.code-copy-btn').length).toBe(0);
  });
});

describe('markImagesZoomable', () => {
  it('给图片加 title 提示,返回数量', () => {
    const root = makeProse('<p><img src="https://x/a.jpg" alt="a"></p>');
    expect(markImagesZoomable(root)).toBe(1);
    expect(root.querySelector('img')!.getAttribute('title')).toBe('点击放大');
  });

  it('已有 title 的不动', () => {
    const root = makeProse('<img src="https://x/a.jpg" title="原标题">');
    markImagesZoomable(root);
    expect(root.querySelector('img')!.getAttribute('title')).toBe('原标题');
  });
});

describe('computeReadingProgress', () => {
  it('刚进文章(元素顶还在视口下方)→ 0', () => {
    expect(computeReadingProgress({ top: 300, height: 2000 }, 800)).toBe(0);
  });

  it('元素顶与视口顶对齐 → 0', () => {
    expect(computeReadingProgress({ top: 0, height: 2000 }, 800)).toBe(0);
  });

  it('滚过一半 → 0.5', () => {
    // 总可滚距离 = 2000 - 800 = 1200;滚过 600 → 0.5
    expect(computeReadingProgress({ top: -600, height: 2000 }, 800)).toBeCloseTo(0.5);
  });

  it('读到底 → 1', () => {
    expect(computeReadingProgress({ top: -1200, height: 2000 }, 800)).toBeCloseTo(1);
  });

  it('超出范围一律夹在 0~1', () => {
    expect(computeReadingProgress({ top: -9999, height: 2000 }, 800)).toBe(1);
    expect(computeReadingProgress({ top: 9999, height: 2000 }, 800)).toBe(0);
  });

  it('文章比视口还短(滚不动)→ 读完即 100%', () => {
    expect(computeReadingProgress({ top: 100, height: 300 }, 800)).toBe(0);
    expect(computeReadingProgress({ top: -50, height: 300 }, 800)).toBe(1);
  });
});
