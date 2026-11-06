---
title: 你好,世界 — V-Showcase 博客上线
date: 2026-11-06
excerpt: 博客模块正式上线:Markdown 写作、构建期渲染、独立静态页与 SEO,一篇看懂这套内容管线的设计。
---

你好,世界。

V-Showcase 从今天起不只是流动图片墙了——博客模块正式上线。这篇文章既是开篇,也是管线说明书。

## 写作方式

文章就是仓库里的 Markdown 文件,路径形如 `content/posts/<slug>.md`,头部是 front-matter:

```md
---
title: 文章标题
date: 2026-11-06
cover: https://...   # 可选,列表卡片封面
excerpt: 摘要        # 可选,缺省取正文首段
draft: false         # true 则构建时跳过
---
```

写完 push,Cloudflare Pages 自动构建发布,全程没有数据库。

## 构建期发生了什么

1. front-matter 解析(gray-matter)
2. 预清洗:修复无空格数字列表这类常见手滑
3. Markdown → HTML(marked + GFM),代码块构建期 highlight.js 高亮
4. 标题自动挂锚点 id,生成目录树
5. 每篇文章生成独立静态页 `/posts/<slug>/`,带专属 title/OG/canonical

## 引用与格式

> 简洁明亮,是整个站点的气质。
> —— 改版日志

支持 **加粗**、*斜体*、~~删除线~~、表格与任务列表:

- [x] 内容管线
- [x] 博客页面
- [ ] 说说与友链(规划中)

## 代码块

```ts
// 构建期高亮,浏览器零开销
export function readingMinutes(plain: string): number {
  return Math.max(1, Math.ceil(plain.length / 400));
}
```

欢迎来到新的 V-Showcase。
