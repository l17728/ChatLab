<script setup lang="ts">
/**
 * 身份推荐 Toast 组件（Layer 2）
 *
 * 监听 collab:showIdentityToast 事件，展示非侵入式底部 Toast。
 * 用户可从发言量 Top 3 成员中选择"我是谁"，或跳过。
 *
 * 日志前缀: [IdentityToastUI]
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'

interface MemberCandidate {
  id: number
  name: string
  messageCount: number
}

const settingsStore = useSettingsStore()
const visible = ref(false)
const candidates = ref<MemberCandidate[]>([])
const simpleToast = ref<{ title: string; description: string } | null>(null)
let simpleToastTimer: ReturnType<typeof setTimeout> | null = null

function onIdentityToast(e: Event) {
  const detail = (e as CustomEvent).detail as { candidates: MemberCandidate[] }
  console.log('[IdentityToastUI] 收到身份推荐事件，候选:', detail.candidates)
  candidates.value = detail.candidates
  visible.value = true
}

function onSimpleToast(e: Event) {
  const detail = (e as CustomEvent).detail as { title: string; description: string }
  simpleToast.value = detail
  if (simpleToastTimer) clearTimeout(simpleToastTimer)
  simpleToastTimer = setTimeout(() => { simpleToast.value = null }, 4000)
}

onMounted(() => {
  window.addEventListener('collab:showIdentityToast', onIdentityToast)
  window.addEventListener('collab:showSimpleToast', onSimpleToast)
})

onUnmounted(() => {
  window.removeEventListener('collab:showIdentityToast', onIdentityToast)
  window.removeEventListener('collab:showSimpleToast', onSimpleToast)
  if (simpleToastTimer) clearTimeout(simpleToastTimer)
})

async function selectIdentity(name: string) {
  console.log('[IdentityToastUI] 用户选择身份:', name)
  const current = settingsStore.identityConfig?.globalNicknames ?? []
  if (!current.includes(name)) {
    settingsStore.identityConfig = {
      ...settingsStore.identityConfig,
      globalNicknames: [...current, name],
    }
  }
  visible.value = false
}

function dismiss() {
  console.log('[IdentityToastUI] 用户跳过身份设置')
  visible.value = false
}

function goToSettings() {
  console.log('[IdentityToastUI] 用户跳转到身份设置')
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'identity' } }))
  visible.value = false
}
</script>

<template>
  <Teleport to="body">
    <!-- 身份推荐 Toast（多候选） -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="translate-y-4 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-4 opacity-0"
    >
      <div
        v-if="visible"
        class="fixed bottom-6 left-1/2 z-[9999] w-[420px] max-w-[92vw] -translate-x-1/2 rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
      >
        <!-- 头部 -->
        <div class="flex items-start justify-between px-4 pt-4">
          <div>
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-user-circle" class="h-5 w-5 text-pink-500" />
              <span class="text-sm font-semibold text-gray-900 dark:text-white">识别您的身份</span>
            </div>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              在该聊天群中，您是哪位成员？
            </p>
          </div>
          <button
            class="ml-2 shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="dismiss"
          >
            <UIcon name="i-heroicons-x-mark" class="h-4 w-4" />
          </button>
        </div>

        <!-- 候选成员列表 -->
        <div class="mt-3 flex flex-wrap gap-2 px-4">
          <button
            v-for="c in candidates"
            :key="c.id"
            class="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:border-pink-400 hover:bg-pink-50 hover:text-pink-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-pink-600 dark:hover:bg-pink-900/20 dark:hover:text-pink-400"
            @click="selectIdentity(c.name)"
          >
            <span class="font-medium">{{ c.name }}</span>
            <span class="text-xs text-gray-400">{{ c.messageCount }} 条</span>
          </button>
        </div>

        <!-- 底部操作 -->
        <div class="flex items-center justify-between px-4 py-3">
          <button
            class="text-xs text-gray-400 underline hover:text-gray-600 dark:hover:text-gray-300"
            @click="goToSettings"
          >
            手动设置
          </button>
          <button
            class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="dismiss"
          >
            跳过此次
          </button>
        </div>
      </div>
    </Transition>

    <!-- 简单 Toast（单候选静默设置后通知） -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="translate-y-4 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-4 opacity-0"
    >
      <div
        v-if="simpleToast"
        class="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-xl border border-green-200 bg-white px-4 py-3 shadow-xl dark:border-green-800 dark:bg-gray-900"
      >
        <div class="flex items-center gap-3">
          <UIcon name="i-heroicons-check-circle" class="h-5 w-5 shrink-0 text-green-500" />
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ simpleToast.title }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ simpleToast.description }}</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
