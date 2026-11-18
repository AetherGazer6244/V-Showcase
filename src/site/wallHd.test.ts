import { describe, it, expect } from 'vitest';
import {
  shouldUpgradeHd, needsHdUpgrade, pickHdSrc,
  HD_PRELOAD_TIMEOUT_MS, HD_MAX_UPGRADES,
} from './wallHd';

describe('shouldUpgradeHd — 流量闸门', () => {
  it('检测不到网络信息 → 允许(桌面端基本都是宽带/Wi-Fi)', () => {
    expect(shouldUpgradeHd(null)).toBe(true);
    expect(shouldUpgradeHd(undefined)).toBe(true);
  });

  it('省流模式开着 → 不升级', () => {
    expect(shouldUpgradeHd({ saveData: true })).toBe(false);
    expect(shouldUpgradeHd({ saveData: true, effectiveType: '4g' })).toBe(false);
  });

  it('省流模式关着 → 照常判断网速', () => {
    expect(shouldUpgradeHd({ saveData: false, effectiveType: '4g' })).toBe(true);
  });

  it('2G / slow-2G → 不升级(原图几 MB,2G 扛不住)', () => {
    expect(shouldUpgradeHd({ effectiveType: '2g' })).toBe(false);
    expect(shouldUpgradeHd({ effectiveType: 'slow-2g' })).toBe(false);
    expect(shouldUpgradeHd({ effectiveType: '2G' })).toBe(false);
  });

  it('3G / 4G → 升级', () => {
    expect(shouldUpgradeHd({ effectiveType: '3g' })).toBe(true);
    expect(shouldUpgradeHd({ effectiveType: '4g' })).toBe(true);
    expect(shouldUpgradeHd({ effectiveType: '4G' })).toBe(true);
  });

  it('网速字段缺失/为空 → 按允许处理', () => {
    expect(shouldUpgradeHd({})).toBe(true);
    expect(shouldUpgradeHd({ effectiveType: '' })).toBe(true);
  });
});

describe('needsHdUpgrade — 哪些图值得升级', () => {
  it('有真正的缩略图才值得换', () => {
    expect(needsHdUpgrade('https://x/a.jpg', 'https://x/thumb.png')).toBe(true);
  });

  it('url 与 thumb 相同(图床没生成缩略图)→ 本来就是原画,不升级', () => {
    expect(needsHdUpgrade('https://x/a.jpg', 'https://x/a.jpg')).toBe(false);
  });

  it('地址不全 → 不升级', () => {
    expect(needsHdUpgrade('', 'https://x/thumb.png')).toBe(false);
    expect(needsHdUpgrade('https://x/a.jpg', '')).toBe(false);
  });
});

describe('pickHdSrc — 该显示哪张', () => {
  it('没升级 → 缩略图', () => {
    expect(pickHdSrc('https://x/a.jpg', 'https://x/t.png', false)).toBe('https://x/t.png');
  });

  it('已升级 → 原图', () => {
    expect(pickHdSrc('https://x/a.jpg', 'https://x/t.png', true)).toBe('https://x/a.jpg');
  });

  it('有坏图回退地址 → 回退地址优先(不管升级没升级)', () => {
    expect(pickHdSrc('https://x/a.jpg', 'https://x/t.png', false, 'https://x/t2.png')).toBe('https://x/t2.png');
    expect(pickHdSrc('https://x/a.jpg', 'https://x/t.png', true, 'https://x/t2.png')).toBe('https://x/t2.png');
  });
});

describe('常量', () => {
  it('预载超时在合理范围(不会把队列卡死)', () => {
    expect(HD_PRELOAD_TIMEOUT_MS).toBeGreaterThan(1000);
    expect(HD_PRELOAD_TIMEOUT_MS).toBeLessThanOrEqual(60000);
  });

  it('单次会话升级上限是正数(闸门不能把升级全禁掉)', () => {
    expect(HD_MAX_UPGRADES).toBeGreaterThan(0);
  });
});
