/* ============================================================
 * Cloudflare Pages Function — 全站密码登录(中间件即路由:文件名 _middleware.js)
 * ------------------------------------------------------------
 * 拦截一切请求(9 个页面 + /api/*):
 *   ✓ 已带有效会话 cookie      → 放行 next()
 *   ✓ /api/login / /api/logout → 放行(登录/登出入口本身不能被锁)
 *   ✗ 页面请求(Accept 含 text/html 或无扩展名路径) → 回【内联登录页】
 *     (URL 不变、零外部资源,登录成功后前端 location.reload() 原地复活)
 *   ✗ 其余(API/静态资产) → 401 JSON
 *
 * 三个关键设计(改动前都有问题,勿回退):
 *
 * 1. fail-closed:SITE_PASSWORD 未配置时【全站锁定】并返回明确提示,
 *    而不是沿用 images.js 那种「缺配置放行 + console.warn」。
 *    私站的命门就是这把锁——静默放行等于白锁,站长还察觉不了;
 *    锁死则部署完一打开就能看见「站点未配置密码」,一眼定位。
 *    (有意偏离 images.js 惯例,2026-11 方案评审定案)
 *
 * 2. 登录页必须零外部资源:字体/样式/脚本全部内联。
 *    否则就得为静态资产开白名单,白名单一旦写宽,登录页之外的
 *    内容在未登录时也能被摸到。
 *
 * 3. 恒时比较 + 错误固定延迟 1s 在 /api/login(见 login.js),
 *    这里只做 cookie 校验;两者共同抬高暴力穷举成本。
 *    进阶:CF 免费版可配 1 条 WAF 限流规则(如 10 次/分钟/IP),见 README。
 * ============================================================ */

import { verifySession, readCookie, SESSION_COOKIE } from './lib/auth.js';

const PUBLIC_PATHS = new Set(['/api/login', '/api/logout']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) return next();

  const password = env.SITE_PASSWORD;
  if (!password) {
    console.warn('[V-Showcase auth] SITE_PASSWORD 未配置 —— 全站锁定中(fail-closed)');
    return isApiPath(url.pathname)
      ? json(503, { status: false, message: '站点未配置密码(SITE_PASSWORD),请联系站长在 Cloudflare 后台配置', data: {} })
      : lockedHtml();
  }

  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (token && (await verifySession(password, token))) return next();

  if (isHtmlRequest(request, url.pathname)) return loginHtml(url);
  return json(401, { status: false, message: '未登录', data: {} });
}

/* ---------- 判定 ---------- */

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
}

/** 页面导航:Accept 带 text/html,或无扩展名的根路径(curl/直接访问也算页面) */
function isHtmlRequest(request, pathname) {
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('text/html')) return true;
  return !pathname.includes('.') && !isApiPath(pathname);
}

/* ---------- 响应 ---------- */

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** SITE_PASSWORD 未配置:明确的锁定提示页(自包含,同样零外部资源) */
function lockedHtml() {
  return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>站点未配置 · V-Showcase</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#101218;color:#e2e8f0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
.card{max-width:420px;padding:40px 44px;text-align:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:20px}
h1{margin:0 0 12px;font-size:1.25rem;letter-spacing:.08em}
p{margin:0;color:#9aa1ab;font-size:.9rem;line-height:1.8}
code{background:rgba(255,255,255,.08);padding:2px 8px;border-radius:6px;font-size:.85em}
</style>
</head>
<body><div class="card"><h1>站点未配置密码</h1>
<p>隐私锁已启用,但环境变量 <code>SITE_PASSWORD</code> 尚未配置。<br>请站长在 Cloudflare Pages → 设置 → 变量和机密 中添加后重新部署。</p>
</div></body></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** 内联登录页:暗色玻璃卡 + 靛蓝渐变按钮,与站点视觉同源;零外部资源 */
function loginHtml(url) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#101218">
<title>访客验证 · V-Showcase</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(1200px 800px at 70% -10%,rgba(99,102,241,.22),transparent 60%),radial-gradient(900px 700px at 10% 110%,rgba(129,140,248,.14),transparent 55%),#101218;color:#e2e8f0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
.card{width:min(400px,100%);padding:40px 40px 34px;text-align:center;background:rgba(255,255,255,.06);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);border-radius:22px;box-shadow:0 18px 44px rgba(0,0,0,.45)}
.logo{width:52px;height:52px;margin:0 auto 18px;border-radius:13px;background:linear-gradient(135deg,#6366f1,#818cf8);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:26px;color:#fff;box-shadow:0 8px 22px rgba(99,102,241,.45)}
h1{margin:0 0 6px;font-size:1.3rem;font-weight:800;letter-spacing:.1em}
p.sub{margin:0 0 26px;color:#9aa1ab;font-size:.85rem;letter-spacing:.04em}
.field{position:relative;margin-bottom:14px}
input{width:100%;padding:13px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#e2e8f0;font-size:1rem;outline:none;transition:border-color .2s ease,box-shadow .2s ease}
input::placeholder{color:#6b7280}
input:focus{border-color:#818cf8;box-shadow:0 0 0 3px rgba(99,102,241,.25)}
button{width:100%;padding:13px 16px;margin-top:4px;border:0;border-radius:14px;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;font-size:1rem;font-weight:700;letter-spacing:.14em;cursor:pointer;transition:filter .15s ease,transform .1s ease}
button:hover{filter:brightness(1.08)}
button:active{transform:scale(.985)}
button:disabled{filter:grayscale(.4);cursor:wait}
.msg{min-height:20px;margin:12px 0 0;color:#f87171;font-size:.82rem;letter-spacing:.03em}
.msg.out{color:#9aa1ab}
.shake{animation:shake .4s ease}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
.foot{margin-top:22px;color:#5b6270;font-size:.72rem;letter-spacing:.06em}
</style>
</head>
<body>
<div class="card">
  <div class="logo">V</div>
  <h1>访客验证</h1>
  <p class="sub">这是一个私密空间 · 请输入站长分享的密码</p>
  <form id="f">
    <div class="field"><input id="pw" type="password" placeholder="访问密码" autocomplete="current-password" autofocus></div>
    <button id="btn" type="submit">进 入</button>
    <p class="msg" id="msg"></p>
  </form>
  <div class="foot">V-Showcase · 云端Showcase</div>
</div>
<script>
(function(){
  var msg=document.getElementById('msg'),btn=document.getElementById('btn'),pw=document.getElementById('pw'),card=document.querySelector('.card');
  if(new URLSearchParams(location.search).get('logout')==='1'){msg.textContent='已退出登录';msg.className='msg out'}
  document.getElementById('f').addEventListener('submit',function(e){
    e.preventDefault();
    var v=pw.value;
    if(!v){msg.textContent='请输入密码';msg.className='msg';return}
    btn.disabled=true;msg.textContent='验证中…';msg.className='msg';
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:v})})
      .then(function(r){return r.json().then(function(j){return{j:j,ok:r.ok}})})
      .then(function(x){
        if(x.ok&&x.j.status){msg.textContent='欢迎回来,正在进入…';msg.className='msg out';setTimeout(function(){location.replace(location.pathname)},300)}
        else{msg.textContent=x.j.message||'密码不正确';msg.className='msg';card.classList.remove('shake');void card.offsetWidth;card.classList.add('shake');btn.disabled=false;pw.value='';pw.focus()}
      })
      .catch(function(){msg.textContent='网络异常,请重试';msg.className='msg';btn.disabled=false});
  });
})();
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
