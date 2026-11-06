# V-Showcase Tools · 编辑器

本地运行的服务与 AI 工具，为 `../src/site/focalPoints.ts` 产出焦点数据 + `../src/site/albums.ts` 提供图集管理 API。
Manager 源码位于 `../src/manager/`（Vue 3，正常入库），构建产物在 `../dist-manager/`（Git 忽略，仅本机）；Tools 源码正常进入 GitHub，但不会进入 Cloudflare 的 `dist/`。

按职责分目录组织：

```
tools/
├── start.bat / start.sh         ← 终端启动器（Win / Unix）
├── dev.bat                      ← Windows 一站式：装依赖 + 启服务 + 打开浏览器(DevTools 自动开)
├── console.bat                  ← Windows 快捷键：服务已启时直接打开浏览器(DevTools 自动开)
├── site.bat / site.sh           ← ★ 主站(Vue 站点)一键预览：build + wrangler pages dev + 开浏览器(真实图片)
├── package.json                 ← Node 依赖
├── README.md                    ← 本文件
│
├── server/                      ← ★ 启动器 + HTTP 服务器
│   ├── serve.mjs                ← 入口（node server/serve.mjs）
│   └── lib/
│       ├── config-reader.mjs    ← 共享：acorn 安全解析 src/site/*.ts 数据文件
│       └── net-utils.mjs        ← 共享：DNS 兜底解析 / 重定向 GET / 并发 pMap / magic bytes 嗅探
│
├── audit-images.mjs             ← ★ 图库体检（死链 / 伪装图 / 重复 / 缺元数据）
├── test/                        ← node 侧测试（npm test，独立 vitest 配置）
│
└── ai/                          ← ★ AI 工具（命令行）
    └── build-focal-points.mjs   ← 人脸检测 + 批量分析（含 --limit / --no-write / --download-only）
```

---

## 快速开始

### 0. 预览主站（Vue 站点本身，真实图片）

和下面的 Manager 编辑器是两回事。`site.bat` 会自动 `npm run build` 再用
`npx wrangler pages dev dist --port 8001` 起服务 —— 因为 `/api/images` 这个
Pages Function 只有 wrangler 会提供，纯 `npm run dev`（Vite）只会显示 16 张兜底占位图。

**Windows：** 双击 `site.bat`
**macOS / Linux：** `./tools/site.sh`

服务跑在独立的 `V-Showcase Site` 黑窗口里，关掉它或在里面 Ctrl+C 即停止。改完 `src/` 再跑一次即可（每次启动都会重新 build）。

### 1. 启动可视化编辑器

**Windows（推荐）：** 双击 `dev.bat` —— 一站式完成"装依赖 → 启动服务 → 等待就绪 → 打开 Edge/Chrome(DevTools 自动开)"

服务已运行但想新开一个标签页？再双击 `console.bat`。

要查看原始日志（前台运行）：双击 `start.bat`。

**macOS / Linux：**
```bash
./start.sh
```

**或跨平台：**
```bash
node server/serve.mjs
```

启动后会：
- 自动检测 Node.js（需要 ≥18）
- 检查本地 `../dist-manager/manager.html` 是否存在，缺失时自动 `npm run build:manager`
- 首次运行自动 `npm install`
- 分配端口（默认 8002，冲突顺延 8003/8004）
- 自动打开浏览器到实际端口的 `/manager/`

> **Ctrl+C 优雅关闭**：关闭浏览器后，在启动的命令行窗口按 Ctrl+C 即可停止服务。

### 2. 可选参数

```bash
node server/serve.mjs --port=9000    # 自定义端口
node server/serve.mjs --no-launch    # 不自动打开浏览器
node server/serve.mjs --no-install   # 跳过依赖检查
```

---

## 可视化编辑器使用

Manager 有两个 tab：

### 📍 焦点 tab

| 按钮 | 作用 |
|---|---|
| **↻ 读取图片列表** | 通过本地代理拉真实图床；失败时加载 viewer 兜底图 |
| **🧠 AI 批量分析** | 调用 AI 工具，自动检测人脸并写回 viewer |
| **💾 保存到 viewer** | 把当前会话的编辑结果写入 `../src/site/focalPoints.ts` |
| **↥ 同步并部署** | 仅提交并推送 `src/site/focalPoints.ts` 到 `origin/main`，触发 Cloudflare Pages 部署 |
| **📋 导出 JSON** | 不写入，只导出 JSON 文本（用于复制粘贴） |

#### 单图编辑

1. 点击网格中任意图片 → 弹出编辑器
2. **点击图片任意位置** 或 **拖动白点** 设置焦点
3. 右侧实时预览三档卡片高度（230/190/140）的裁剪效果
4. **✓ 保存** → 写入 localStorage（本次会话）
5. **🗑️ 清除** → 删除该图的焦点

> 编辑结果保存在浏览器 `localStorage.vshowcase.focal.local`，
> 只在本浏览器有效，**点"💾 保存到 viewer"才会写入文件并 git 可见**。

### 📚 图集 tab

| 按钮 / 交互 | 作用 |
|---|---|
| **＋ 新建图集** | 输入名字 + 随机 8 字符 id |
| **图集 chip** 上的 ✏️ | 重命名该图集 |
| **图集 chip** 上的 🗑 | 删除图集（旗下 url 自动降级为未分组） |
| **🚮 未分组 chip** | 拖到此 = 解除归属 |
| **拖图片 → 图集** | 把图片加入图集 |
| **💾 保存到 viewer** | 把改动写入 `../src/site/albums.ts` |
| **↥ 同步并部署** | 仅提交并推送 `src/site/albums.ts` 到 `origin/main` |

#### 工作流

1. 点 **＋ 新建图集** → 输入"德克萨斯" → 创建
2. 从图片网格拖图到该 chip → 数字 +1
3. 拖错/不想保留 → 拖到 🚮 解除
4. 点 **💾 保存到 viewer** → 写入 `src/site/albums.ts`
5. 点 **↥ 同步并部署** 提交推送(或手动 `git add src/site/albums.ts && git commit && git push`)触发部署

> 编辑结果保存在 `localStorage.vshowcase.album.local`，仅本浏览器有效。
> 手动覆盖：`localStorage.setItem('vshowcase.album.local', JSON.stringify({ url: 'albumId' }))`，刷新即生效。

---

## AI 批量分析（命令行）

无需打开编辑器，直接在终端跑：

```bash
cd tools
npm install                              # 首次

# 基础：用 config.ts 的兜底图，生成 max（最大脸）策略
node ai/build-focal-points.mjs

# 多人合影：用所有人脸包围盒中心
node ai/build-focal-points.mjs --strategy=center

# 从真实图床拉数据（token 从 viewer 根目录 .dev.vars 读取）
node ai/build-focal-points.mjs --source=upstream

# 试跑：只处理前 10 张、不写文件（看检出率再决定全量）
node ai/build-focal-points.mjs --source=upstream --limit=10 --no-write

# 调整并发下载数（默认 4）
node ai/build-focal-points.mjs --concurrency=8

# 仅准备模型（不分析）
node ai/build-focal-points.mjs --download-only

# 或用 npm script（更简短）
npm run ai
npm run ai:center
npm run download
```

**技术底座（2026-10 重写）**：tf 后端用 `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-wasm`（纯 WASM，任何 Node ≥18 都能跑，不再依赖装不上原生编译的 tfjs-node）；图片解码用 `sharp`（顺带支持 webp 伪装 jpg）。模型权重优先直接用 `@vladmandic/face-api` npm 包自带的（`node_modules/@vladmandic/face-api/model/`，零下载）；包缺文件时才回落到网上下载（jsDelivr 镜像优先，`raw.githubusercontent.com` 在部分网络不可达）。

> **⚠️ 检出率预期**：SSD MobileNet 是**真人脸**模型。图库以二次元插画/动漫图为主时检出率约 0%
> （实测 10 张 0 检出，管线本身已用官方人脸样例验证正常）。这类图库的焦点请用
> Manager 焦点 tab 的「按横竖预填」批量预设（竖图 0.33 / 横图 0.5 / 方图 0.4）或人工标注；
> 图库以后若有真人照片，AI 批量分析即可正常发挥作用。

### CLI 参数一览

| 参数 | 默认 | 说明 |
|---|---|---|
| `--strategy=max` | ✓ | 每张图取最大人脸作为焦点 |
| `--strategy=center` | | 多人合影时，取所有人脸包围盒的几何中心 |
| `--source=fallback` | ✓ | 数据源：viewer 的 `fallbackImages` |
| `--source=upstream` | | 数据源：viewer 实际图床 API |
| `--concurrency=N` | 4 | 并发下载数（1~16） |
| `--limit=N` | 0(全部) | 只处理前 N 张（配合 `--no-write` 试跑） |
| `--no-write` | | 只检测不写 `focalPoints.ts`（打印检出预览） |
| `--download-only` | | 只准备模型，跳过分析 |

---

## 图库体检（audit-images.mjs）

直连图床 API（不走网站清单，拿全字段：md5 / size / 宽高 / 上传时间 / 删除链接），给整个图库做健康检查：

- **死链**：逐张 `Range GET` 前 16 字节验活（绝不整张下载），≥400 复核一次才算死，缩略图一并查
- **伪装图**：magic bytes 嗅探真实格式，与扩展名比对（如 webp 伪装 `.jpg`）
- **重复**：按 md5 分组，列出每组全部副本（含 key / 原名 / 大小 / 时间 / delete_url）
- **缺元数据**：宽高或大小为 0 的（批量预设焦点会当方图处理）

```bash
cd tools
npm run audit                     # 全量体检,报告写 tools/audit-report.json(已 gitignore)
node audit-images.mjs --skip-ping # 只查元数据不验活(快)
node audit-images.mjs --no-thumbs # 跳过缩略图验活
node audit-images.mjs --concurrency=8
node audit-images.mjs --max-pages=10   # 页数保险丝(默认 50 页 = 2000 张)
```

> 2026-10-17 实测(164 张)：健康 162、死链 2(404)、缩略图全活、伪装图 27(全为 webp 伪装 .jpg)、
> 重复 4 组 ×2(2026-09-11 与 2026-10-04 两批各传一次,同 md5 同 URL,删旧留新即可)、缺元数据 0。
> 本机 DNS 对部分域名间歇性解析失败,脚本内置公共 DNS 兜底(`server/lib/net-utils.mjs`),两工具共用。

---

## API 端点（由 server/serve.mjs 提供）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/` | 302 → `/manager/` |
| GET | `/manager/*` | `../dist-manager/` 内静态文件(缺失自动构建) |
| GET | `/api/viewer-config` | 读取 `../../src/site/config.ts` |
| GET | `/api/focal-points` | 读取 `../src/site/focalPoints.ts` |
| POST | `/api/focal-points` | 写入 `../src/site/focalPoints.ts`（body=JSON） |
| GET | `/api/albums` | 读取 `../src/site/albums.ts` |
| POST | `/api/albums` | 整体覆盖写回 `../src/site/albums.ts`（body={_meta, ...url→id}） |
| POST | `/api/albums/add` | body=`{name}` → 创建新图集，返回 `{id, name}` |
| POST | `/api/albums/rename` | body=`{id, name}` → 重命名 |
| POST | `/api/albums/delete` | body=`{id}` → 删除图集，旗下 url 自动降级为未分组 |
| GET | `/api/tags` | 读取 `../src/site/tags.ts` |
| POST | `/api/tags` | 整体覆盖写回 `../src/site/tags.ts`（body=JSON） |
| GET | `/api/orientations` | 读取 `../src/site/orientations.ts`（方向标记） |
| POST | `/api/orientations` | 整体覆盖写回（值 0/90/180/270；0 视为删除不落盘） |
| GET | `/api/proxy-images` | 尝试从 viewer 上游图床拉取真实数据(自动分页合并,单页 40 张硬上限被代理吸收) |
| POST | `/api/sync-deploy` | 提交并推送数据文件到 `origin/main`(body 可选 `{file}`，白名单内的 ts) |
| POST | `/api/run-ai` | spawn AI 工具，SSE 流式返回日志 |

---

## 常见问题

**Q：启动后浏览器没自动打开？**
A：查看终端输出的实际端口，手动访问 `http://127.0.0.1:<端口>/manager/`。

**Q：提示构建 manager 失败？**
A：在项目根目录手动执行 `npm run build:manager`，确认 Node ≥18 且依赖已安装（`npm install`）。

**Q：AI 工具报"无法加载模型"？**
A：模型优先用 `@vladmandic/face-api` npm 包自带的（`npm install` 后即有）。
若包不完整，脚本会自动从 jsDelivr 镜像下载到 `./weights/`（~6MB，已被 `.gitignore` 排除）。

**Q：编辑后 viewer 没生效？**
A：必须点 "💾 保存到 viewer"，否则只存在 localStorage。

**Q：AI 检测不到人脸？**
A：两种情况——① 图是二次元插画/动漫风：SSD MobileNet 只认真人脸，检不出是预期行为，
请改用「按横竖预填」批量预设或人工标注（详见上文检出率说明）；
② 真人照片但置信度不够：提高图片清晰度，或手动在编辑器里点焦点。

**Q：Node.js 版本不够？**
A：需要 ≥18，前往 https://nodejs.org 下载新版。

---

## 部署边界

- 项目根目录 `npm run build`（Vite）构建 index/gallery/404 到 `dist/`。
- `tools/`、`src/manager/`、`dist-manager/`、`.dev.vars` 和模型权重不会进入 Cloudflare 静态产物。
- 本地服务只监听 `127.0.0.1`。