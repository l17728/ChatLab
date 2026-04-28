/**
 * 全局 AI 分析进度状态 + 完成 toast
 *
 * 历史问题：v0.17.7 之前，AI 分析过程中只有 TaskTab 在监听 collab:extractionProgress
 * 并显示进度。用户在其他 tab（Todo / Focus / Knowledge / Graph）或别的页面时，
 * 完全看不到分析在跑——只能看到顶部按钮是"分析中"三个字，几十分钟黑盒等待。
 *
 * 这里把订阅提到 App.vue 顶层，shared module-level refs 让全局 indicator 组件
 * 可以读到状态。同时 done 时 toast 一次成功/部分失败，让用户知道分析结束了。
 *
 * 使用方式：
 *   1. App.vue setup 顶层调用 useAnalysisProgressSetup() —— 装订阅
 *   2. <AnalysisProgressIndicator /> 组件读 state 渲染悬浮卡
 *   3. 任意组件可以调 useAnalysisProgressState() 读当前状态（极少用得到）
 *
 * 不与 useExtractionErrorToast 冲突：错误 toast 仍由那个 composable 处理（它只关心
 * extractionError），这里只关心 progress + done。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

// Module-level shared state（singleton across components）
const isActive = ref(false)
const progress = ref(0)
const message = ref('')
const jobId = ref<string | null>(null)
const sessionId = ref<string | null>(null)
const jobType = ref<string | null>(null)

export function useAnalysisProgressState() {
  return { isActive, progress, message, jobId, sessionId, jobType }
}

export function useAnalysisProgressSetup(): void {
  const { t } = useI18n()
  const toast = useToast()

  const onProgress = (
    _evt: unknown,
    data: { jobId?: string; sessionId?: string; jobType?: string; progress?: number; message?: string }
  ) => {
    // 任何 session/jobType 的进度都接受。indicator 显示当前 active job；
    // 如果同时跑两个会话（互斥已在主进程拦住，理论上不会发生），后到的覆盖前者
    isActive.value = true
    jobId.value = data.jobId ?? null
    sessionId.value = data.sessionId ?? null
    jobType.value = data.jobType ?? null
    progress.value = typeof data.progress === 'number' ? data.progress : 0
    message.value = data.message ?? ''
  }

  interface ExtractionResult {
    tasksExtracted?: number
    todosExtracted?: number
    focusExtracted?: number
    faqExtracted?: number
    conceptsExtracted?: number
    documentsExtracted?: number
    proceduresExtracted?: number
    tipsExtracted?: number
    nodesExtracted?: number
    edgesExtracted?: number
  }

  interface BatchSummary {
    total: number
    ok: number
    aborted: number
    error: number
    noToolCall: number
    partialFailure: boolean
  }

  const onDone = (
    _evt: unknown,
    data: {
      jobId?: string
      sessionId?: string
      jobType?: string
      result?: ExtractionResult
      batchSummary?: BatchSummary
    }
  ) => {
    // 把 indicator 关掉
    isActive.value = false
    progress.value = 100

    const result = data.result ?? {}
    const totalSaved =
      (result.tasksExtracted ?? 0) +
      (result.todosExtracted ?? 0) +
      (result.focusExtracted ?? 0) +
      (result.faqExtracted ?? 0) +
      (result.conceptsExtracted ?? 0) +
      (result.documentsExtracted ?? 0) +
      (result.proceduresExtracted ?? 0) +
      (result.tipsExtracted ?? 0) +
      (result.nodesExtracted ?? 0) +
      (result.edgesExtracted ?? 0)

    const summary = `${result.tasksExtracted ?? 0} 任务 / ${result.todosExtracted ?? 0} 待办 / ${result.focusExtracted ?? 0} 关注点 / ${result.faqExtracted ?? 0} 问答 / ${(result.conceptsExtracted ?? 0) + (result.documentsExtracted ?? 0) + (result.proceduresExtracted ?? 0) + (result.tipsExtracted ?? 0)} 知识 / ${result.nodesExtracted ?? 0} 实体`

    // 部分批次失败：弹 warning toast
    if (data.batchSummary?.partialFailure) {
      const failed = data.batchSummary.total - data.batchSummary.ok
      toast.add({
        title: t('analysis.doneWithPartialFailure', '分析完成（部分批次失败）'),
        description: t('analysis.doneWithPartialFailureDesc', {
          failed,
          total: data.batchSummary.total,
          summary,
          default: `${failed}/${data.batchSummary.total} 批次超时或失败，已保存：${summary}`,
        }),
        icon: 'i-heroicons-exclamation-triangle',
        color: 'warning',
        duration: 8000,
      })
      return
    }

    // 全成功无数据：info toast 提示"未发现可提取内容"
    if (totalSaved === 0) {
      toast.add({
        title: t('analysis.doneNothingFound', '分析完成：未发现可提取的内容'),
        description: t(
          'analysis.doneNothingFoundDesc',
          '聊天记录里没有识别到任务/待办/关注点等结构化信息，可能是闲聊型对话，属正常情况。'
        ),
        icon: 'i-heroicons-information-circle',
        color: 'info',
        duration: 6000,
      })
      return
    }

    // 全成功有数据：success toast
    toast.add({
      title: t('analysis.doneSuccess', 'AI 分析完成'),
      description: summary,
      icon: 'i-heroicons-check-circle',
      color: 'success',
      duration: 5000,
    })
  }

  const onError = () => {
    // 错误 toast 由 useExtractionErrorToast 处理；这里只负责把 indicator 关掉
    isActive.value = false
  }

  onMounted(() => {
    if (isBrowserEnvironment() || !window.electron) return
    window.electron.ipcRenderer.on('collab:extractionProgress', onProgress)
    window.electron.ipcRenderer.on('collab:extractionDone', onDone)
    window.electron.ipcRenderer.on('collab:extractionError', onError)
  })

  onUnmounted(() => {
    if (isBrowserEnvironment() || !window.electron) return
    window.electron.ipcRenderer.removeListener('collab:extractionProgress', onProgress)
    window.electron.ipcRenderer.removeListener('collab:extractionDone', onDone)
    window.electron.ipcRenderer.removeListener('collab:extractionError', onError)
  })
}
