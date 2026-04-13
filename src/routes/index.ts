import { createRouter, createWebHashHistory } from 'vue-router'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

export const router = createRouter({
  routes: [
    // Web UI 专用路由（仅登录页）——
    // Dashboard/Settings 已下线：Web UI 登录后直接进入与桌面端一致的 Home / group-chat 页面，
    // 设置面板只在桌面端暴露
    {
      path: '/login',
      name: 'webui-login',
      component: () => import('@/pages/Login.vue'),
      meta: { title: 'Login - ChatLab Web UI', requiresAuth: false },
    },

    // 主应用路由（桌面 + Web UI 共用）
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/home/index.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/group-chat/:id',
      name: 'group-chat',
      component: () => import('@/pages/group-chat/index.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/private-chat/:id',
      name: 'private-chat',
      component: () => import('@/pages/private-chat/index.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/settings/index.vue'),
      // 仅桌面端可见；Web UI 访问会被守卫重定向到 '/'
    },

    // 兼容旧书签：/dashboard、/webui-settings 等已下线路径全部回首页
    { path: '/dashboard', redirect: '/' },
    { path: '/webui-settings', redirect: '/' },

    // 兜底：任何未命中的路径都回首页，避免卡在已删除页面
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  history: createWebHashHistory(),
})

/**
 * Check if user has valid authentication token
 */
function hasValidToken(): boolean {
  const token = sessionStorage.getItem('chatlab_token')
  const expiresAt = sessionStorage.getItem('chatlab_token_expires_at')

  if (!token || !expiresAt) {
    console.log('[Router Auth] No token found in localStorage')
    return false
  }

  const expiresAtNum = parseInt(expiresAt, 10)
  const isExpired = expiresAtNum <= Date.now()

  if (isExpired) {
    console.log('[Router Auth] Token expired at', new Date(expiresAtNum).toISOString())
    sessionStorage.removeItem('chatlab_token')
    sessionStorage.removeItem('chatlab_token_expires_at')
    return false
  }

  console.log('[Router Auth] Valid token found, expires at', new Date(expiresAtNum).toISOString())
  return true
}

router.beforeEach(async (to, _from, next) => {
  const isWebUI = isBrowserEnvironment()
  const requiresAuth = (to.meta.requiresAuth as boolean) ?? false

  console.log(`[Router Guard] Navigating to ${to.path} (${String(to.name)})`, {
    isWebUI,
    requiresAuth,
    hasToken: !!sessionStorage.getItem('chatlab_token'),
  })

  if (isWebUI) {
    // Web UI 不允许访问设置页 —— 设置只在桌面端暴露
    if (to.name === 'settings') {
      console.log('[Router Guard] WebUI: blocking access to /settings, redirecting to /')
      return next('/')
    }

    // 未登录访问受保护页面 → /login
    if (requiresAuth && !hasValidToken()) {
      console.log(`[Router Guard] Route ${to.path} requires auth, redirecting to /login`)
      return next('/login')
    }

    // 已登录仍访问 /login → 回首页
    if (to.name === 'webui-login' && hasValidToken()) {
      console.log('[Router Guard] Already authenticated, redirecting /login → /')
      return next('/')
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
    // 预加载 Web UI 登录页
    import('@/pages/Login.vue')
  })
}

// 路由准备就绪后触发预加载
router.isReady().then(preloadCriticalRoutes)
