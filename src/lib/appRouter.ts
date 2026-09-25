import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../pages/HomeApp.vue') },
    { path: '/projects/', alias: '/projects', component: () => import('../pages/ProjectApp.vue') },
    { path: '/settings/', alias: '/settings', component: () => import('../pages/SettingsApp.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
