/* 一次性迁移:项目改名 Lumina → V-Showcase,localStorage 键前缀 lumina.* → vshowcase.*
 * 仅当新键不存在且旧键存在时复制;成功后写入标记,之后调用直接跳过。
 * 全量迁移稳定上线后,本文件与其测试、入口调用可整体删除。 */

const MAP: ReadonlyArray<readonly [string, string]> = [
  ['lumina.settings', 'vshowcase.settings'],
  ['lumina.favs', 'vshowcase.favs'],
  ['lumina.liked', 'vshowcase.liked'],
  ['lumina.tags.local', 'vshowcase.tags.local'],
  ['lumina.album.local', 'vshowcase.album.local'],
  ['lumina.focal.local', 'vshowcase.focal.local'],
  ['lumina.focal.viewmode', 'vshowcase.focal.viewmode'],
  ['lumina.focal.icon', 'vshowcase.focal.icon'],
  ['lumina.orient.local', 'vshowcase.orient.local'],
  ['lumina.banner.dismissed', 'vshowcase.banner.dismissed'],
];

const DONE_KEY = 'vshowcase.migrated';

export function migrateLegacyStorage(): void {
  try {
    if (localStorage.getItem(DONE_KEY) !== null) return;
    for (const [oldKey, newKey] of MAP) {
      if (localStorage.getItem(newKey) !== null) continue;
      const legacy = localStorage.getItem(oldKey);
      if (legacy !== null) localStorage.setItem(newKey, legacy);
    }
    localStorage.setItem(DONE_KEY, new Date().toISOString());
  } catch {
    /* localStorage 不可用(隐私模式等)时静默跳过 */
  }
}
