import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('../pages/HomeApp.vue') },
    { path: '/demo/', alias: '/demo', component: () => import('../pages/DemoApp.vue') },
    { path: '/projects/', alias: '/projects', component: () => import('../pages/ProjectApp.vue') },
    { path: '/console/', alias: '/console', component: () => import('../pages/SettingsApp.vue') },
    { path: '/settings/', alias: '/settings', redirect: to => ({ path: '/console/', query: to.query }) },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
