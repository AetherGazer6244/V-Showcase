# V-Showcase · 流动图片墙

Vue 3 + Vite + TypeScript 静态站点：多行叠层流动图片墙 + 图集浏览页 + 本地 Manager 编辑器
图床 token 存在 Cloudflare 环境变量，仓库与前端代码零暴露

## 开始

> **Windows 一键启动：双击 `tools/site.bat`**（自动装依赖 → build → 起服务器 → 开浏览器并带 DevTools）
> **macOS / Linux 一键启动：`./tools/site.sh`**
> 想手动敲命令就用下面这份：

```bash
npm install

# 方式一（推荐，带代理看真实图床数据）：
npm run build
npx wrangler pages dev dist --port 8001

# 方式二（Vite 开发服务器，无代理 → 回退兜底图）：
npm run dev
```

> 代理模式需在 .dev.vars 写入 QUBU_TOKEN=你的token

## 页面

- index.html — 主页(流动图片墙)
- gallery.html — 图集页(相册网格 + 瀑布流)
- blog.html — 博客列表(`content/posts/*.md` 构建期渲染)
- post.html + /posts/<slug>/ — 文章详情(每篇一个静态页,含 TOC)
- music.html — 音乐页(网易云 ID + 直链双曲库,大封面 + 歌词/列表双 Tab,可拖动迷你播放胶囊跨页续播)
- projects.html — 项目页(状态筛选卡片,数据在 `content/projects.json`)
- about.html — 关于页(`content/pages/about.md` + 最近动态)
- settings.html — 访客偏好设置(主题三态/动效总开关/阅读偏好)
- 404.html — Cloudflare 404 页
- manager.html — 本地 Manager 写作台(不部署)

## 内容写作(博客 / 音乐 / 项目)

站点内容都在 `content/` 目录,由 Manager 写作台(本地 `127.0.0.1:8002`)或直接改文件维护:

```bash
npm run dev        # 写作台联调(dev script 已内置 build:posts,改 md 即时可见)
npm run build      # = build:posts(生成 src/generated + 每篇文章的 dist/posts/<slug>/index.html)→ vite build → build:post-pages
```

- `content/posts/*.md` — 博客文章(front-matter:title 必填,date/excerpt/cover/draft 可选)
- `content/pages/about.md` — 关于页正文(同一管线)
- `content/playlist.json` — 曲库(`{"source":"netease","id":"歌曲ID"}` 或 `{"source":"url","url":"直链","title":"曲名"}`)
- `content/projects.json` — 项目卡片

Manager「博客 / 音乐 / 项目」Tab 保存即校验并重建产物;「保存并部署」把对应文件 git 提交推送,由 Cloudflare Pages 自动构建上线。

## 部署

> ⚠️ **先认清哪个是真站**：真站是 **`v-showcase.pages.dev`**（带横杠），Cloudflare 账号 `a716333dd4ce6b3845a624acce143de2`。
> 历史上还建过一个同名的 `vshowcase.pages.dev`（不带横杠），那在**另一个账号**里，是个没人用的副本 —— 往它上面部署对真站毫无影响。

**Cloudflare Pages（Git 集成，首选）**，Dashboard → Workers & Pages → v-showcase → Settings：

1. Builds：Build command `npm run build`，输出目录 `dist`（Git 集成会忽略 wrangler.toml 的构建配置，必须手动设）
2. 环境变量（Production）：`QUBU_TOKEN`（Secret，7bu.top token，完整值含竖线）、`SITE_PASSWORD`（Secret，前台整站密码，见下节）、`OWNER_PASSWORD`（Secret，站长统计口令，可选，不配则统计页报「未配置」）、`NODE_VERSION=20`（可选，Node 22 亦可构建）

真站的 Git 集成**已连好并开着自动部署**：推 main → CF 自动构建部署。

⚠️ **构建失败最常见的原因：`wrangler.toml` 里的 D1 `database_id` 与账号对不上**。
`database_id` 是**账号专属**的，写错（哪怕只是指向了另一个账号里同名的库）会导致 CF 在「上传 Functions」阶段报
`database ... could not be found`，**整次构建失败、线上不更新**。当前真站用的库 id 是 `ee58e652-a085-4c15-99be-1d57b80596f0`（账号 a716333…）。
换账号时先 `npx wrangler d1 list` 对 id，再改 `wrangler.toml`。

**备用部署路线（不依赖面板 Git 集成）**：仓库自带 `.github/workflows/deploy.yml` —— push 到 main 会自动「装依赖 → 生成内容 → 类型检查 → 测试 → 构建 → wrangler 部署」。需要在 GitHub 仓库里配两个 secret（`Settings → Secrets and variables → Actions → New repository secret`）：

| 名称 | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN_VSHOWCASE` | **真站账号**的 API token（需 Pages:Edit / D1:Edit 权限） |
| `CLOUDFLARE_ACCOUNT_ID_VSHOWCASE` | 真站账号 id `a716333dd4ce6b3845a624acce143de2` |

secret 没配时该 workflow 只会跳过部署那一步（不报错），不影响其它流程。

**手动发布（应急）**：`npx wrangler pages deploy dist --project-name v-showcase --branch main`（本机已 `wrangler login` 且登录的是真站账号时可用）。

验证：`curl -I https://v-showcase.pages.dev/assets/main-*.js` 应 200 且为 JS MIME。

### D1（访客统计 + 图片点赞）

未配置时页面静默降级（不显示统计/点赞，不报错）：

```bash
npx wrangler d1 create v-showcase-db   # 把输出的 id 填入 wrangler.toml
npm run db:schema:remote           # 建表（本地开发用 db:schema:local）
```

查明细：`npx wrangler d1 execute v-showcase-db --remote --command "SELECT * FROM daily_stats"`

### 整站密码登录（v2.9.0）

前台整站由 `functions/_middleware.js` 拦截：未登录访问任何页面 → 内联登录页；未登录调 API → 401。

- **fail-closed**：`SITE_PASSWORD` 未配置时全站锁定并显示明确提示页——有意不同于 images.js 的「缺配置降级放行」，私站的锁必须一眼可见
- 会话：HMAC-SHA256 签名 cookie（HttpOnly / Secure / SameSite=Lax），30 天免登录；**签名密钥就是密码本身，改密码 = 所有已登录设备全部下线**（刻意不设独立 `AUTH_SECRET`，否则改密码踢不掉人）
- 防爆破：密码恒时比较 + 错误响应固定延迟 1s；建议再配 1 条 CF 免费版 WAF 限流规则（如同一 IP 10 次/分钟）兜底
- 登出：底部胶囊「退出」→ `/api/logout` 清 cookie → 回登录页显示「已退出登录」
- 本地开发：复制 `.dev.vars.example` 为 `.dev.vars`（已 gitignore），填入 `SITE_PASSWORD`
- 有意接受的副作用：搜索引擎无法收录内页（爬虫只见登录页）；访客统计只统计已登录访客

### 站长统计页（v2.13.0）

`/stats.html` —— 只有站长能看的经营数据（访问趋势 + 点赞排行）。

- **两把锁**：全站密码（`_middleware.js`，进站访客都过得了）之外再加一把**站长密码** `OWNER_PASSWORD`，访客即使拿到站点密码也看不到统计数据
- **接口**：`GET /api/stats`，请求头带 `x-owner-key: <站长密码>`；恒时比较防猜解（复用 `functions/lib/auth.js`）
- **fail-closed**：`OWNER_PASSWORD` 未配置 → 接口 503 明确报错，不退化成「谁都能看」
- **密码只存 sessionStorage**（关标签页即失效），不进 localStorage
- **数据只读**：`daily_stats`（PV/UV 按天）+ `likes`（点赞数），不改表结构；UV 仍是按 `sha256(IP+UA+日)` 按日轮转，不存原始 IP
- **配置**：Cloudflare Pages → v-showcase → Settings → Environment variables → 加 `OWNER_PASSWORD`（Secret）→ **重新部署**（面板改环境变量不会自动生效，需重新部署一次）
- 本地开发：`.dev.vars` 里加 `OWNER_PASSWORD=xxx`（`.dev.vars` 已 gitignore）

## 注意事项

- 图床代理会并发拉全部分页，图床图片建议控制在 400 张以内
- Manager 上传会自动做三件事：按真实格式改名、跳过图床里已有的同内容图、传完验一次链接（详见 `tools/README.md` 的「上传管线」）
- Manager「配置」Tab 保存会整体重写 config.ts，手工注释会丢失；mode/token 不可改
- 统计/点赞接口无鉴权，个人站可接受；UV 按 `sha256(IP+UA+日)` 按日轮转，不存原始 IP
- **站长统计例外**：`/api/stats` 要 `OWNER_PASSWORD`（见上节），是全站唯一需要额外口令的接口
- AI 焦点分析是 merge 不是覆盖，不会清掉手工标注的焦点

## 本地预览主站

- Windows：双击 `tools/site.bat`（一键：装依赖 + build + 起 wrangler + 开浏览器，DevTools 自动展开）
- macOS / Linux：`./tools/site.sh`
- 监听 `127.0.0.1:8001`，走真实图床数据（等价于「开始」里的方式一）
- 每次启动都会重新 build，所以看到的一定是最新代码；改完 `src/` 再跑一次即可
- 服务跑在独立的 `V-Showcase Site` 黑窗口里：关掉那个窗口、或在里面按 Ctrl+C 即停止
- 缺 `.dev.vars` / `QUBU_TOKEN` 时启动器会直接报错停下（否则只会看到 16 张兜底占位图）
- 已在运行时重复双击不会起第二份服务，只会重新打开浏览器
- 没装过 wrangler 时首次要联网下载（1-3 分钟）；提示登录就先跑 `npx wrangler login`

## 本地 Manager

- Windows：双击 `tools/dev.bat`（一键装依赖 + 启动 + 开浏览器）；`tools/console.bat` 新开标签
- macOS / Linux：`./tools/start.sh`
- 监听 `127.0.0.1:8002`，详见 `tools/README.md`

## 文件结构

```
src/shared      前后端共享:types / utils / apiClient
src/site        Viewer 站点:视图组件 + likes/visit/settings/player 单例模块 + 样式
src/manager     本地 Manager 写作台(焦点 / 图集 / 标签 / 博客 / 音乐 / 项目 / 配置 七个 Tab)
content/        站点内容:posts 博客文章 / pages 页面 / playlist.json / projects.json
functions/api   Pages Functions:images 图床代理 / music 网易云代理 / visit 统计 / likes 点赞
tools/          本地启动器 + 内容管线(posts 构建脚本) + AI 工具 + node 侧测试
schema.sql      D1 表结构(daily_stats / visitors / likes)
```

---

## 功能设计

- [x] 主页搭建
- [x] 图集搭建
- [x] 图集页(用户手动图集)+ 本地管理器拖拽
- [x] 焦点编辑器 + AI 焦点识别
- [x] 标签系统(Manager 打标签 → 图集页标签搜索 / 灯箱标签)
- [x] 设置页(访客偏好:主题/行数/宽度/速度/动画,localStorage)
- [x] 深色/浅色主题切换(设置页深/浅两档,防闪烁,CSS 变量组)
- [x] SEO 基建(OG 分享卡片/canonical/sitemap/robots,404 noindex)
- [x] 展示增强(灯箱缩放/平移/下载、「全部」瀑布流视图)
- [x] 触屏手动(流动墙拖拽/双击暂停/惯性,灯箱滑动切图/pinch 缩放/双击放大)
- [x] 图片点赞(灯箱 ♥ + 瀑布流角标,本地去重 + D1 原子计数,失败回滚)
- [x] 访客统计(页脚胶囊 PV/UV + 悬浮今日数据,D1 按日聚合,爬虫跳过)
- [x] 收藏夹(灯箱 ⭐ / 瀑布流角标 / 设置页「我的收藏」区块;localStorage 有序列表,导航「收藏」直达;图床下架自动过滤)
- [x] 屏保模式(全屏交叉淡入 + Ken Burns,焦点防裁脸;设置页可调间隔/顺序/缩放,闲置自动进入默认关,`?screensaver=1` 直达)
- [x] 主页内容动态轮换(登台窗口 + 每行重排,定时换掉一批图;设置页可开关/调间隔;系统「减少动态效果」时自动停)
- [x] 设计系统改版(明亮主题默认 + 琥珀品牌色 + token 体系,主题三态 light/dark/auto,动效总开关,暗色萤火特效)
- [x] Cecilian-Hub 风格对齐(v2.3:靛蓝品牌色 + 玻璃卡片语言 + 拍立得叠层图集 + 音乐页大封面双 Tab 重构 + 可拖动迷你播放胶囊(主页隐身)+ 底栏胶囊固定常驻;修复 /api/music 边缘缓存命中即 500 的不可变头 bug)
- [x] 博客(`content/posts` Markdown 管线 + 列表/详情页 + TOC + 阅读偏好 + 每篇独立静态页)
- [x] 博客页对齐 Cecilian-Hub(v2.4:front-matter tags 标签体系(归一化上限 6) + 列表卡全封面压字重做 + `?tag=` 筛选联动 + 详情页卡片化(aspect-video 封面卡顶 + meta 胶囊 + prose 细节))
- [x] 体验打磨(v2.5:设置页重设计(分组头/自绘滑杆/主题预览卡/修旧色残留) + 关于页 ProfileCard(统计 chips + 正文卡) + 主页开屏遮罩(去「加载图片 X/Y」) + logo 字标(V 渐变方块) + 轮换预热消空白 + Manager 控制台靛蓝统一)
- [x] 设置页细节修正(v2.6:分段控件收缩到内容宽(消除右侧大片空白) + 轮换间隔改自绘滑杆 15–180s + 屏保闲置 0–30 分 / 换图间隔 3–120s 自定义滑杆 + 窄屏分段均分防溢出)
- [x] Manager 控制台重设计(v2.7:补 4 个幽灵变量(修琥珀残留/聚焦高亮失效) + 前台预览跳转(侧栏 6 页面外链 + 基址可编辑 localStorage + 各 Tab 顶栏「打开前台」) + 品牌字标/三小节导航 + 控件体系(三态按钮/聚焦辉光/胶囊分段/真开关/mono 芯片) + 去 emoji + 统计 chips/玻璃表格/空态排版 + 4 弹窗统一)
- [x] 音乐页(网易云 ID + 直链双曲库,`/api/music` 代理,全站常驻播放条,歌词轴,MPA 跨页续播)
- [x] 音乐页重做「云端乐律」(v2.8:大标题/副标题 hero + 黑胶唱片卡(播放旋转/同心纹/中心孔) + 歌词/歌单居中胶囊分段 + 歌词当前行靛蓝放大淡出滚动 + 当前封面模糊背景(亮暗双主题遮罩) + 控件行 SVG 化(四态模式/大圆播放) + 歌单复用搜索即播)
- [x] 项目页(状态筛选卡片)与关于页(siteConfig 身份卡 + about.md + 最近动态)
- [x] Manager 写作台(博客/音乐/项目三 Tab,保存即校验重建,单文件部署)
- [x] 前台整站密码登录(v2.9.0:`_middleware.js` 全站拦截 fail-closed(未配密码锁死显提示页) + 内联登录页/锁定页零外部资源 + HMAC 签名会话 cookie 30 天免登录(改密码=全员下线) + 恒时比较/错密码延迟 1s + `/api/logout` 与底部「退出」入口)
- [x] 切页性能优化(v2.9.2:导航悬停/键盘聚焦预取页面 HTML + 空闲预热视图代码 + 图片清单 5 分钟缓存/过期先显示旧数据并后台刷新)
- [x] 深浅主题切换动画(v2.9.3:设置页点主题卡 → 新主题以「按钮中心圆」向外扩散,View Transitions 实现,减动效/旧浏览器自动降级为即时切换)
- [x] 流动墙空白修复(v2.9.4:浏览器挂起 rAF(窗口被遮挡/节能模式)时加载态不落地 → 卡片全透明;改为 rAF + setTimeout 双通道提交,开屏遮罩改「类名 + 定时器」淡出,不再依赖 Vue <transition> 的 rAF)
- [x] 非主页图片蒙版背景(v2.10.0:博客/图集/音乐/项目/关于/设置/文章页从主页图池按页面键稳定选 1 张,模糊铺满 + 渐变蒙版 + 主题薄纱;主页与 404 不挂,纯装饰层不拦点击)
- [x] 上传管线加固(v2.11.0:Manager 上传三道闸 — ①入队时 magic bytes 判定真实格式,名实不符就地改名(webp 伪装 .jpg 根治),非图片直接拒收,SHA-256 批内去重;②服务端用文件 md5 与图床目录对账(索引缓存 5 分钟),命中则不上传、直接复用已有外链;③上传后验活,区分「确定死链」与「本机 DNS 不通」;另有批后外链对账,映射数≠唯一外链数即报警)
- [x] 音乐胶囊位置修复(v2.11.1:位置改按「视口比例」记忆而非绝对像素,浏览器缩放/改窗口大小时胶囊不再跑偏、来回缩放也不再往角落漂;缩放时只重算显示坐标不写回记忆值;v1 旧像素坐标自动兼容)
- [x] 滚动条跟随深浅主题(v2.11.2:全局声明 color-scheme,浏览器原生滚动条/表单控件跟随站点深浅切换(深色下不再是系统浅色亮条);音乐页歌词与歌单改自绘细滚动条,颜色取主题变量自动适配)
- [x] CI 类型检查修复(v2.11.3:CI 在 typecheck 前先生成 `src/generated/`(构建产物,已 gitignore),否则 `src/site/posts.ts` import `../generated/*.json` 报 TS2307,CI 长期红;README 同步修正部署说明 —— Pages 项目 Git 集成断开时用手动发布)
- [x] 自动部署工作流(v2.12.0:新增 `.github/workflows/deploy.yml` —— push 到 main 自动「装依赖 → 生成内容 → 类型检查 → 测试 → 构建 → wrangler 部署」,绕开失效的 Pages Git 集成;需在仓库配 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 两个 secret,没配则自动跳过)
- [x] 自动部署工作流修复(v2.12.1:密钥判断原先写在 job 级 `if` 里,而 GitHub 的 `secrets` 上下文在该位置不可用,会报「Unrecognized named-value: 'secrets'」,导致整个部署流程 1 秒秒挂;改为在「部署」这一步用 `env` 间接判断 —— 密钥没配时只跳过部署这步,前面的检查/测试/构建照常跑完)
- [x] 真站部署链路修复(v2.12.2:⚠️ **真站其实是 `v-showcase.pages.dev`(带横杠),在另一个 Cloudflare 账号 a716333… 里**;仓库的 `wrangler.toml` 里 D1 `database_id` 却指向了另一个账号的库 → 真站从 a62d46f 起每次 CF 构建都在「上传 Functions」阶段报「database could not be found」而失败,滚动条/胶囊两个修复一直没上线。同时把 `wrangler.toml` 的 `name`、`tools/deploy.bat`、Actions 备用部署路线统一指向真站项目,并在 README 里写清「哪个是真站、D1 id 必须与账号对应」)
- [x] 站长统计页(v2.13.0:新增 `/stats.html` —— 访问趋势(近 30 天 PV/UV 柱状图 + 每日明细)与点赞排行;除全站密码外再加一把**独立站长密码** `OWNER_PASSWORD`(恒时比较,fail-closed:没配就 503 报错而不是谁都能看),密码只存 sessionStorage;设置页加「站长工具」入口,数据只读不改表结构)
- [x] 博客阅读体验三件套(v2.14.0:代码块右上角加「复制」按钮(点了变「已复制」,剪贴板 API 不可用时退回 textarea 方案);文章页顶部加阅读进度条(按【正文】位置算,不是整页,文章短也不会一打开就满格);正文图片补「点击放大」提示 —— 灯箱本身 v2.4 就接好了,这次只是补上可点击的视觉提示)
- [x] 流动墙改真滚动(v2.15.0:首页图片墙的滚动从「CSS transform 搬整行」改成浏览器**真滚动**(scrollLeft,整数像素)—— 旧做法把整行当成一张大照片交给显卡搬,每帧落在半像素上显卡只能「猜着画」→ 整行发虚(用户反馈:滑动时模糊太严重);真滚动按物理像素对齐,任何缩放/屏幕下都清晰。顺带简化:触屏拖拽不再叠一层 transform 位移层(直接改滚动位置);换班按**相位**还原位置,换班不跳;悬停/按住/双击暂停与惯性全部保留;标签页切到后台自动停摆,回前台按真实流逝时间补上;流速口径与旧动画一致)
- [x] 主页保活(v2.16.0:站内切走再切回主页,整面墙**不拆不重建** —— App.vue 用 `<KeepAlive include="['HomeView']">` 只保活主页)→ 切回是「原样秒开」:不重拉图片名单、不重挂缩略图、不重弹开屏遮罩,也不用等所有图加载完才揭幕(本地实测切回 51ms 出墙)。离开主页期间流动循环、轮换计时、事件监听全部停掉(不在后台空转),回来时按真实流逝的时间续上。其余视图照旧挂载即用,不进缓存,避免越存越多)
- [x] 图集网格重排(v2.16.1:图集页的拍立得卡片原来「列数浮动 + 间距只有 32px」——宽屏会排成 6 列;而且拍立得三层照片是旋转错位摆的,每层都伸出卡片格外(底层右伸 ~28px、中层左伸 ~17px),两边伸出量加起来超过间距 → 相邻两摞照片直接压在对方身上,一行下来糊成一堆(用户反馈:图集过于集中 / 挤在了一起)→ 桌面端**固定每行 3 个**、卡片大幅变大(1920 屏上约 546px/张,原来 4 列时只有 321px);卡片间距 32px 加到 **72px**(中屏 56px),实测各宽度下相邻两摞净空 9~27px,互不重叠;悬停张开的幅度收了一点,张开时也不压隔壁;悬停的整摞提到最上层,不会被隔壁的歪照片盖住;手机上卡片小,单独把歪照片幅度调小,保证每行仍是 2 个)
- [x] 主页闲时升级原画(v2.17.0:主页流动墙先用 600w 缩略图开屏(快、省流量),墙就绪后**只对真正出现在屏幕上的卡片**在后台一张一张预载原图,载好即换 —— 原图进了浏览器缓存,画面更清晰,之后点灯箱看大图也是秒开。开了「省流模式」或网络是 2G 就自动不升级;图床没生成缩略图的图本来就是原画,直接跳过;原图加载失败的保持缩略图;单次会话最多升级 80 张(墙会一直循环,不加闸门等于把整个图库都下成原图);标签页切后台/换班时暂停,回前台续上。判定逻辑拆成纯模块 wallHd.ts,可单测)
- [ ] 设置搭建(站长端深水区:数据源切换 UI)


---

## 项目总结

- 图片托管 [去不图床7bu.top](https://7bu.top)

- 网站托管 [cloudflare Page](https://dash.cloudflare.com/)

- 许可说明 MIT

- 项目链接 https://vshowcase.pages.dev/

- 仓库地址：https://github.com/AetherGazer6244/V-Showcase

- AI 焦点分析：[@vladmandic/face-api](https://github.com/vladmandic/face-api)
- 本地图集管理: Manager 拖拽（`npm run build:manager` 本机构建，产物不入库）
