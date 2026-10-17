/* ============================================================
 * 测试方向标记(orientations)文档清洗 与 数据文件解析
 * (writeOrientations 只测"拒写"路径,合法写入会动真实仓库文件,
 *  与 tags/albums 的纯函数测试口径一致)
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  sanitizeOrientationsDoc,
  readOrientations,
  writeOrientations,
  getViewerDir,
  safeParseObject,
} from '../server/lib/config-reader.mjs';

describe('sanitizeOrientationsDoc', () => {
  it('合法值保留,url 字典序排序', () => {
    const doc = sanitizeOrientationsDoc({
      'https://b/2.jpg': 270,
      'https://a/1.jpg': 90,
    });
    expect(Object.keys(doc)).toEqual(['https://a/1.jpg', 'https://b/2.jpg']);
    expect(doc['https://a/1.jpg']).toBe(90);
    expect(doc['https://b/2.jpg']).toBe(270);
  });

  it('0 = 默认方向,丢弃不落盘', () => {
    const doc = sanitizeOrientationsDoc({
      'https://a/1.jpg': 0,
      'https://b/2.jpg': 180,
    });
    expect(Object.keys(doc)).toEqual(['https://b/2.jpg']);
  });

  it('空文档合法(全部复位)', () => {
    expect(sanitizeOrientationsDoc({})).toEqual({});
  });

  it('拒绝非对象文档', () => {
    expect(() => sanitizeOrientationsDoc([90])).toThrow(/普通对象/);
    expect(() => sanitizeOrientationsDoc(null)).toThrow(/普通对象/);
    expect(() => sanitizeOrientationsDoc('90')).toThrow(/普通对象/);
  });

  it('拒绝非法角度(非 0/90/180/270)', () => {
    expect(() => sanitizeOrientationsDoc({ 'https://a/1.jpg': 45 })).toThrow(/0\/90\/180\/270/);
    expect(() => sanitizeOrientationsDoc({ 'https://a/1.jpg': -90 })).toThrow(/0\/90\/180\/270/);
    expect(() => sanitizeOrientationsDoc({ 'https://a/1.jpg': 90.5 })).toThrow(/0\/90\/180\/270/);
    expect(() => sanitizeOrientationsDoc({ 'https://a/1.jpg': '90' })).toThrow(/0\/90\/180\/270/);
    expect(() => sanitizeOrientationsDoc({ 'https://a/1.jpg': null })).toThrow(/0\/90\/180\/270/);
  });

  it('拒绝非字符串/空键', () => {
    expect(() => sanitizeOrientationsDoc({ '': 90 })).toThrow(/非空字符串/);
  });
});

describe('writeOrientations 拒写路径', () => {
  it('非法值抛错且不写文件(清洗前置)', async () => {
    await expect(writeOrientations({ 'https://a/1.jpg': 45 })).rejects.toThrow(/0\/90\/180\/270/);
    await expect(writeOrientations('nope')).rejects.toThrow(/普通对象/);
  });
});

describe('orientations 数据文件环境', () => {
  it('src/site/orientations.ts 存在且 acorn 可解析(纯字面量约束)', async () => {
    const p = path.join(getViewerDir(), 'src', 'site', 'orientations.ts');
    const raw = await fs.readFile(p, 'utf8');
    const parsed = safeParseObject(raw, 'ORIENTATIONS');
    expect(typeof parsed).toBe('object');
  });

  it('readOrientations 与文件内容一致', async () => {
    const parsed = safeParseObject(
      await fs.readFile(path.join(getViewerDir(), 'src', 'site', 'orientations.ts'), 'utf8'),
      'ORIENTATIONS',
    );
    expect(await readOrientations()).toEqual(parsed);
  });
});
