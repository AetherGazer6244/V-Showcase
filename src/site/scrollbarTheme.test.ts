/* ============================================================
 * 滚动条跟随深浅主题 —— CSS 契约测试
 * ------------------------------------------------------------
 * 浏览器自带的滚动条不读站点的 CSS 变量,只听 color-scheme。
 * 站点没声明 color-scheme 时,深色主题下滚动条仍是系统浅色亮条
 * (2026-11 修:歌词面板白条)。这里把「必须声明」锁成测试,
 * 防止以后改样式时被无意删掉。
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const baseCss = read('./styles/base.css');
const pagesCss = read('./styles/pages.css');
const settingsTs = read('./settings.ts');

describe('color-scheme 声明', () => {
  it('浅色主题声明 color-scheme: light', () => {
    expect(baseCss).toMatch(/^:root\s*\{[^}]*color-scheme:\s*light/m);
  });

  it('深色主题声明 color-scheme: dark', () => {
    expect(baseCss).toMatch(/:root\[data-theme=['"]dark['"]\]\s*\{[^}]*color-scheme:\s*dark/);
  });

  it('深色选择器与 settings.ts 实际写入的 data-theme 一致', () => {
    // settings.ts 写的是 html[data-theme=...]，CSS 选择器必须认这个属性
    expect(settingsTs).toContain('dataset.theme');
    expect(baseCss).toContain(":root[data-theme='dark']");
  });
});

describe('滚动条主题变量', () => {
  it('浅色主题定义了滚动条滑块色', () => {
    expect(baseCss).toMatch(/^:root\s*\{[^}]*--scrollbar-thumb:/m);
  });

  it('深色主题也定义了滚动条滑块色(且与浅色不同)', () => {
    const darkBlock = baseCss.match(/:root\[data-theme=['"]dark['"]\]\s*\{([^}]*)\}/);
    expect(darkBlock).toBeTruthy();
    const dark = darkBlock![1];
    expect(dark).toContain('--scrollbar-thumb:');
    const lightBlock = baseCss.match(/^:root\s*\{([^}]*)\}/m);
    const lightThumb = lightBlock![1].match(/--scrollbar-thumb:\s*([^;]+);/)?.[1];
    const darkThumb = dark.match(/--scrollbar-thumb:\s*([^;]+);/)?.[1];
    expect(lightThumb).toBeTruthy();
    expect(darkThumb).toBeTruthy();
    expect(darkThumb).not.toBe(lightThumb);
  });
});

describe('音乐页滚动区自绘滚动条', () => {
  it('歌词区与歌单区都用 scrollbar-width: thin + 主题变量', () => {
    expect(pagesCss).toMatch(/\.music-lyrics,\s*\.music-rows\s*\{[^}]*scrollbar-width:\s*thin/);
    expect(pagesCss).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\)\s+transparent/);
  });

  it('WebKit 滑块用主题变量,不写死颜色', () => {
    const thumbRule = pagesCss.match(/\.music-lyrics::-webkit-scrollbar-thumb,\s*\.music-rows::-webkit-scrollbar-thumb\s*\{([^}]*)\}/);
    expect(thumbRule).toBeTruthy();
    expect(thumbRule![1]).toContain('var(--scrollbar-thumb)');
    // 不允许出现裸 rgba(浅色固定值)当滑块色
    expect(thumbRule![1]).not.toMatch(/background:\s*rgba\(\s*255/);
  });
});
