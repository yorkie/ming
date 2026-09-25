import { createApp } from 'vue';
import RouterApp from '../pages/RouterApp.vue';
import { router } from '../lib/appRouter';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@fontsource-variable/inter/standard.css';
import '@hanzi.pro/webfonts-lxgw-wenkai/swap/400.css';
import '../styles/style.css';
import '../styles/theme.css';

createApp(RouterApp).use(router).mount('#app');
