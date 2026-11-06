/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

/** 由各入口 HTML 内联脚本设置,决定 App.vue 渲染哪个视图 */
interface Window {
  __VIEW__?: string;
  /** 文章详情页:由构建期生成的 dist/posts/<slug>/index.html 注入;
   *  开发模式(vite dev)走 post.html?slug= 查询参数兜底 */
  __POST_SLUG__?: string;
}
