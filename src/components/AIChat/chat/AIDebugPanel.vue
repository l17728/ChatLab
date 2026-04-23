<script setup lang="ts">
/**
 * AI 调试诊断面板
 * 在 Debug Mode 下显示，帮助快速定位 AI 分析问题
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { AgentRuntimeStatus, TokenUsage } from '@electron/shared/types'
import type { ToolStatus } from '@/stores/aiChat'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

const props = defineProps<{
  isAIThinking: boolean
  agentStatus: AgentRuntimeStatus | null
  currentToolStatus: ToolStatus | null
  toolsUsedInCurrentRound: string[]
  sessionTokenUsage: TokenUsage
}>()

const isCollapsed = ref(true)
const connectionStatus = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle')
const connectionError = ref('')
const connectionDetails = ref<Record<string, unknown> | null>(null)

// LLM 配置信息
const llmConfigInfo = ref<{
  hasConfig: boolean
  provider?: string
  model?: string
} | null>(null)

// 诊断日志
const diagLogs = ref<Array<{ time: string; level: string; msg: string }>>([])
const MAX_LOGS = 50

function addDiagLog(level: string, msg: string) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  diagLogs.value.unshift({ time, level, msg })
  if (diagLogs.value.length > MAX_LOGS) {
    diagLogs.value.pop()
  }
}

// 拦截 console 中的 [AI-DEBUG] 日志
let originalConsoleLog: typeof console.log
let originalConsoleWarn: typeof console.warn
let originalConsoleError: typeof console.error

function interceptConsole() {
  originalConsoleLog = console.log
  originalConsoleWarn = console.warn
  originalConsoleError = console.error

  console.log = (...args: unknown[]) => {
    originalConsoleLog.apply(console, args)
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    if (msg.includes('[AI-DEBUG]')) {
      addDiagLog('INFO', msg.replace('[AI-DEBUG] ', ''))
    }
  }

  console.warn = (...args: unknown[]) => {
    originalConsoleWarn.apply(console, args)
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    if (msg.includes('[AI-DEBUG]')) {
      addDiagLog('WARN', msg.replace('[AI-DEBUG] ', ''))
    }
  }

  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args)
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    if (msg.includes('[AI-DEBUG]')) {
      addDiagLog('ERROR', msg.replace('[AI-DEBUG] ', ''))
    }
  }
}

function restoreConsole() {
  if (originalConsoleLog) console.log = originalConsoleLog
  if (originalConsoleWarn) console.warn = originalConsoleWarn
  if (originalConsoleError) console.error = originalConsoleError
}

// 快速连通性测试
async function quickTest() {
  connectionStatus.value = 'testing'
  connectionError.value = ''
  connectionDetails.value = null
  addDiagLog('INFO', '开始连通性测试...')
  try {
    if (isBrowserEnvironment()) {
      connectionStatus.value = 'ok'
      addDiagLog('INFO', 'Web UI 环境，跳过连通性测试')
      return
    }
    const result = await window.llmApi.testConnection()
    if (result.success) {
      connectionStatus.value = 'ok'
      connectionDetails.value = result.details ?? null
      addDiagLog('INFO', `连通性测试通过，耗时: ${result.details?.totalElapsed ?? '?'}ms`)
    } else {
      connectionStatus.value = 'fail'
      connectionError.value = result.error ?? '未知错误'
      connectionDetails.value = result.details ?? null
      addDiagLog('ERROR', `连通性测试失败: ${result.error}`)
    }
  } catch (error) {
    connectionStatus.value = 'fail'
    connectionError.value = String(error)
    addDiagLog('ERROR', `连通性测试异常: ${error}`)
  }
}

// 检查 LLM 配置
async function checkConfig() {
  try {
    if (isBrowserEnvironment()) {
      llmConfigInfo.value = { hasConfig: true, provider: 'WebUI', model: 'server-side' }
      return
    }
    const hasConfig = await window.llmApi.hasConfig()
    if (hasConfig) {
      const configs = await window.llmApi.getAllConfigs()
      const activeId = await window.llmApi.getActiveConfigId()
      const active = configs.find((c) => c.id === activeId)
      llmConfigInfo.value = {
        hasConfig: true,
        provider: active?.provider ?? '?',
        model: active?.model ?? '?',
      }
    } else {
      llmConfigInfo.value = { hasConfig: false }
    }
  } catch (error) {
    llmConfigInfo.value = { hasConfig: false }
  }
}

const phaseLabel = computed(() => {
  if (!props.agentStatus) return '-'
  const labels: Record<string, string> = {
    preparing: '准备中',
    thinking: '思考中',
    responding: '生成中',
    tool_running: '工具执行',
    completed: '已完成',
    error: '错误',
    aborted: '已中止',
  }
  return labels[props.agentStatus.phase] ?? props.agentStatus.phase
})

const statusColor = computed(() => {
  if (!props.agentStatus) return 'text-gray-400'
  switch (props.agentStatus.phase) {
    case 'completed':
      return 'text-green-500'
    case 'error':
      return 'text-red-500'
    case 'aborted':
      return 'text-yellow-500'
    default:
      return 'text-blue-500'
  }
})

onMounted(() => {
  interceptConsole()
  checkConfig()
  addDiagLog('INFO', '诊断面板已启动')
})

onBeforeUnmount(() => {
  restoreConsole()
})
</script>

<template>
  <div class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
    <!-- 折叠头 -->
    <button
      class="flex w-full items-center justify-between px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      @click="isCollapsed = !isCollapsed"
    >
      <span class="flex items-center gap-1.5">
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="isAIThinking ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'"
        />
        <span class="font-mono">AI Debug</span>
        <span v-if="agentStatus" :class="statusColor">{{ phaseLabel }}</span>
      </span>
      <UIcon :name="isCollapsed ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="h-3 w-3" />
    </button>

    <!-- 展开内容 -->
    <div v-if="!isCollapsed" class="px-3 pb-3 space-y-2 text-xs font-mono">
      <!-- 状态概览 -->
      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600 dark:text-gray-400">
        <div>
          <span class="text-gray-400">LLM:</span>
          <span v-if="llmConfigInfo?.hasConfig" class="ml-1 text-green-600 dark:text-green-400">
            {{ llmConfigInfo.provider }}/{{ llmConfigInfo.model }}
          </span>
          <span v-else class="ml-1 text-red-500">未配置</span>
        </div>
        <div>
          <span class="text-gray-400">连接:</span>
          <span
            class="ml-1"
            :class="{
              'text-gray-400': connectionStatus === 'idle',
              'text-blue-500 animate-pulse': connectionStatus === 'testing',
              'text-green-500': connectionStatus === 'ok',
              'text-red-500': connectionStatus === 'fail',
            }"
          >
            {{
              connectionStatus === 'idle'
                ? '未测试'
                : connectionStatus === 'testing'
                  ? '测试中...'
                  : connectionStatus === 'ok'
                    ? 'OK'
                    : 'FAIL'
            }}
          </span>
        </div>
        <div>
          <span class="text-gray-400">Phase:</span>
          <span class="ml-1" :class="statusColor">{{ phaseLabel }}</span>
        </div>
        <div>
          <span class="text-gray-400">Rounds:</span>
          <span class="ml-1">{{ agentStatus?.round ?? 0 }}</span>
        </div>
        <div>
          <span class="text-gray-400">Tools:</span>
          <span class="ml-1">{{ toolsUsedInCurrentRound.join(', ') || '-' }}</span>
        </div>
        <div>
          <span class="text-gray-400">Tokens:</span>
          <span class="ml-1">in={{ sessionTokenUsage.promptTokens }} out={{ sessionTokenUsage.completionTokens }}</span>
        </div>
        <div v-if="agentStatus?.contextTokens">
          <span class="text-gray-400">Context:</span>
          <span class="ml-1">~{{ agentStatus.contextTokens }} tokens</span>
        </div>
        <div v-if="currentToolStatus">
          <span class="text-gray-400">当前工具:</span>
          <span
            class="ml-1"
            :class="{
              'text-blue-500': currentToolStatus.status === 'running',
              'text-green-500': currentToolStatus.status === 'done',
              'text-red-500': currentToolStatus.status === 'error',
            }"
          >
            {{ currentToolStatus.name }} [{{ currentToolStatus.status }}]
          </span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex gap-2 pt-1">
        <button
          class="rounded bg-blue-500/10 px-2 py-0.5 text-blue-600 hover:bg-blue-500/20 dark:text-blue-400"
          :disabled="connectionStatus === 'testing'"
          @click="quickTest"
        >
          {{ connectionStatus === 'testing' ? '测试中...' : '测试连接' }}
        </button>
        <button
          class="rounded bg-gray-500/10 px-2 py-0.5 text-gray-600 hover:bg-gray-500/20 dark:text-gray-400"
          @click="checkConfig"
        >
          刷新配置
        </button>
        <button
          class="rounded bg-gray-500/10 px-2 py-0.5 text-gray-600 hover:bg-gray-500/20 dark:text-gray-400"
          @click="diagLogs = []"
        >
          清空日志
        </button>
      </div>

      <!-- 连接错误详情 -->
      <div
        v-if="connectionError"
        class="rounded bg-red-50 dark:bg-red-900/20 p-2 text-red-600 dark:text-red-400 break-all"
      >
        {{ connectionError }}
      </div>
      <div v-if="connectionDetails" class="rounded bg-gray-100 dark:bg-gray-800 p-2 text-gray-500">
        <div v-for="(val, key) in connectionDetails" :key="String(key)">{{ key }}: {{ val }}</div>
      </div>

      <!-- 诊断日志 -->
      <div v-if="diagLogs.length > 0" class="max-h-40 overflow-y-auto rounded bg-gray-900 p-2 text-gray-300">
        <div
          v-for="(log, i) in diagLogs"
          :key="i"
          class="leading-tight"
          :class="{
            'text-gray-400': log.level === 'INFO',
            'text-yellow-400': log.level === 'WARN',
            'text-red-400': log.level === 'ERROR',
          }"
        >
          <span class="text-gray-600">{{ log.time }}</span>
          <span class="mx-1">[{{ log.level }}]</span>
          {{ log.msg }}
        </div>
      </div>
    </div>
  </div>
</template>
