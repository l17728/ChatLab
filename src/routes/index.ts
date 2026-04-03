import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  routes: [
    // Web UI routes (browser-based access)
    {
      path: '/login',
      name: 'webui-login',
      component: () => import('@/pages/Login.vue'),
      meta: { title: 'Login - ChatLab Web UI' },
    },
    {
      path: '/dashboard',
      name: 'webui-dashboard',
      component: () => import('@/pages/Dashboard.vue'),
      meta: { title: 'Dashboard - ChatLab Web UI', requiresAuth: true },
    },
    {
      path: '/webui-settings',
      name: 'webui-settings',
      component: () => import('@/pages/Settings.vue'),
      meta: { title: 'Settings - ChatLab Web UI', requiresAuth: true },
    },

    // Original chat application routes
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/home/index.vue'),
    },
    {
      path: '/group-chat/:id',
      name: 'group-chat',
      component: () => import('@/pages/group-chat/index.vue'),
    },
    {
      path: '/private-chat/:id',
      name: 'private-chat',
      component: () => import('@/pages/private-chat/index.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/settings/index.vue'),
    },
  ],
  history: createWebHashHistory(),
})

router.beforeEach(async (to, _from, next) => {
  // Check if route requires authentication
  if (to.meta.requiresAuth) {
    // In a real implementation, check if user is authenticated
    // For now, allow navigation
    console.log('[Router] Route requires auth:', to.name)
  }
  next()
})

router.afterEach((to) => {
  // Update page ID for CSS context
  document.body.id = `page-${to.name as string}`
  // Update page title
  if (to.meta.title) {
    document.title = to.meta.title as string
  }
})

/**
 * 预加载关键路由组件
 */
function preloadCriticalRoutes() {
  requestIdleCallback(() => {
    // 预加载聊天分析页面（最常访问的路由）
    import('@/pages/group-chat/index.vue')
    import('@/pages/private-chat/index.vue')
    // 预加载 Web UI 路由
    import('@/pages/Login.vue')
    import('@/pages/Dashboard.vue')
    import('@/pages/Settings.vue')
  })
}

// 路由准备就绪后触发预加载
router.isReady().then(preloadCriticalRoutes)
