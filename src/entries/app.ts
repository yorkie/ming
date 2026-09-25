import { createApp } from 'vue';
import RouterApp from '../pages/RouterApp.vue';
import { router } from '../lib/appRouter';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '../styles/style.css';
import '../styles/theme.css';

createApp(RouterApp).use(router).mount('#app');
