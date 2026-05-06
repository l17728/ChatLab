<script setup lang="ts">
import { ref, onMounted, watch, computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { MemberActivity, HourlyActivity, DailyActivity } from '@/types/analysis'
import CaptureButton from '@/components/common/CaptureButton.vue'
import TimeSelect from '@/components/common/TimeSelect.vue'
import AITab from '@/components/analysis/AITab.vue'
import TaskTab from '@/components/analysis/TaskTab.vue'
import TodoTab from '@/components/analysis/TodoTab.vue'
import KnowledgeTab from '@/components/analysis/KnowledgeTab.vue'
import FocusTab from '@/components/analysis/FocusTab.vue'
import GraphTab from '@/components/analysis/GraphTab.vue'
import { ChatExplorer } from '@/components/AIChat'
import OverviewTab from './components/OverviewTab.vue'
import ViewTab from './components/ViewTab.vue'
import QuotesTab from './components/QuotesTab.vue'
import MemberTab from './components/MemberTab.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SessionIndexModal from '@/components/analysis/SessionIndexModal.vue'
import IncrementalImportModal from '@/components/analysis/IncrementalImportModal.vue'
const MessageExportModal = defineAsyncComponent(() => import('@/components/MessageExport/MessageExportModal.vue'))
import LoadingState from '@/components/UI/LoadingState.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useTimeSelect } from '@/composables'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

// 五个 AI 分析 Tab，共享"重新分析全部"按钮
const ANALYSIS_TABS = new Set(['tasks', 'todos', 'focus', 'knowledge', 'graph'])

// 跨会话 Tab：从 tasks 到 lab，数据作用范围是全局（跨群、跨对话），与前面的单会话分析 Tab 区分开
const CROSS_SESSION_TABS = new Set(['tasks', 'todos', 'knowledge', 'focus', 'graph', 'ai-chat', 'lab'])

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const { currentSessionId } = storeToRefs(sessionStore)

// 会话索引弹窗状态
const showSessionIndexModal = ref(false)

// 增量导入弹窗状态
const showIncrementalImportModal = ref(false)

// 导出聊天记录弹窗状态
const showMessageExportModal = ref(false)

// 打开聊天记录查看器
function openChatRecordViewer() {
  layoutStore.openChatRecordDrawer({})
}

// 数据状态
const isLoading = ref(true)
const session = ref<AnalysisSession | null>(null)
const memberActivity = ref<MemberActivity[]>([])
const hourlyActivity = ref<HourlyActivity[]>([])
const dailyActivity = ref<DailyActivity[]>([])
const messageTypes = ref<Array<{ type: MessageType; count: number }>>([])
const isInitialLoad = ref(true)

// Tab 配置
const allTabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'view', labelKey: 'analysis.tabs.view', icon: 'i-heroicons-presentation-chart-bar' },
  { id: 'quotes', labelKey: 'analysis.tabs.groupQuotes', icon: 'i-heroicons-chat-bubble-bottom-center-text' },
  { id: 'members', labelKey: 'analysis.tabs.members', icon: 'i-heroicons-user-group' },
  { id: 'tasks', labelKey: 'analysis.tabs.tasks', icon: 'i-heroicons-clipboard-document-check' },
  { id: 'todos', labelKey: 'analysis.tabs.todos', icon: 'i-heroicons-check-circle' },
  { id: 'knowledge', labelKey: 'analysis.tabs.knowledge', icon: 'i-heroicons-book-open' },
  { id: 'focus', labelKey: 'analysis.tabs.focus', icon: 'i-heroicons-eye' },
  { id: 'graph', labelKey: 'analysis.tabs.graph', icon: 'i-heroicons-share' },
  { id: 'ai-chat', labelKey: 'analysis.tabs.aiChat', icon: 'i-heroicons-chat-bubble-left-ellipsis' },
  { id: 'lab', labelKey: 'analysis.tabs.lab', icon: 'i-heroicons-beaker' },
]

// 本会话 Tab（overview / view / quotes / members）和跨会话 Tab 分两组渲染
const sessionScopedTabs = computed(() => allTabs.filter((t) => !CROSS_SESSION_TABS.has(t.id)))
const crossSessionTabs = computed(() => allTabs.filter((t) => CROSS_SESSION_TABS.has(t.id)))

function resolveActiveTabFromRoute(): string {
  const routeTab = route.query.tab as string | undefined
  if (routeTab && allTabs.some((tab) => tab.id === routeTab)) return routeTab
  return settingsStore.defaultSessionTab
}

const activeTab = ref(resolveActiveTabFromRoute())

// 时间范围筛选（composable 统一管理状态、派生计算、URL 同步）
const { timeRangeValue, fullTimeRange, availableYears, timeFilter, selectedYearForOverview, initialTimeState } =
  useTimeSelect(route, router, {
    activeTab,
    isInitialLoad,
    currentSessionId,
    onTimeRangeChange: () => loadAnalysisData(),
  })

// 计算属性
const topMembers = computed(() => memberActivity.value.slice(0, 3))
const bottomMembers = computed(() => {
  if (memberActivity.value.length <= 1) return []
  return [...memberActivity.value].sort((a, b) => a.messageCount - b.messageCount).slice(0, 1)
})

// 当前筛选后的消息总数
const filteredMessageCount = computed(() => {
  return memberActivity.value.reduce((sum, m) => sum + m.messageCount, 0)
})

// 当前筛选后的活跃成员数
const filteredMemberCount = computed(() => {
  return memberActivity.value.filter((m) => m.messageCount > 0).length
})

// Sync route param to store
function syncSession() {
  const id = route.params.id as string
  if (id) {
    sessionStore.selectSession(id)
    // If selection failed (e.g. invalid ID), redirect to home
    if (sessionStore.currentSessionId !== id) {
      router.replace('/')
    }
  }
}

// 加载基础数据（仅会话信息、时间范围由 TimeSelect 内部拉取)
async function loadBaseData() {
  if (!currentSessionId.value) return

  try {
    const isWebUI = isBrowserEnvironment()
    let sessionData: AnalysisSession | null = null

    if (isWebUI) {
      // Web UI 模式: 直接使用 fetch API
      const response = await fetch(`/api/v1/sessions/${currentSessionId.value}`)
      if (response.ok) {
        const json = await response.json()
        sessionData = json.data || null
      }
    } else {
      // Electron 模式: 使用 IPC
      sessionData = await window.chatApi.getSession(currentSessionId.value)
    }
    session.value = sessionData
  } catch (error) {
    console.error('加载基础数据失败:', error)
  }
}

// 加载分析数据（受年份筛选影响）
async function loadAnalysisData() {
  if (!currentSessionId.value) return

  isLoading.value = true

  try {
    const isWebUI = isBrowserEnvironment()
    const filter = timeFilter.value

    if (isWebUI) {
      // Web UI 模式: 使用 HTTP API
      const params: any = {}
      if (filter?.startTs) params.startTime = filter.startTs
      if (filter?.endTs) params.endTime = filter.endTs
      const queryString =
        Object.keys(params).length > 0
          ? '?' +
            Object.keys(params)
              .map((k) => `${k}=${params[k]}`)
              .join('&')
          : ''

      const responses = await Promise.all([
        fetch(`/api/v1/sessions/${currentSessionId.value}/stats/member-activity${queryString}`),
        fetch(`/api/v1/sessions/${currentSessionId.value}/stats/hourly-activity${queryString}`),
        fetch(`/api/v1/sessions/${currentSessionId.value}/stats/daily-activity${queryString}`),
        fetch(`/api/v1/sessions/${currentSessionId.value}/stats/message-type-distribution${queryString}`),
      ])

      const [membersJson, hourlyJson, dailyJson, typesJson] = await Promise.all([
        responses[0].json(),
        responses[1].json(),
        responses[2].json(),
        responses[3].json(),
      ])

      memberActivity.value = membersJson.data || []
      hourlyActivity.value = hourlyJson.data || []
      dailyActivity.value = dailyJson.data || []
      messageTypes.value = typesJson.data || []
    } else {
      // Electron 模式: 使用 IPC
      const [members, hourly, daily, types] = await Promise.all([
        window.chatApi.getMemberActivity(currentSessionId.value, filter),
        window.chatApi.getHourlyActivity(currentSessionId.value, filter),
        window.chatApi.getDailyActivity(currentSessionId.value, filter),
        window.chatApi.getMessageTypeDistribution(currentSessionId.value, filter),
      ])
      memberActivity.value = members
      hourlyActivity.value = hourly
      dailyActivity.value = daily
      messageTypes.value = types
    }
  } catch (error) {
    console.error('加载分析数据失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 加载所有数据
async function loadData() {
  if (!currentSessionId.value) return

  isInitialLoad.value = true
  await loadBaseData()
  isInitialLoad.value = false
}

// 监听路由参数变化
watch(
  () => route.params.id,
  () => {
    activeTab.value = resolveActiveTabFromRoute()
    syncSession()
  }
)

watch(
  () => route.query.tab,
  () => {
    activeTab.value = resolveActiveTabFromRoute()
  }
)

// 监听会话变化（切换会话时由 TimeSelect 自行发出新范围，避免 Tab Content 双重重建）
watch(
  currentSessionId,
  () => {
    loadData()
  },
  { immediate: true }
)

onMounted(() => {
  syncSession()
})

// ==================== 统一 AI 分析（增量感知）====================
const isReanalyzing = ref(false)
const analysisStatus = ref<{
  newMessageCount: number
  hasNewMessages: boolean
  everAnalyzed: boolean
  lastAnalyzedAt: number | null
  // v0.17.10: 上次分析里仍未恢复的失败批次数（>0 显示"重试失败批次"按钮）
  failedBatchCount: number
} | null>(null)

async function refreshAnalysisStatus() {
  if (isBrowserEnvironment() || !currentSessionId.value) return
  try {
    const res = await window.collabApi?.getAnalysisStatus(currentSessionId.value)
    if (res?.success && res.data) {
      analysisStatus.value = {
        newMessageCount: res.data.newMessageCount,
        hasNewMessages: res.data.hasNewMessages,
        everAnalyzed: res.data.everAnalyzed,
        lastAnalyzedAt: res.data.lastAnalyzedAt,
        failedBatchCount: res.data.failedBatchCount ?? 0,
      }
    }
  } catch (err) {
    console.error('[GroupChat] refreshAnalysisStatus failed:', err)
  }
}

// 按钮提示：显示 "AI 分析" / "有 N 条新消息" / "完成分析"
const analysisButtonLabel = computed(() => {
  if (isReanalyzing.value) return '分析中'
  if (!analysisStatus.value) return 'AI 分析'
  const { everAnalyzed, hasNewMessages, newMessageCount } = analysisStatus.value
  if (!everAnalyzed) return 'AI 分析'
  if (hasNewMessages) return `增量分析 (${newMessageCount})`
  return '完成分析'
})

const analysisButtonDisabled = computed(() => {
  if (isReanalyzing.value) return true
  // 已分析过且没有新消息时，按钮变灰
  if (analysisStatus.value?.everAnalyzed && !analysisStatus.value.hasNewMessages) return true
  return false
})

// v0.17.10: "重试失败批次"按钮的显示条件
const hasFailedBatches = computed(() => (analysisStatus.value?.failedBatchCount ?? 0) > 0)
const retryFailedLabel = computed(() => `重试失败批次 (${analysisStatus.value?.failedBatchCount ?? 0})`)

async function triggerRetryFailedBatches() {
  if (isBrowserEnvironment() || !currentSessionId.value) return
  if (isReanalyzing.value) return
  isReanalyzing.value = true
  try {
    // 同样从 ownerId 反查 nicknames（与主分析路径一致）
    const ownerId = sessionStore.currentSession?.ownerId
    const members: any[] = await window.chatApi.getMembers(currentSessionId.value).catch(() => [])
    const me = members.find((m) => m.platformId === ownerId)
    const nicknameSet = new Set<string>()
    if (me) {
      if (typeof me.accountName === 'string' && me.accountName.trim()) nicknameSet.add(me.accountName.trim())
      if (typeof me.groupNickname === 'string' && me.groupNickname.trim()) nicknameSet.add(me.groupNickname.trim())
      const aliases = Array.isArray(me.aliases) ? me.aliases : []
      for (const alias of aliases) {
        if (typeof alias === 'string' && alias.trim()) nicknameSet.add(alias.trim())
      }
    }
    if (nicknameSet.size === 0) {
      const globalNicks = settingsStore.identityConfig.globalNicknames ?? []
      for (const n of globalNicks) {
        if (typeof n === 'string' && n.trim()) nicknameSet.add(n.trim())
      }
    }
    const nicks = Array.from(nicknameSet)
    console.log(`[GroupChat] retry failed batches with nicks=${JSON.stringify(nicks)}`)
    await window.collabApi?.retryFailedBatches(currentSessionId.value, nicks)
  } catch (err) {
    console.error('[GroupChat] triggerRetryFailedBatches failed:', err)
    isReanalyzing.value = false
    refreshAnalysisStatus()
  }
}

async function triggerUnifiedAnalysis() {
  if (isBrowserEnvironment() || !currentSessionId.value) return
  if (analysisButtonDisabled.value) return

  // 前置校验：本会话必须先在「成员」页设置"我是谁"
  // 未设置则提示并阻止分析——AI 需要知道"我"是谁才能正确提取 @我/点名我的待办
  if (!sessionStore.currentSession?.ownerId) {
    window.dispatchEvent(
      new CustomEvent('collab:showSimpleToast', {
        detail: {
          title: '请先设置"我是谁"',
          description: '在「成员」页顶部选择您在本群中对应的成员后再开始分析',
        },
      })
    )
    console.warn('[GroupChat] triggerUnifiedAnalysis blocked: 本会话 ownerId 未设置')
    return
  }

  isReanalyzing.value = true
  // 立即乐观更新：隐藏红点，label 通过 isReanalyzing 变为"分析中"
  if (analysisStatus.value) {
    analysisStatus.value = { ...analysisStatus.value, hasNewMessages: false, newMessageCount: 0 }
  }
  try {
    // 关键修：从本会话的"我是谁"(sessions.ownerId 指向某个 member.platformId) 反查
    // 成员的 accountName / groupNickname / aliases，合并成 nicknames 列表给 LLM。
    //
    // 历史 bug：之前只读 settingsStore.identityConfig.globalNicknames——那是 app 级
    // 全局昵称（FirstLaunchIdentityModal 写入的），与用户在「成员」页选的本会话身份
    // 完全独立。结果用户在群里选了"小明"是我，但分析时 LLM 收到的是全局设的"张三"，
    // 导致所有 @我/点名我的待办都识别失败。
    const ownerId = sessionStore.currentSession?.ownerId
    const members: any[] = await window.chatApi.getMembers(currentSessionId.value).catch((err: any) => {
      console.warn('[GroupChat] getMembers failed when deriving nicknames:', err)
      return []
    })
    const me = members.find((m) => m.platformId === ownerId)

    const nicknameSet = new Set<string>()
    if (me) {
      const accountName = typeof me.accountName === 'string' ? me.accountName.trim() : ''
      const groupNickname = typeof me.groupNickname === 'string' ? me.groupNickname.trim() : ''
      if (accountName) nicknameSet.add(accountName)
      if (groupNickname) nicknameSet.add(groupNickname)
      // aliases 在 IPC 边界已 parse 为 string[]
      const aliases = Array.isArray(me.aliases) ? me.aliases : []
      for (const alias of aliases) {
        if (typeof alias === 'string' && alias.trim()) nicknameSet.add(alias.trim())
      }
    }
    // 兜底：member 找不到（DB 异常 / IPC 失败）时退回到全局 nicknames，
    // 至少不让 todos 提取空跑
    if (nicknameSet.size === 0) {
      const globalNicks = settingsStore.identityConfig.globalNicknames ?? []
      for (const n of globalNicks) {
        if (typeof n === 'string' && n.trim()) nicknameSet.add(n.trim())
      }
    }

    const nicks = Array.from(nicknameSet)
    console.log(
      `[GroupChat] AI analysis nicknames derived from ownerId=${ownerId}:`,
      nicks,
      `(member found=${!!me}, fallback=${!me && nicks.length > 0})`
    )

    // forceRerun=false：主进程根据 lastAnalyzedMessageId 自动走增量路径
    await window.collabApi?.createExtractionJob(currentSessionId.value, 'all', false, nicks)
  } catch (err) {
    console.error('[GroupChat] triggerUnifiedAnalysis failed:', err)
    isReanalyzing.value = false
    refreshAnalysisStatus()
  }
}

// 切会话 / 收到 extractionDone 时刷新状态
watch(currentSessionId, () => refreshAnalysisStatus(), { immediate: true })
onMounted(() => {
  if (!isBrowserEnvironment() && (window as any).electron?.ipcRenderer) {
    ;(window as any).electron.ipcRenderer.on('collab:extractionDone', (_e: any, data: any) => {
      if (data?.sessionId === currentSessionId.value) {
        isReanalyzing.value = false
        // 分析完成后立即清红点：即便后端 getAnalysisStatus 的 newMessageCount
        // 算法因 id 不连续出现短暂回弹，UI 也不会再显示"有新消息"
        analysisStatus.value = {
          newMessageCount: 0,
          hasNewMessages: false,
          everAnalyzed: true,
          lastAnalyzedAt: Date.now(),
          // failedBatchCount 由 refreshAnalysisStatus() 从 IPC 同步真实值，这里先沿用旧值或 0
          failedBatchCount: analysisStatus.value?.failedBatchCount ?? 0,
        }
        // 仍然异步刷新一次以同步真实 lastAnalyzedAt 等字段
        refreshAnalysisStatus()
      }
    })
  }
})
</script>

<template>
  <div class="flex h-full flex-col bg-white dark:bg-gray-900" style="padding-top: var(--titlebar-area-height)">
    <!-- Loading State -->
    <LoadingState v-if="isInitialLoad" variant="page" :text="t('analysis.groupChat.loading')" />

    <!-- Content -->
    <template v-else-if="session">
      <!-- Header -->
      <PageHeader
        :title="session.name"
        :description="
          t('analysis.groupChat.description', {
            dateRange: timeRangeValue?.displayLabel ?? '',
            memberCount: timeRangeValue?.isFullRange !== false ? session.memberCount : filteredMemberCount,
            messageCount: timeRangeValue?.isFullRange !== false ? session.messageCount : filteredMessageCount,
          })
        "
        :avatar="session.groupAvatar"
        icon="i-heroicons-chat-bubble-left-right"
        icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white"
      >
        <template #actions>
          <!-- AI 分析：自动走增量路径，根据 lastAnalyzedMessageId 只跑新消息 -->
          <UButton
            v-if="ANALYSIS_TABS.has(activeTab)"
            :color="analysisStatus?.hasNewMessages ? 'orange' : 'primary'"
            variant="soft"
            size="sm"
            :icon="isReanalyzing ? 'i-heroicons-arrow-path' : 'i-heroicons-sparkles'"
            :loading="isReanalyzing"
            :disabled="analysisButtonDisabled"
            :title="
              isReanalyzing
                ? '正在分析中，请稍候'
                : analysisStatus?.hasNewMessages
                  ? `检测到 ${analysisStatus.newMessageCount} 条新消息，点击进行增量分析`
                  : analysisStatus?.everAnalyzed
                    ? '已完成分析，暂无新消息'
                    : '点击运行 AI 分析，提取任务/待办/关注点/知识/图谱'
            "
            class="relative"
            @click="triggerUnifiedAnalysis"
          >
            {{ analysisButtonLabel }}
            <!-- 红点角标：有新消息时显示 -->
            <span
              v-if="analysisStatus?.hasNewMessages && !isReanalyzing"
              class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-900"
            />
          </UButton>
          <!-- v0.17.10: 上次分析有失败批次时显示重试按钮（带 N 数标记） -->
          <UButton
            v-if="hasFailedBatches && !isReanalyzing"
            color="warning"
            variant="solid"
            size="sm"
            icon="i-heroicons-arrow-path"
            :title="`上次分析有 ${analysisStatus?.failedBatchCount} 个批次因 LLM 超时/错误未完成。点击只重试这些失败批次（已成功的不会重做）。`"
            @click="triggerRetryFailedBatches"
          >
            {{ retryFailedLabel }}
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-heroicons-chat-bubble-bottom-center-text"
            @click="openChatRecordViewer"
          >
            {{ t('analysis.tooltip.chatViewer') }}
          </UButton>
          <CaptureButton />
        </template>
        <!-- Tabs -->
        <div class="mt-4 flex items-center justify-between gap-3">
          <div class="flex shrink-0 items-center gap-2 overflow-x-auto scrollbar-hide">
            <!-- 本会话 Tab（单群数据：概览 / 查看 / 语录 / 成员） -->
            <div class="flex items-center gap-0.5">
              <button
                v-for="tab in sessionScopedTabs"
                :key="tab.id"
                class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all"
                :class="[
                  activeTab === tab.id
                    ? 'bg-pink-500 text-white dark:bg-pink-900/30 dark:text-pink-300'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
                ]"
                @click="activeTab = tab.id"
              >
                <UIcon :name="tab.icon" class="h-4 w-4" />
                <span class="whitespace-nowrap">{{ t(tab.labelKey) }}</span>
              </button>
            </div>

            <!-- 视觉分隔：跨会话 Tab 组 -->
            <div
              class="flex items-center gap-0.5 rounded-xl border border-blue-200 bg-blue-50/60 p-1 dark:border-blue-800/60 dark:bg-blue-900/20"
              :title="'以下功能聚合所有会话的数据，不受当前群限制'"
            >
              <button
                v-for="tab in crossSessionTabs"
                :key="tab.id"
                class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all"
                :class="[
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white'
                    : 'text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/40',
                ]"
                @click="activeTab = tab.id"
              >
                <UIcon :name="tab.icon" class="h-4 w-4" />
                <span class="whitespace-nowrap">{{ t(tab.labelKey) }}</span>
              </button>
            </div>
          </div>
          <!-- AI 对话、实验室和成员页都不使用这里的时间范围筛选，因此在这些一级 Tab 下隐藏。 -->
          <TimeSelect
            v-model="timeRangeValue"
            :session-id="currentSessionId ?? undefined"
            :visible="
              activeTab !== 'ai-chat' &&
              activeTab !== 'lab' &&
              activeTab !== 'members' &&
              activeTab !== 'tasks' &&
              activeTab !== 'todos' &&
              activeTab !== 'knowledge' &&
              activeTab !== 'focus' &&
              activeTab !== 'graph'
            "
            :initial-state="initialTimeState"
            @update:full-range="fullTimeRange = $event"
            @update:available-years="availableYears = $event"
          />
        </div>
      </PageHeader>

      <!-- Tab Content -->
      <div class="relative flex-1 overflow-y-auto">
        <!-- Loading Overlay -->
        <LoadingState v-if="isLoading" variant="overlay" />

        <div class="h-full">
          <Transition name="tab-slide" mode="out-in">
            <OverviewTab
              v-if="activeTab === 'overview'"
              :key="'overview-' + currentSessionId"
              :session="session"
              :member-activity="memberActivity"
              :top-members="topMembers"
              :bottom-members="bottomMembers"
              :message-types="messageTypes"
              :hourly-activity="hourlyActivity"
              :daily-activity="dailyActivity"
              :time-range="fullTimeRange"
              :selected-year="selectedYearForOverview"
              :filtered-message-count="filteredMessageCount"
              :filtered-member-count="filteredMemberCount"
              :time-filter="timeFilter"
              @open-session-index="showSessionIndexModal = true"
              @open-incremental-import="showIncrementalImportModal = true"
              @open-message-export="showMessageExportModal = true"
            />
            <ViewTab
              v-else-if="activeTab === 'view'"
              :key="'view-' + currentSessionId"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
            />
            <QuotesTab
              v-else-if="activeTab === 'quotes'"
              :key="'quotes-' + currentSessionId"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
            />
            <MemberTab
              v-else-if="activeTab === 'members'"
              :key="'members-' + currentSessionId"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
              @data-changed="loadData"
            />
            <TaskTab
              v-else-if="activeTab === 'tasks'"
              :key="'tasks-' + currentSessionId"
              :session-id="currentSessionId!"
            />
            <TodoTab
              v-else-if="activeTab === 'todos'"
              :key="'todos-' + currentSessionId"
              :session-id="currentSessionId!"
            />
            <KnowledgeTab v-else-if="activeTab === 'knowledge'" key="knowledge" />
            <FocusTab v-else-if="activeTab === 'focus'" key="focus" />
            <GraphTab v-else-if="activeTab === 'graph'" key="graph" />
            <ChatExplorer
              v-else-if="activeTab === 'ai-chat'"
              :key="'ai-chat-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              chat-type="group"
            />
            <AITab
              v-else-if="activeTab === 'lab'"
              :key="'lab-' + currentSessionId"
              :session-id="currentSessionId!"
              :session-name="session.name"
              chat-type="group"
              mode="sql-only"
            />
          </Transition>
        </div>
      </div>
    </template>

    <!-- Empty State -->
    <div v-else class="flex h-full items-center justify-center">
      <p class="text-gray-500">{{ t('analysis.groupChat.loadError') }}</p>
    </div>

    <!-- 会话索引弹窗（内部自动检测并弹出） -->
    <SessionIndexModal v-if="currentSessionId" v-model="showSessionIndexModal" :session-id="currentSessionId" />

    <!-- 增量导入弹窗 -->
    <IncrementalImportModal
      v-if="currentSessionId && session"
      v-model="showIncrementalImportModal"
      :session-id="currentSessionId"
      :session-name="session.name"
      @imported="loadData"
    />

    <!-- 导出聊天记录弹窗 -->
    <MessageExportModal v-if="currentSessionId" v-model="showMessageExportModal" />
  </div>
</template>

<style scoped>
.tab-slide-enter-active,
.tab-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.tab-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.tab-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
