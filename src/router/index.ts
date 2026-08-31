/**
 * 路由配置：8 个懒加载路由（5 个底部 Tab + 同步页 / 回收站页从设置入口进入）
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/views/Home.vue') },
  { path: '/readings', name: 'readings', component: () => import('@/views/Readings.vue') },
  { path: '/bills', name: 'bills', component: () => import('@/views/Bills.vue') },
  { path: '/stats', name: 'stats', component: () => import('@/views/Stats.vue') },
  { path: '/budget', name: 'budget', component: () => import('@/views/Budget.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue') },
  { path: '/sync', name: 'sync', component: () => import('@/views/Sync.vue') },
  { path: '/trash', name: 'trash', component: () => import('@/views/Trash.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
