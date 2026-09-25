import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('../pages/HomeApp.vue') },
    { path: '/projects/', alias: '/projects', component: () => import('../pages/ProjectApp.vue') },
    { path: '/settings/', alias: '/settings', component: () => import('../pages/SettingsApp.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
