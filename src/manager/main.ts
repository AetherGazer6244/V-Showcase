import { createApp } from 'vue';
import App from './App.vue';
import { migrateLegacyStorage } from '../site/storageMigration';
import './styles.css';

migrateLegacyStorage();
createApp(App).mount('#app');
