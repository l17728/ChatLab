/**
 * 实时刷新 hook：tab 监听 collab:extractionBatchDone + collab:extractionDone，
 * 调用传入的 reload 函数把 DB 最新结果拉到 UI。
 *
 * 历史问题：v0.17.8 之前，AI 分析在所有批次完成后才一次性 save + 发 extractionDone，
 * 用户在 Todo / Focus / Knowledge / Graph tab 上只能盯着空界面等几十分钟。
 *
 * v0.17.9 起主进程改为每批 save 一次 + 发 collab:extractionBatchDone 事件，
 * 各 tab 用本 composable 订阅就能动态刷新。多个 batch 在 500ms 内连续到达
 * 只会触发一次 reload（debounce），避免抖动。
 *
 * 用法：
 *   useExtractionRefresh(() => loadTodos(), { types: ['todos'] })
 *
 * 参数：
 *   reload      — tab 的拉取函数（idempotent，调用多次安全）
 *   options.types  — 关心的数据类型，只有 batchDone 的 updatedTypes 与之相交才触发
 *                    可选：'tasks' / 'todos' / 'focus' / 'faqs' / 'knowledge' / 'graph'
 *                    不传 = 任何 batch 都触发（适合 SQLLab 这种全局视图）
 *   options.sessionId  — 只关心特定会话的批次，跨会话的（如 graph 全局重建）忽略
 *                        传 undefined / 不传 = 所有会话都触发
 */
import { onMounted, onUnmounted } from 'vue'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

type ExtractionDataType = 'tasks' | 'todos' | 'focus' | 'faqs' | 'knowledge' | 'graph'

interface ExtractionRefreshOptions {
  types?: ExtractionDataType[]
  sessionId?: string | (() => string | undefined)
}

export function useExtractionRefresh(
  reload: () => void | Promise<unknown>,
  options: ExtractionRefreshOptions = {}
): void {
  if (isBrowserEnvironment()) return

  const types = options.types
  const getSessionId = (): string | undefined => {
    if (typeof options.sessionId === 'function') return options.sessionId()
    return options.sessionId
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function triggerReload() {
    // 500ms debounce：连续多个 batchDone 事件合并为一次 reload，避免列表抖动
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      try {
        const ret = reload()
        if (ret && typeof (ret as Promise<unknown>).catch === 'function') {
          ;(ret as Promise<unknown>).catch((err) => {
            console.error('[useExtractionRefresh] reload failed:', err)
          })
        }
      } catch (err) {
        console.error('[useExtractionRefresh] reload threw synchronously:', err)
      }
    }, 500)
  }

  function shouldRefresh(data: { sessionId?: string; updatedTypes?: string[] }): boolean {
    // sessionId 过滤
    const wantSession = getSessionId()
    if (wantSession && data.sessionId && data.sessionId !== wantSession) return false

    // types 过滤（updatedTypes 是数组；不传 types = 一律刷新）
    if (!types || types.length === 0) return true
    const updated = data.updatedTypes ?? []
    if (updated.length === 0) return false
    return types.some((t) => updated.includes(t))
  }

  const onBatchDone = (
    _evt: unknown,
    data: { sessionId?: string; updatedTypes?: string[] }
  ) => {
    if (!shouldRefresh(data)) return
    triggerReload()
  }

  const onDone = (_evt: unknown, data: { sessionId?: string }) => {
    // 完成事件：兜底刷新一次（如果分析过程有"小群闲聊批次全 0"的情况，
    // 这里也保证最终一次拉取）。sessionId 不过滤 updatedTypes（完成事件没这字段）
    const wantSession = getSessionId()
    if (wantSession && data.sessionId && data.sessionId !== wantSession) return
    triggerReload()
  }

  onMounted(() => {
    if (isBrowserEnvironment() || !window.electron) return
    window.electron.ipcRenderer.on('collab:extractionBatchDone', onBatchDone)
    window.electron.ipcRenderer.on('collab:extractionDone', onDone)
  })

  onUnmounted(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (isBrowserEnvironment() || !window.electron) return
    window.electron.ipcRenderer.removeListener('collab:extractionBatchDone', onBatchDone)
    window.electron.ipcRenderer.removeListener('collab:extractionDone', onDone)
  })
}
