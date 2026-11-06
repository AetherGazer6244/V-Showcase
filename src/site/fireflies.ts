/* ============================================================
 * 萤火微特效 — 暗色主题专属的氛围粒子(2026-11 品牌改版)
 * ------------------------------------------------------------
 * 设计约束(与「照亮 / 旅人」品牌文案契合):
 *   - 仅暗色主题下运行;明亮主题 / auto 解析为 light 时画布熄灭
 *   - 动效总开关(settings.motion)关闭即熄灭
 *   - 系统 prefers-reduced-motion 时不启动
 *   - 页面隐藏(document.hidden)暂停绘制,回前台恢复
 *   - 数量固定少量(16 只),rAF 驱动,绘制开销可忽略;
 *     DPR 封顶 2,避免高分屏放大填充率
 *
 * 实现说明:canvas 固定铺满视口、pointer-events:none、z-index:0,
 * 插入为 body 第一个节点 → 永远绘制在应用内容之下。
 * 主题切换由 watchEffect 驱动(亮起/熄灭用 CSS opacity 过渡,不闪断)。
 * ============================================================ */
import { watchEffect } from 'vue';
import { useSettings, resolveTheme } from './settings';

/** 萤火数量(少即是多,简洁定位) */
const COUNT = 16;
/** 单只萤火的呼吸周期(ms)与漂移速度基准(px/s) */
const PULSE_MS = 3800;
const DRIFT = 9;

interface Fly {
  x: number; y: number;       // 当前位置(px)
  vx: number; vy: number;     // 速度(px/s,含正负)
  phase: number;              // 呼吸相位 [0,1)
  size: number;               // 半径(px)
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 创建一只萤火:随机位置 + 随机小速度 + 随机呼吸相位 */
function spawn(w: number, h: number): Fly {
  const ang = Math.random() * Math.PI * 2;
  const speed = DRIFT * (0.5 + Math.random());
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed * 0.7,
    phase: Math.random(),
    size: 1.2 + Math.random() * 1.8,
  };
}

export function initFireflies(): void {
  if (typeof document === 'undefined') return;

  const canvas = document.createElement('canvas');
  canvas.id = 'fireflies';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { settings } = useSettings();
  let dpr = 1;
  let w = 0;
  let h = 0;
  let flies: Fly[] = [];
  let raf = 0;
  let last = 0;
  let running = false;

  function resize(): void {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 尺寸变化后把出界萤火收回视口(不重建,保持连续感)
    for (const f of flies) {
      f.x = Math.min(f.x, w);
      f.y = Math.min(f.y, h);
    }
  }

  function draw(now: number): void {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    ctx!.clearRect(0, 0, w, h);
    for (const f of flies) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      // 越界环绕(左出右进等),比反弹更不显机械
      if (f.x < -8) f.x = w + 8; else if (f.x > w + 8) f.x = -8;
      if (f.y < -8) f.y = h + 8; else if (f.y > h + 8) f.y = -8;
      // 呼吸:正弦调透明度,叠加轻微尺度脉动
      f.phase = (f.phase + dt * 1000 / PULSE_MS) % 1;
      const glow = 0.5 + 0.5 * Math.sin(f.phase * Math.PI * 2);
      const alpha = 0.10 + 0.38 * glow;
      const r = f.size * (0.85 + 0.3 * glow);
      ctx!.beginPath();
      ctx!.fillStyle = `rgba(245, 158, 11, ${alpha.toFixed(3)})`;
      ctx!.shadowColor = 'rgba(245, 158, 11, 0.55)';
      ctx!.shadowBlur = 8 + 10 * glow;
      ctx!.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx!.fill();
    }
    ctx!.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  }

  function start(): void {
    if (running || raf) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(draw);
  }

  function stop(): void {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    ctx?.clearRect(0, 0, w, h);
  }

  /** 当前是否允许点亮:暗色主题 + 动效总闸 + 未开启减少动态效果 */
  function shouldRun(): boolean {
    const s = settings.value;
    return resolveTheme(s.theme) === 'dark' && s.motion && !prefersReducedMotion();
  }

  // 首次满足条件时才初始化萤火群与视口尺寸
  watchEffect(() => {
    const on = shouldRun();
    canvas.classList.toggle('on', on);
    if (on) {
      if (!flies.length) {
        resize();
        flies = Array.from({ length: COUNT }, () => spawn(w, h));
      }
      if (!document.hidden) start();
    } else {
      stop();
    }
  });

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (shouldRun()) start();
  });
}
