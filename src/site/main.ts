import { createApp } from 'vue';
import App from './App.vue';
import { migrateLegacyStorage } from './storageMigration';
import { initSettings } from './settings';
import { initLikes } from './likes';
import { initFireflies } from './fireflies';
/* 载入顺序 = 级联优先级:overrides 依赖「后载入者胜」,顺序不可调整 */
import './styles/base.css';
import './styles/wall.css';
import './styles/gallery.css';
import './styles/lightbox.css';
import './styles/screensaver.css';
import './styles/settings.css';
import './styles/post.css';
import './styles/pages.css';
import './styles/player.css';
import './styles/overrides.css';

migrateLegacyStorage();
initSettings();
initLikes();
initFireflies();
createApp(App).mount('#app');
