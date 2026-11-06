import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateLegacyStorage } from './storageMigration';

describe('migrateLegacyStorage', () => {
  beforeEach(() => localStorage.clear());

  it('旧键存在且新键缺失 → 复制并写标记', () => {
    localStorage.setItem('lumina.favs', JSON.stringify(['https://a/1.jpg']));
    localStorage.setItem('lumina.focal.local', '{"https://a/1.jpg":{"x":0.5,"y":0.25}}');
    migrateLegacyStorage();
    expect(localStorage.getItem('vshowcase.favs')).toBe(JSON.stringify(['https://a/1.jpg']));
    expect(localStorage.getItem('vshowcase.focal.local')).toBe('{"https://a/1.jpg":{"x":0.5,"y":0.25}}');
    expect(localStorage.getItem('vshowcase.migrated')).toBeTruthy();
  });

  it('新键已存在 → 不覆盖', () => {
    localStorage.setItem('lumina.favs', JSON.stringify(['a']));
    localStorage.setItem('vshowcase.favs', JSON.stringify(['b']));
    migrateLegacyStorage();
    expect(localStorage.getItem('vshowcase.favs')).toBe(JSON.stringify(['b']));
  });

  it('带标记后跳过(删除旧键也不会再次迁移)', () => {
    localStorage.setItem('lumina.favs', JSON.stringify(['a']));
    migrateLegacyStorage();
    localStorage.removeItem('vshowcase.favs');
    migrateLegacyStorage();
    expect(localStorage.getItem('vshowcase.favs')).toBeNull();
  });

  it('localStorage 抛错 → 静默不崩', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => migrateLegacyStorage()).not.toThrow();
    spy.mockRestore();
  });
});
