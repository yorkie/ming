import { createRouter, createWebHistory } from 'vue-router';

const settingsSections = /^(usage|appearance|files|reviews|copilot|github)$/;

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('../pages/HomeApp.vue') },
    { path: '/demo/', alias: '/demo', component: () => import('../pages/DemoApp.vue') },
    { path: '/projects/:projectId/:pathMatch(.*)*', component: () => import('../pages/ProjectApp.vue') },
    { path: '/console/:section(usage|appearance|files|reviews|copilot|github)?', component: () => import('../pages/SettingsApp.vue'), beforeEnter: to => {
      const section = to.query.section;
      if (!to.params.section && typeof section === 'string' && settingsSections.test(section))
        return { path: `/console/${section}`, replace: true };
    } },
    { path: '/settings/:section(usage|appearance|files|reviews|copilot|github)?', redirect: to => {
      const section = to.params.section || to.query.section;
      return { path: typeof section === 'string' && settingsSections.test(section)
        ? `/console/${section}` : '/console/' };
    } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
