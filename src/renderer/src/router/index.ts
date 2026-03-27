import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      children: [
        { path: '', name: 'home', component: () => import('@/views/HomeView.vue') },
        { path: 'install/detecting', name: 'install-detecting', component: () => import('@/views/install/InstallDetectingView.vue') },
        { path: 'install/result', name: 'install-result', component: () => import('@/views/install/InstallDetectionResultView.vue') },
        { path: 'install/software', name: 'install-software', component: () => import('@/views/install/InstallSoftwareView.vue') },
        { path: 'settings', name: 'settings', component: () => import('@/views/settings/SettingsView.vue') },
        { path: 'agent', name: 'agent', component: () => import('@/views/AgentHomeView.vue') },
      ],
    },
  ],
});
