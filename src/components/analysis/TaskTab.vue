<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useVirtualList } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useTaskStore } from '@/stores/task'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

const props = defineProps<{
  sessionId: string
}>()

const taskStore = useTaskStore()
const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const router = useRouter()
const { filteredTasks, loading, statistics, filter } = storeToRefs(taskStore)
const { sessions } = storeToRefs(sessionStore)

// 会话 id → 显示名映射（用于来源 badge）
const sessionNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const s of sessions.value) map.set(s.id, s.name)
  return map
})

// 跨会话过滤：'all' = 全部群，其它 = 只看该群
const scopeFilter = ref<'all' | string>('all')

// 从当前加载到的任务里动态提取有数据的会话，作为下拉选项
const availableSources = computed(() => {
  const ids = new Set<string>()
  for (const t of filteredTasks.value) {
    const sources = (t as any).sources as Array<{ sessionId: string }> | undefined
    if (sources) for (const s of sources) ids.add(s.sessionId)
  }
  return Array.from(ids).map((id) => ({ id, name: sessionNameMap.value.get(id) || id }))
})

// 再按"来源会话"收窄 filteredTasks
const scopedTasks = computed(() => {
  if (scopeFilter.value === 'all') return filteredTasks.value
  return filteredTasks.value.filter((t: any) => {
    const sources = t.sources as Array<{ sessionId: string }> | undefined
    return sources?.some((s) => s.sessionId === scopeFilter.value)
  })
})

// 虚拟列表 (性能优化: 仅渲染可见区域的任务卡片)
const TASK_ITEM_HEIGHT = 100 // 每个任务卡片估计高度 (px)
const VIRTUAL_CONTAINER_HEIGHT = 600 // 容器高度 (px)
const {
  list: virtualTasks,
  containerProps,
  wrapperProps,
} = useVirtualList(scopedTasks, {
  itemHeight: TASK_ITEM_HEIGHT,
  overscan: 5,
})

// 提取状态
const extractionJobs = ref<any[]>([])
const latestJob = computed(() => extractionJobs.value[0] ?? null)
const isExtracting = computed(() => latestJob.value?.status === 'pending' || latestJob.value?.status === 'running')

// 来源消息查看器

// 加载任务（全局跨群视图，带序号防止竞态）
// 设计语义：任务是全局的，TaskTab 默认展示所有会话聚合后的任务，
// 通过顶部"来源"下拉手动收窄到某个群
let _loadSeq = 0
async function loadTasks() {
  const seq = ++_loadSeq
  const result = await taskStore.loadAll()
  if (seq !== _loadSeq) return
  return result
}

// 加载提取状态
async function loadExtractionStatus() {
  if (isBrowserEnvironment()) return
  const result = await window.collabApi?.getExtractionJobs(props.sessionId)
  if (result?.success && result.data) {
    extractionJobs.value = result.data
  }
}

// 手动触发提取
// triggerExtraction 已下线：重新分析改为顶部 Tab 栏的"AI 重新分析全部"按钮，
// 避免在每个 Tab 里重复同一个公共操作，也避免只跑 tasks 导致面板不同步。

// 重试失败的任务
async function retryJob(jobId: string) {
  if (isBrowserEnvironment()) return
  await window.collabApi?.retryExtractionJob(jobId)
  await loadExtractionStatus()
}

// 监听提取进度事件（需要在 onUnmounted 清理，防止内存泄漏）
const _ipcCleanups: (() => void)[] = []

function setupExtractionListeners() {
  if (isBrowserEnvironment() || !window.electron) return

  const onProgress = (_event: any, data: any) => {
    if (data.sessionId !== props.sessionId) return
    const idx = extractionJobs.value.findIndex((j) => j.id === data.jobId)
    if (idx !== -1) {
      extractionJobs.value[idx].progress = data.progress
      extractionJobs.value[idx].progressMessage = data.message
    }
  }
  const onDone = (_event: any, data: any) => {
    if (data.sessionId !== props.sessionId) return
    loadExtractionStatus()
    loadTasks()
  }
  const onError = (_event: any, data: any) => {
    if (data.sessionId !== props.sessionId) return
    loadExtractionStatus()
  }

  window.electron.ipcRenderer.on('collab:extractionProgress', onProgress)
  window.electron.ipcRenderer.on('collab:extractionDone', onDone)
  window.electron.ipcRenderer.on('collab:extractionError', onError)

  _ipcCleanups.push(
    () => window.electron.ipcRenderer.removeListener('collab:extractionProgress', onProgress),
    () => window.electron.ipcRenderer.removeListener('collab:extractionDone', onDone),
    () => window.electron.ipcRenderer.removeListener('collab:extractionError', onError)
  )
}

onMounted(async () => {
  await Promise.all([loadTasks(), loadExtractionStatus()])
  setupExtractionListeners()
})

onUnmounted(() => {
  _ipcCleanups.forEach((fn) => fn())
  _ipcCleanups.length = 0
})

watch(
  () => props.sessionId,
  async () => {
    await Promise.all([loadTasks(), loadExtractionStatus()])
  }
)

// 排序选项与切换
const sortOptions = [
  { value: 'due', label: '截止日期' },
  { value: 'created', label: '创建时间' },
  { value: 'updated', label: '更新时间' },
] as const

function toggleSortOrder() {
  const next = (filter.value.sortOrder || 'asc') === 'asc' ? 'desc' : 'asc'
  taskStore.setFilter({ sortOrder: next })
}

// 状态徽章颜色
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const statusLabels: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
}

const priorityColors: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  normal: 'text-gray-500',
  low: 'text-gray-400',
}

const priorityLabels: Record<string, string> = {
  urgent: '紧急',
  high: '高',
  normal: '普通',
  low: '低',
}

// 过滤选项
const statusOptions = [
  { label: '待处理', value: 'pending' },
  { label: '进行中', value: 'in_progress' },
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
]

function toggleStatusFilter(value: string) {
  const current = filter.value.status || []
  const next = current.includes(value) ? current.filter((s) => s !== value) : [...current, value]
  taskStore.setFilter({ status: next })
}

// 格式化日期
function formatDate(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// 是否超期
function isOverdue(task: any): boolean {
  return task.dueTs && task.dueTs < Date.now() && task.status !== 'completed' && task.status !== 'cancelled'
}

// 快速完成任务
async function completeTask(taskId: number) {
  if (isBrowserEnvironment()) return
  const result = await window.collabApi?.updateTask(taskId, { status: 'completed' })
  if (result?.success) {
    taskStore.updateTask(taskId, { status: 'completed' })
  } else {
    console.error('[TaskTab] completeTask failed:', result?.error)
  }
}

// 查看来源消息：打开全局聊天记录抽屉，定位到任务提取时记录的那条消息。
// 若任务来自其它会话（跨会话视图），先 push 路由切换到该会话的概览页再打开抽屉。
async function viewSource(task: any) {
  if (!task.sources || task.sources.length === 0) return
  const src = task.sources[0]
  const targetSession = sessions.value.find((s) => s.id === src.sessionId)

  const openDrawer = () => {
    layoutStore.openChatRecordDrawer({ scrollToMessageId: src.messageId })
  }

  if (src.sessionId && src.sessionId !== props.sessionId) {
    // 跨会话：先路由到目标会话，再等下一帧打开抽屉
    const routeName = targetSession?.type === 'private' ? 'private-chat' : 'group-chat'
    await router.push({ name: routeName, params: { id: src.sessionId } })
    setTimeout(openDrawer, 50)
  } else {
    openDrawer()
  }
}

// 排序控件

// 新建任务对话框
const showCreateDialog = ref(false)
const createForm = ref({ title: '', description: '', priority: 'normal' as any, dueTs: '' })
const isCreatingTask = ref(false)

async function handleCreateTask() {
  if (!createForm.value.title.trim() || isBrowserEnvironment()) return
  isCreatingTask.value = true
  try {
    const result = await window.collabApi?.createTask?.({
      sessionId: props.sessionId,
      title: createForm.value.title.trim(),
      description: createForm.value.description || undefined,
      priority: createForm.value.priority,
      dueTs: createForm.value.dueTs ? new Date(createForm.value.dueTs).getTime() : undefined,
      status: 'pending',
      confidence: 1.0,
      isManual: true,
      tags: [],
      metadata: {},
    })
    if (result?.success) {
      await loadTasks()
      createForm.value = { title: '', description: '', priority: 'normal', dueTs: '' }
      showCreateDialog.value = false
    }
  } finally {
    isCreatingTask.value = false
  }
}

// 编辑对话框
const editingTask = ref<any | null>(null)
const editForm = ref({ title: '', description: '', priority: 'normal', status: 'pending', dueTs: '' })

function openEdit(task: any) {
  editingTask.value = task
  // 回填截止日期：
  // 1. 优先用 task.dueTs（若存在且是合法的未来或当代时间戳，即 > 2000 年）
  // 2. 否则退回到首个源消息的时间戳（来自提取时记录的 task.sources[].messageTs）
  // 3. 都没有才留空 —— 避免 input[type=date] 把 0/null 渲染为 1970-01-01
  const MIN_VALID_TS = new Date('2000-01-01').getTime()
  let dueTsStr = ''
  if (task.dueTs && task.dueTs > MIN_VALID_TS) {
    dueTsStr = new Date(task.dueTs).toISOString().slice(0, 10)
  } else if (task.sources && task.sources.length > 0) {
    const sourceTs = task.sources[0].messageTs
    if (sourceTs && sourceTs > MIN_VALID_TS) {
      dueTsStr = new Date(sourceTs).toISOString().slice(0, 10)
    }
  }
  editForm.value = {
    title: task.title,
    description: task.description ?? '',
    priority: task.priority,
    status: task.status,
    dueTs: dueTsStr,
  }
}

function closeEdit() {
  editingTask.value = null
}

async function saveEdit() {
  if (!editingTask.value || isBrowserEnvironment()) return
  const updates: Record<string, any> = {
    title: editForm.value.title,
    description: editForm.value.description || undefined,
    priority: editForm.value.priority,
    status: editForm.value.status,
    dueTs: editForm.value.dueTs ? new Date(editForm.value.dueTs).getTime() : undefined,
    isManual: true,
  }
  const result = await window.collabApi?.updateTask(editingTask.value.id, updates)
  if (result?.success) {
    taskStore.updateTask(editingTask.value.id, updates)
    closeEdit()
  } else {
    console.error('[TaskTab] saveEdit failed:', result?.error)
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部工具栏 -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
      <!-- 统计徽章 -->
      <div class="flex items-center gap-3 text-sm">
        <span class="font-medium text-gray-900 dark:text-white">
          {{ statistics.total }} 个任务
          <span v-if="scopeFilter !== 'all'" class="text-gray-500">({{ scopedTasks.length }} 在当前筛选)</span>
        </span>
        <span v-if="statistics.overdue > 0" class="text-red-500">{{ statistics.overdue }} 个已超期</span>

        <!-- 来源会话过滤（任务是跨群全局数据，默认显示全部） -->
        <div class="flex items-center gap-1 text-xs text-gray-500">
          <span>来源：</span>
          <select
            v-model="scopeFilter"
            class="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <option value="all">全部会话</option>
            <option v-for="s in availableSources" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>
        </div>
      </div>

      <!-- 提取状态 / 触发按钮 -->
      <div class="flex items-center gap-2">
        <!-- 提取进度条 -->
        <div v-if="isExtracting" class="flex items-center gap-2 text-sm text-gray-500">
          <div class="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              class="h-full rounded-full bg-pink-500 transition-all"
              :style="{ width: `${latestJob.progress ?? 0}%` }"
            />
          </div>
          <span class="truncate max-w-32">{{ latestJob.progressMessage || 'AI 分析中...' }}</span>
        </div>

        <!-- 重试按钮（仅失败时显示） -->
        <button
          v-else-if="latestJob?.status === 'failed'"
          class="flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
          @click="retryJob(latestJob.id)"
        >
          <UIcon name="i-heroicons-arrow-path" class="h-3.5 w-3.5" />
          重试提取
        </button>

        <!-- 说明：原来的"AI 重新分析"按钮只会重跑 tasks，易误导；
             已提升到顶部 Tab 栏，点击即一次性重跑 tasks/todos/focus/faqs/graph 五类 -->

        <!-- 新建任务按钮 -->
        <button
          class="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          data-testid="create-task"
          @click="showCreateDialog = true"
        >
          <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
          新建任务
        </button>
      </div>
    </div>

    <!-- 状态过滤器 + 排序 -->
    <div class="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
      <span class="text-xs text-gray-500">状态：</span>
      <button
        v-for="opt in statusOptions"
        :key="opt.value"
        class="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
        :class="
          (filter.status || []).includes(opt.value)
            ? 'bg-pink-500 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
        "
        :data-testid="`task-filter-${opt.value}`"
        @click="toggleStatusFilter(opt.value)"
      >
        {{ opt.label }}
      </button>

      <!-- 排序控件 -->
      <div class="ml-auto flex items-center gap-1">
        <span class="text-xs text-gray-500">排序：</span>
        <select
          class="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          :value="filter.sortBy || 'due'"
          @change="taskStore.setFilter({ sortBy: ($event.target as HTMLSelectElement).value as any })"
        >
          <option v-for="s in sortOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <button
          class="rounded border border-gray-300 p-0.5 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
          :title="filter.sortOrder === 'asc' ? '升序' : '降序'"
          @click="toggleSortOrder"
        >
          <UIcon
            :name="filter.sortOrder === 'asc' ? 'i-heroicons-bars-arrow-up' : 'i-heroicons-bars-arrow-down'"
            class="h-3.5 w-3.5"
          />
        </button>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="flex-1 overflow-y-auto">
      <!-- 加载中 -->
      <div v-if="loading" class="flex h-32 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="filteredTasks.length === 0"
        class="flex h-48 flex-col items-center justify-center gap-2 text-gray-400"
      >
        <UIcon name="i-heroicons-clipboard-document-list" class="h-10 w-10" />
        <p class="text-sm">暂无任务</p>
        <p v-if="!latestJob" class="text-xs">导入聊天记录后，AI 将自动分析并提取任务</p>
      </div>

      <!-- 任务卡片列表 (虚拟滚动) -->
      <div
        v-else
        v-bind="containerProps"
        :style="{ height: `${VIRTUAL_CONTAINER_HEIGHT}px`, overflowY: 'auto' }"
        data-testid="task-list"
      >
        <ul v-bind="wrapperProps" class="divide-y divide-gray-100 dark:divide-gray-800">
          <li
            v-for="{ data: task } in virtualTasks"
            :key="task.id"
            class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            data-testid="task-card"
          >
            <div class="flex items-start gap-3">
              <!-- 优先级指示器 -->
              <div class="mt-1 shrink-0">
                <UIcon
                  name="i-heroicons-flag"
                  class="h-4 w-4"
                  :class="priorityColors[task.priority] || priorityColors.normal"
                />
              </div>

              <!-- 内容 -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p
                    class="truncate text-sm font-medium text-gray-900 dark:text-white"
                    :class="{ 'line-through opacity-60': task.status === 'completed' || task.status === 'cancelled' }"
                    data-testid="task-title"
                  >
                    {{ task.title }}
                  </p>
                  <span
                    class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="statusColors[task.status]"
                    data-testid="task-status"
                  >
                    {{ statusLabels[task.status] }}
                  </span>
                </div>

                <p v-if="task.description" class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                  {{ task.description }}
                </p>

                <!-- 元信息行 -->
                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                  <span v-if="task.ownerDisplayName" class="flex items-center gap-1" data-testid="task-owner">
                    <UIcon name="i-heroicons-user" class="h-3 w-3" />
                    {{ task.ownerDisplayName }}
                  </span>
                  <span
                    v-if="task.dueTs"
                    class="flex items-center gap-1"
                    :class="isOverdue(task) ? 'text-red-500' : ''"
                    data-testid="task-due"
                  >
                    <UIcon name="i-heroicons-calendar" class="h-3 w-3" />
                    {{ formatDate(task.dueTs) }}
                    <span v-if="isOverdue(task)">(已超期)</span>
                  </span>
                  <span class="flex items-center gap-1" data-testid="task-confidence">
                    <UIcon name="i-heroicons-cpu-chip" class="h-3 w-3" />
                    置信度 {{ Math.round(task.confidence * 100) }}%
                  </span>
                  <span class="shrink-0">{{ priorityLabels[task.priority] }}优先级</span>
                  <!-- 来源 badge：点击可筛选到对应会话 -->
                  <span
                    v-if="task.sources && task.sources.length > 0"
                    class="flex cursor-pointer items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/60"
                    data-testid="task-source"
                    :title="'点击仅显示此会话的任务'"
                    @click.stop="scopeFilter = task.sources[0].sessionId"
                  >
                    <UIcon name="i-heroicons-chat-bubble-left" class="h-3 w-3" />
                    {{ sessionNameMap.get(task.sources[0].sessionId) || '未知会话' }}
                    <span v-if="task.sources.length > 1" class="text-blue-400">+{{ task.sources.length - 1 }}</span>
                  </span>
                </div>

                <!-- 参与者 -->
                <div
                  v-if="task.participants && task.participants.length > 0"
                  class="mt-1 flex flex-wrap items-center gap-1"
                >
                  <UIcon name="i-heroicons-users" class="h-3 w-3 text-gray-400" />
                  <span
                    v-for="p in task.participants"
                    :key="p.globalUserId"
                    class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {{ p.role === 'owner' ? '负责人' : '参与者' }}: {{ p.globalUserId.slice(-8) }}
                  </span>
                </div>

                <!-- 来源会话 -->
                <div
                  v-if="task.sources && task.sources.length > 0"
                  class="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-400"
                >
                  <UIcon name="i-heroicons-link" class="h-3 w-3" />
                  <span>来自 {{ task.sources.length }} 个会话</span>
                </div>

                <!-- 操作按钮 -->
                <div class="mt-2 flex items-center gap-2">
                  <button
                    v-if="task.status !== 'completed' && task.status !== 'cancelled'"
                    class="flex items-center gap-1 rounded border border-green-300 px-2 py-0.5 text-xs text-green-600 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20"
                    :data-testid="`task-complete-${task.id}`"
                    @click.stop="completeTask(task.id)"
                  >
                    <UIcon name="i-heroicons-check" class="h-3 w-3" />
                    完成
                  </button>
                  <button
                    class="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                    :data-testid="`task-edit-${task.id}`"
                    @click.stop="openEdit(task)"
                  >
                    <UIcon name="i-heroicons-pencil-square" class="h-3 w-3" />
                    编辑
                  </button>
                  <!-- 查看来源消息 -->
                  <button
                    v-if="task.sources && task.sources.length > 0"
                    class="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                    data-testid="task-view-source"
                    @click.stop="viewSource(task)"
                  >
                    <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-3 w-3" />
                    查看
                  </button>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- 新建任务对话框 -->
    <Teleport to="body">
      <div
        v-if="showCreateDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        data-testid="create-task-dialog"
        @click.self="showCreateDialog = false"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900">
          <h3 class="mb-4 text-base font-semibold text-gray-900 dark:text-white">新建任务</h3>

          <div class="space-y-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">标题 *</label>
              <input
                v-model="createForm.title"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="任务标题..."
                data-testid="create-task-title"
                @keyup.enter="handleCreateTask"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">描述</label>
              <textarea
                v-model="createForm.description"
                rows="3"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="任务描述..."
              />
            </div>
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">优先级</label>
                <select
                  v-model="createForm.priority"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  <option value="low">低</option>
                  <option value="normal">普通</option>
                  <option value="high">高</option>
                  <option value="urgent">紧急</option>
                </select>
              </div>
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">截止日期</label>
                <input
                  v-model="createForm.dueTs"
                  type="date"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <button
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
              @click="showCreateDialog = false"
            >
              取消
            </button>
            <button
              class="rounded-lg bg-pink-500 px-4 py-2 text-sm text-white hover:bg-pink-600 disabled:opacity-50"
              :disabled="!createForm.title.trim() || isCreatingTask"
              data-testid="create-task-save"
              @click="handleCreateTask"
            >
              {{ isCreatingTask ? '创建中...' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 编辑对话框 -->
    <Teleport to="body">
      <div
        v-if="editingTask"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        @click.self="closeEdit"
      >
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900">
          <h3 class="mb-4 text-base font-semibold text-gray-900 dark:text-white">编辑任务</h3>

          <div class="space-y-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">标题</label>
              <input
                v-model="editForm.title"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                data-testid="task-edit-title"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">描述</label>
              <textarea
                v-model="editForm.description"
                rows="3"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">状态</label>
                <select
                  v-model="editForm.status"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  <option value="pending">待处理</option>
                  <option value="in_progress">进行中</option>
                  <option value="completed">已完成</option>
                  <option value="cancelled">已取消</option>
                </select>
              </div>
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">优先级</label>
                <select
                  v-model="editForm.priority"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  <option value="low">低</option>
                  <option value="normal">普通</option>
                  <option value="high">高</option>
                  <option value="urgent">紧急</option>
                </select>
              </div>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">截止日期</label>
              <input
                v-model="editForm.dueTs"
                type="date"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <button
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
              @click="closeEdit"
            >
              取消
            </button>
            <button
              class="rounded-lg bg-pink-500 px-4 py-2 text-sm text-white hover:bg-pink-600 disabled:opacity-50"
              :disabled="!editForm.title.trim()"
              data-testid="task-save"
              @click="saveEdit"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
