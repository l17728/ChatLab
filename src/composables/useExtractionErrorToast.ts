/**
 * 全局 AI 分析错误 toast 订阅
 *
 * 以前只有 TaskTab.vue 在本地 setup 里监听 `collab:extractionError`，
 * 导致用户从 GraphTab / group-chat 顶部按钮等非 Task tab 处触发 AI 分析
 * 失败时，toast 压根不会出现。把监听统一提到 App.vue 顶层 setup，
 * 保证全局生效。
 *
 * 使用方式：在 App.vue 的 <script setup> 顶层调用一次即可。
 * 内部用 onMounted / onUnmounted 管理生命周期，不会泄漏监听器。
 */
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

export function useExtractionErrorToast(): void {
  // useToast / useI18n / useRouter 必须在 setup 阶段调用，不能放 onMounted 里
  const { t } = useI18n()
  const router = useRouter()
  const toast = useToast()

  const onError = (_event: unknown, data: { reason?: string; error?: string; sessionId?: string }) => {
    const reason = data?.reason
    const rawError = data?.error
    let title = t('analysis.errorTitle')
    let description = rawError || ''
    let color: 'error' | 'warning' = 'error'
    let actions: Array<{ label: string; onClick: () => void; color?: 'primary' }> | undefined

    if (reason === 'LLM_NOT_CONFIGURED') {
      title = t('analysis.errorLLMNotConfigured')
      description = t('analysis.errorLLMNotConfiguredDesc')
      actions = [
        {
          label: t('layout.footer.settings'),
          onClick: () => router.push({ name: 'settings' }),
          color: 'primary',
        },
      ]
    } else if (reason === 'LLM_CONFIG_INVALID') {
      title = t('analysis.errorLLMConfigInvalid')
      description = rawError || t('analysis.errorLLMNotConfiguredDesc')
      actions = [
        {
          label: t('layout.footer.settings'),
          onClick: () => router.push({ name: 'settings' }),
          color: 'primary',
        },
      ]
    } else if (reason === 'LLM_UNREACHABLE') {
      title = t('analysis.errorLLMUnreachable')
      // rawError 已是 formatAIError 处理过的友好文案（429 quota / 503 overloaded / 鉴权）
      description = rawError || ''
      color = 'warning'
    } else if (reason === 'NO_MESSAGES') {
      title = t('analysis.errorNoMessages')
      description = t('analysis.errorNoMessagesDesc')
      color = 'warning'
    }

    toast.add({
      title,
      description,
      icon: 'i-heroicons-exclamation-circle',
      color,
      duration: 8000,
      ...(actions ? { actions } : {}),
    })
  }

  onMounted(() => {
    if (isBrowserEnvironment() || !window.electron) return
    window.electron.ipcRenderer.on('collab:extractionError', onError)
  })

  onUnmounted(() => {
    if (isBrowserEnvironment() || !window.electron) return
    window.electron.ipcRenderer.removeListener('collab:extractionError', onError)
  })
}
