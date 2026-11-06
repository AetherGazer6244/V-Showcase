/* ============================================================
 * projects — 项目展示数据(纯静态,构建期入库)
 * ------------------------------------------------------------
 * status 三态驱动筛选:active 维护中 / wip 进行中 / archived 已归档
 * ============================================================ */

export type ProjectStatus = 'active' | 'wip' | 'archived';

export interface Project {
  name: string;
  desc: string;
  status: ProjectStatus;
  tech: string[];
  /** 演示地址(空 = 无) */
  link?: string;
  /** 仓库地址(空 = 未开源) */
  repo?: string;
  year: string;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '维护中',
  wip: '进行中',
  archived: '已归档',
};

/** 筛选顺序(「全部」在最前) */
export const STATUS_FILTERS = ['all', 'active', 'wip', 'archived'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const PROJECTS: Project[] = [
  {
    name: 'V-Showcase',
    desc: '流动图片墙个人站点:多行叠层水平流动的图片展示墙、光影画廊、博客与全站播放器,部署在 Cloudflare Pages。',
    status: 'active',
    tech: ['Vue 3', 'Vite', 'TypeScript', 'Cloudflare Pages', 'Pages Functions'],
    link: 'https://vshowcase.pages.dev/',
    repo: 'https://github.com/AetherGazer6244/V-Showcase',
    year: '2026',
  },
  {
    name: 'Cecilian-Hub',
    desc: '姊妹项目:Next.js 博客与工具集,本站的音乐代理、目录与内容管线设计参考了它的实践。',
    status: 'wip',
    tech: ['Next.js', 'React', 'TypeScript'],
    repo: 'https://github.com/AetherGazer6244/Cecilian-Hub',
    year: '2025',
  },
  {
    name: 'V-Showcase Manager',
    desc: '本站本地写作台:相册/焦点/标签配置管理与博客、音乐、项目内容的编辑入口(随本次改版实装)。',
    status: 'active',
    tech: ['Vue 3', 'Vite'],
    year: '2026',
  },
];
