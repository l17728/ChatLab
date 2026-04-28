<script setup lang="ts">
/**
 * 全局 AI 分析进度悬浮卡。
 * 挂在 App.vue 顶层，所有 tab/page 可见；分析中常驻右下角，结束后自动消失。
 *
 * 历史问题：以前进度只在 TaskTab 里显示，用户在别的 tab 完全看不到分析在跑。
 * 这个组件解决"黑盒等待"问题。
 */
import { computed } from 'vue'
import { useAnalysisProgressState } from '@/composables/useAnalysisProgress'

const { isActive, progress, message, jobType } = useAnalysisProgressState()

// 进度条颜色：刚启动是预检阶段（progress < 10），中间是分析（10-85），末尾是保存（85-100）
const phaseLabel = computed(() => {
  if (progress.value < 10) return '准备中'
  if (progress.value < 85) return '分析中'
  if (progress.value < 100) return '保存中'
  return '已完成'
})

const jobTypeLabel = computed(() => {
  switch (jobType.value) {
    case 'all':
      return '统一提取'
    case 'tasks':
      return '任务提取'
    case 'graph':
      return '图谱提取'
    case 'faq':
      return '问答提取'
    case 'focus':
      return '关注点提取'
    default:
      return 'AI 分析'
  }
})
</script>

<template>
  <Transition name="fade-slide">
    <div
      v-if="isActive"
      class="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
      role="status"
      aria-live="polite"
    >
      <div class="px-4 py-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-sparkles" class="h-4 w-4 animate-pulse text-pink-500" />
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ jobTypeLabel }} · {{ phaseLabel }}
            </span>
          </div>
          <span class="text-xs font-mono text-gray-500 dark:text-gray-400"> {{ progress }}% </span>
        </div>

        <!-- 进度条：用最朴素的实现避免依赖 NuxtUI 的 UProgress（避免主题/版本耦合） -->
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            class="h-full rounded-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-300 ease-out"
            :style="{ width: progress + '%' }"
          />
        </div>

        <p
          v-if="message"
          class="mt-2 truncate text-xs text-gray-600 dark:text-gray-400"
          :title="message"
        >
          {{ message }}
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
