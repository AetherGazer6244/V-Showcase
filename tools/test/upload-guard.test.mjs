/* ============================================================
 * 上传管线 · 服务端对账(纯函数部分)
 * ------------------------------------------------------------
 * 对账逻辑:图床目录每条记录带 md5,内容相同 → md5 相同。
 * 命中即复用已有外链,不再上传(lessons-learned 1.2 重复 URL)。
 * ============================================================ */
import { describe, it, expect } from 'vitest';

import { buildMd5Index, lookupByMd5 } from '../server/lib/upload-guard.mjs';

const item = (md5, url, name = '') => ({ md5, origin_name: name, links: { url } });

describe('buildMd5Index', () => {
  it('建立 md5 → 图片 的索引', () => {
    const idx = buildMd5Index([
      item('abc123', 'https://x/1.jpg', '1.jpg'),
      item('def456', 'https://x/2.jpg', '2.jpg'),
    ]);
    expect(idx.size).toBe(2);
    expect(idx.get('abc123')).toEqual({ url: 'https://x/1.jpg', name: '1.jpg' });
  });

  it('跳过没有 md5 / 没有外链的记录', () => {
    const idx = buildMd5Index([
      item('', 'https://x/1.jpg'),
      { md5: 'aaa', links: {} },
      { links: { url: 'https://x/3.jpg' } },
    ]);
    expect(idx.size).toBe(0);
  });

  it('md5 大小写不敏感(目录里是大写也要能对上)', () => {
    const idx = buildMd5Index([item('ABC123', 'https://x/1.jpg')]);
    expect(idx.get('abc123')).toBeTruthy();
  });

  it('同 md5 多条 → 保留先出现的(图床目录按 newest 排序)', () => {
    const idx = buildMd5Index([
      item('dup', 'https://x/new.jpg', 'new.jpg'),
      item('dup', 'https://x/old.jpg', 'old.jpg'),
    ]);
    expect(idx.size).toBe(1);
    expect(idx.get('dup').url).toBe('https://x/new.jpg');
  });

  it('非数组输入不炸', () => {
    expect(buildMd5Index(null).size).toBe(0);
    expect(buildMd5Index(undefined).size).toBe(0);
  });
});

describe('lookupByMd5', () => {
  const idx = buildMd5Index([item('abc123', 'https://x/1.jpg', '1.jpg')]);

  it('命中返回记录', () => {
    expect(lookupByMd5(idx, 'abc123')).toEqual({ url: 'https://x/1.jpg', name: '1.jpg' });
    expect(lookupByMd5(idx, 'ABC123')).toBeTruthy();
  });

  it('未命中 / 空值 / 非法索引 → null', () => {
    expect(lookupByMd5(idx, 'nope')).toBeNull();
    expect(lookupByMd5(idx, '')).toBeNull();
    expect(lookupByMd5(null, 'abc123')).toBeNull();
  });
});
