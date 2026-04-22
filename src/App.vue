<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TitleBar from '@/components/common/TitleBar.vue'
import Sidebar from '@/components/common/Sidebar.vue'
import ScreenCaptureModal from '@/components/common/ScreenCaptureModal.vue'
import { ChatRecordDrawer } from '@/components/common/ChatRecord'
import GlobalTaskBar from '@/components/AIChat/GlobalTaskBar.vue'
import IdentityToast from '@/components/identity/IdentityToast.vue'
import FirstLaunchIdentityModal from '@/components/identity/FirstLaunchIdentityModal.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useLLMStore } from '@/stores/llm'
import { initializeWebUI, isBrowserEnvironment } from '@/composables/useEnvironment'
import { useExtractionErrorToast } from '@/composables/useExtractionErrorToast'

const { t } = useI18n()

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const llmStore = useLLMStore()
const { isInitialized } = storeToRefs(sessionStore)
const route = useRoute()

// 首次启动身份弹窗（仅 Electron 桌面模式，globalNicknames 为空时强制弹出）
const showFirstLaunchIdentity = ref(false)

const tooltip = {
  delayDuration: 100,
}

// AI 分析错误全局 toast：任何 Tab / Page 触发的分析失败都会弹提示。
// 内部会按 data.reason 分发（LLM_NOT_CONFIGURED / LLM_CONFIG_INVALID /
// LLM_UNREACHABLE / NO_MESSAGES），前两者附"跳转设置"按钮。
useExtractionErrorToast()

// 浏览器环境 = Web UI 模式，不需要等待 Electron IPC 初始化
const isWebUI = isBrowserEnvironment()

// 身份识别 Layer 2 — 导入后检查是否需要提示配置身份
async function handleSuggestIdentitySetup(_event: Electron.IpcRendererEvent, payload: { sessionId: string }) {
  const { globalNicknames } = settingsStore.identityConfig
  if (globalNicknames.length > 0) return // 已配置，无需提示

  // 查询该会话发言量 Top 3 成员作为候选
  const result = await window.collabApi?.getSessionTopMembers(payload.sessionId, 3)
  if (result?.success && result.data && result.data.length > 0) {
    // 展示交互式身份推荐 Toast（复用 IdentityToast.vue 的 collab:showIdentityToast）
    window.dispatchEvent(
      new CustomEvent('collab:showIdentityToast', {
        detail: { candidates: result.data },
      })
    )
  } else {
    // 无成员数据，退回静态提示
    window.dispatchEvent(
      new CustomEvent('collab:showSimpleToast', {
        detail: {
          title: '已导入聊天记录',
          description: '建议前往「设置 > 我的身份」配置昵称，以便 AI 正确识别您的发言',
        },
      })
    )
  }
  console.log('[App] Identity setup suggestion shown for session:', payload.sessionId)
}

// 应用启动时初始化
onMounted(async () => {
  console.log('[App] onMounted - isWebUI:', isWebUI, 'isElectron:', !isWebUI)

  // 初始化 Web UI 环境
  try {
    initializeWebUI()
  } catch (err) {
    console.error('[App] Web UI initialization error:', err)
  }

  // 浏览器环境（Web UI 模式）：跳过 Electron IPC 初始化，但加载会话列表
  if (isWebUI) {
    console.log('[App] WebUI mode detected, loading sessions via HTTP API...')
    // Web UI 模式下通过 HTTP API 加载会话列表
    await sessionStore.loadSessions()
    console.log('[App] WebUI sessions loaded, isInitialized:', sessionStore.isInitialized)
    return
  }

  // 监听导入后身份设置建议（Layer 2）
  // 注：preload 不再暴露原始 ipcRenderer，安全地跳过此监听器（如未来需要请通过 collabApi 暴露专用 API）
  void handleSuggestIdentitySetup
  ;(window as any).electron?.ipcRenderer?.on?.('collab:suggestIdentitySetup', handleSuggestIdentitySetup)

  // 平台检测 - 设置 CSS 类名以驱动平台差异化样式（如标题栏安全区域高度）
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('win')) {
    document.documentElement.classList.add('platform-windows')
  } else if (platform.includes('linux')) {
    document.documentElement.classList.add('platform-linux')
  }

  // 初始化语言设置（同步 i18n 和 dayjs，异步加载脱敏规则）
  await settingsStore.initLocale()
  // 初始化 LLM 配置（预加载，避免首次使用时延迟）
  llmStore.init()
  // 从数据库加载会话列表
  await sessionStore.loadSessions()

  // 首次启动弹窗：只在"从未完成过"时出现一次，之后永不再弹
  const done = settingsStore.identityConfig.firstLaunchCompleted
  console.log('[App] First-launch identity check — firstLaunchCompleted =', done)
  if (!done) {
    console.log('[App] Showing first-launch identity modal')
    showFirstLaunchIdentity.value = true
  }
})
</script>

<template>
  <UApp :tooltip="tooltip">
    <!-- 自定义标题栏 - 仅在 Electron 桌面模式下显示 -->
    <TitleBar v-if="!isWebUI" />
    <div class="relative flex h-screen w-full overflow-hidden bg-gray-50 dark:bg-gray-900">
      <!-- 浏览器 Web UI 模式：显示 Sidebar + 路由 -->
      <template v-if="isWebUI">
        <Sidebar />
        <main class="relative flex-1 overflow-hidden">
          <router-view v-slot="{ Component }">
            <Transition name="page-fade" mode="out-in">
              <component :is="Component" :key="route.path" />
            </Transition>
          </router-view>
        </main>
      </template>
      <!-- Electron 桌面模式：等待初始化 -->
      <template v-else-if="!isInitialized">
        <div class="flex h-full w-full items-center justify-center">
          <div class="flex flex-col items-center justify-center text-center">
            <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
            <p class="mt-2 text-sm text-gray-500">{{ t('common.initializing') }}</p>
          </div>
        </div>
      </template>
      <template v-else>
        <Sidebar />
        <main class="relative flex-1 overflow-hidden">
          <router-view v-slot="{ Component }">
            <Transition name="page-fade" mode="out-in">
              <component :is="Component" :key="route.path" />
            </Transition>
          </router-view>
        </main>
      </template>
    </div>
    <ScreenCaptureModal
      :open="layoutStore.showScreenCaptureModal"
      :image-data="layoutStore.screenCaptureImage"
      @update:open="(v) => (v ? null : layoutStore.closeScreenCaptureModal())"
    />
    <!-- 全局聊天记录查看器 -->
    <ChatRecordDrawer />
    <!-- 全局 AI 后台任务条：允许用户离开当前页面后仍然快速返回进行中的对话。 -->
    <GlobalTaskBar />
    <!-- 身份推荐 Toast（Layer 2：导入后非侵入式引导） -->
    <IdentityToast />
    <!-- 首次启动身份弹窗（Layer 1：桌面端首次运行强制收集主昵称） -->
    <FirstLaunchIdentityModal v-if="!isWebUI" v-model:open="showFirstLaunchIdentity" />
  </UApp>
</template>

<style scoped>
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
