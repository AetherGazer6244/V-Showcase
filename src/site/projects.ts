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

import projectsJson from '../../content/projects.json';

/** 筛选顺序(「全部」在最前) */
export const STATUS_FILTERS = ['all', 'active', 'wip', 'archived'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/* 项目数据在 content/projects.json(Manager 项目 Tab 读写),此处类型化装载 */
export const PROJECTS: Project[] = projectsJson as Project[];
