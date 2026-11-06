/* ============================================================
 * siteConfig — 站点级配置(站名/头像/签名/社交链接/默认封面)
 * ------------------------------------------------------------
 * 与 src/site/config.ts(墙面版面配置)分工:
 *   config.ts   → 墙面拉取与版面(Manager 配置 Tab 管理)
 *   siteConfig  → 全站身份信息(博客/关于/列表封面兜底消费)
 * 借鉴 Cecilian-Hub 的 siteConfig「全站控制中心」模式,字段精简。
 * ============================================================ */

export interface SocialLinks {
  github?: string;
  email?: string;
  bilibili?: string;
}

export interface SiteConfig {
  /** 站点名(导航标题/OG site_name 同源) */
  name: string;
  /** 一句话签名(关于页头部卡) */
  tagline: string;
  /** 头像图 URL(空 = 用首字母圆形占位) */
  avatar: string;
  /** 默认文章封面(列表卡片兜底,空 = 琥珀渐变占位) */
  defaultCover: string;
  social: SocialLinks;
  /** 仓库地址(页脚 GitHub 链接同源) */
  repo: string;
}

export const siteConfig: SiteConfig = {
  name: 'V-Showcase',
  tagline: '流动图片墙与光影画廊 — 简洁明亮的个人站点',
  avatar: '',
  defaultCover: 'https://bu.dusays.com/2026/08/25/6a8da73da2991.jpg',
  social: {
    github: 'https://github.com/AetherGazer6244/V-Showcase',
    email: '',
    bilibili: '',
  },
  repo: 'https://github.com/AetherGazer6244/V-Showcase',
};
