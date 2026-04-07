import { createRouter, createWebHashHistory } from 'vue-router'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

export const router = createRouter({
  routes: [
    // Web UI routes (browser-based access)
    {
      path: '/login',
      name: 'webui-login',
      component: () => import('@/pages/Login.vue'),
      meta: { title: 'Login - ChatLab Web UI', requiresAuth: false },
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

/**
 * Check if user has valid authentication token
 */
function hasValidToken(): boolean {
  const token = localStorage.getItem('chatlab_token')
  const expiresAt = localStorage.getItem('chatlab_token_expires_at')

  if (!token || !expiresAt) {
    console.log('[Router Auth] No token found in localStorage')
    return false
  }

  const expiresAtNum = parseInt(expiresAt, 10)
  const isExpired = expiresAtNum <= Date.now()

  if (isExpired) {
    console.log('[Router Auth] Token expired at', new Date(expiresAtNum).toISOString())
    localStorage.removeItem('chatlab_token')
    localStorage.removeItem('chatlab_token_expires_at')
    return false
  }

  console.log('[Router Auth] Valid token found, expires at', new Date(expiresAtNum).toISOString())
  return true
}

router.beforeEach(async (to, from, next) => {
  const isWebUI = isBrowserEnvironment()
  const requiresAuth = (to.meta.requiresAuth as boolean) ?? false

  console.log(`[Router Guard] Navigating to ${to.path} (${to.name})`, {
    isWebUI,
    requiresAuth,
    hasToken: !!localStorage.getItem('chatlab_token'),
  })

  // In browser/webUI mode, redirect root path to dashboard
  if (to.path === '/' && isWebUI) {
    console.log('[Router Guard] WebUI mode: redirecting / to /dashboard')
    return next('/dashboard')
  }

  // Web UI authentication guard
  if (isWebUI) {
    // If route requires auth and user is not authenticated
    if (requiresAuth && !hasValidToken()) {
      console.log(`[Router Guard] Route ${to.path} requires auth but user not authenticated, redirecting to /login`)
      return next('/login')
    }

    // If user is authenticated and trying to access login page, redirect to dashboard
    if (to.name === 'webui-login' && hasValidToken()) {
      console.log('[Router Guard] User already authenticated, redirecting from /login to /dashboard')
      return next('/dashboard')
    }
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
