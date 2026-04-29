<script setup lang="ts">
/**
 * 待办清单 Tab
 *
 * Layer 3 兜底逻辑：首次打开且未配置身份时，弹出强制确认弹窗让用户选择"我是谁"。
 * 日志前缀: [TodoTab]
 */
import { ref, computed, onMounted } from 'vue'
import { useVirtualList } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useTodoStore } from '@/stores/todo'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { isBrowserEnvironment } from '@/composables/useEnvironment'
import { useExtractionRefresh } from '@/composables/useExtractionRefresh'

const props = defineProps<{ sessionId?: string }>()

const todoStore = useTodoStore()
const sessionStore = useSessionStore()
const settingsStore = useSettingsStore()
const { filteredTodos, loading, statistics, filter } = storeToRefs(todoStore)
const { sessions } = storeToRefs(sessionStore)

// 会话 id → 名称映射（来源 badge 使用）
const sessionNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const s of sessions.value) map.set(s.id, s.name)
  return map
})

// 跨会话来源过滤
const scopeFilter = ref<'all' | string>('all')

const availableSources = computed(() => {
  const ids = new Set<string>()
  for (const t of filteredTodos.value) {
    if ((t as any).sourceSessionId) ids.add((t as any).sourceSessionId)
  }
  return Array.from(ids).map((id) => ({ id, name: sessionNameMap.value.get(id) || id }))
})

const scopedTodos = computed(() => {
  if (scopeFilter.value === 'all') return filteredTodos.value
  return filteredTodos.value.filter((t: any) => t.sourceSessionId === scopeFilter.value)
})

// 虚拟列表 (性能优化)
const TODO_ITEM_HEIGHT = 100
const VIRTUAL_CONTAINER_HEIGHT = 600
const {
  list: virtualTodos,
  containerProps,
  wrapperProps,
} = useVirtualList(scopedTodos, {
  itemHeight: TODO_ITEM_HEIGHT,
  overscan: 5,
})

// 身份配置
const identityConfig = computed(() => settingsStore.identityConfig)
const hasIdentity = computed(() => identityConfig.value?.globalNicknames?.length > 0)

// ===================== Layer 3: 首次使用强制身份确认 =====================
const showIdentityModal = ref(false)
const identityModalCandidates = ref<Array<{ id: number; name: string; messageCount: number }>>([])
const identityModalCustomName = ref('')
const identityModalSessionName = ref('')
const isLoadingCandidates = ref(false)
const IDENTITY_MODAL_SHOWN_KEY = 'collab:identityModalShown'

async function checkAndShowIdentityModal() {
  if (isBrowserEnvironment() || hasIdentity.value) return
  // 只在首次使用时弹窗（使用 sessionStorage 避免每次都弹）
  const sessionKey = `${IDENTITY_MODAL_SHOWN_KEY}:${props.sessionId ?? 'all'}`
  if (sessionStorage.getItem(sessionKey)) return

  sessionStorage.setItem(sessionKey, '1')

  console.log('[TodoTab] Layer 3: 未配置身份，准备弹出确认弹窗')

  // 获取当前会话的成员列表作为候选
  if (props.sessionId && !isBrowserEnvironment()) {
    isLoadingCandidates.value = true
    try {
      const members: any[] = await window.chatApi.getMembers(props.sessionId).catch(() => [])
      const sorted = [...members].sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0))
      identityModalCandidates.value = sorted.slice(0, 5).map((m) => ({
        id: m.id,
        name: m.groupNickname || m.accountName || `User_${m.id}`,
        messageCount: m.messageCount ?? 0,
      }))
      // 暂以 sessionId 作为展示名兜底
      identityModalSessionName.value = props.sessionId
      console.log('[TodoTab] 获取到候选成员:', identityModalCandidates.value)
    } catch (err) {
      console.error('[TodoTab] 获取候选成员失败:', err)
    } finally {
      isLoadingCandidates.value = false
    }
  }

  showIdentityModal.value = true
}

async function confirmIdentity(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  console.log('[TodoTab] Layer 3: 用户确认身份:', trimmed)
  const current = settingsStore.identityConfig?.globalNicknames ?? []
  if (!current.includes(trimmed)) {
    settingsStore.identityConfig = {
      ...settingsStore.identityConfig,
      globalNicknames: [...current, trimmed],
    }
  }
  showIdentityModal.value = false
  await loadTodos()
}

function skipIdentity() {
  console.log('[TodoTab] Layer 3: 用户跳过身份设置')
  showIdentityModal.value = false
}
// =========================================================================

// 创建待办对话框
const showCreateDialog = ref(false)
const newTodoTitle = ref('')
const newTodoPriority = ref<'low' | 'normal' | 'high' | 'urgent'>('normal')
const newTodoDueDate = ref('')
const isCreating = ref(false)

async function loadTodos() {
  await todoStore.loadAll()
}

async function handleCreateTodo() {
  if (!newTodoTitle.value.trim()) return
  isCreating.value = true
  try {
    await todoStore.createManualTodo(newTodoTitle.value.trim(), {
      globalUserId: 'user_self',
      priority: newTodoPriority.value,
      dueTs: newTodoDueDate.value ? new Date(newTodoDueDate.value).getTime() : undefined,
    })
    newTodoTitle.value = ''
    newTodoPriority.value = 'normal'
    newTodoDueDate.value = ''
    showCreateDialog.value = false
  } finally {
    isCreating.value = false
  }
}

async function completeTodo(todoId: number) {
  if (isBrowserEnvironment()) return
  await todoStore.completeTodo(todoId)
}

async function toggleStar(todoId: number) {
  if (isBrowserEnvironment()) return
  await todoStore.toggleStar(todoId)
}

async function deleteTodo(todoId: number) {
  if (isBrowserEnvironment()) return
  await todoStore.deleteTodo(todoId)
}

onMounted(async () => {
  await loadTodos()
  // Layer 3: 首次使用身份确认检查（延迟 500ms 避免与页面渲染冲突）
  setTimeout(checkAndShowIdentityModal, 500)
})

// v0.17.9: AI 分析每批完成都刷新本 tab，让用户实时看到新待办进来
useExtractionRefresh(loadTodos, { types: ['todos'] })

// 状态颜色和标签
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

const statusOptions = [
  { label: '待处理', value: 'pending' },
  { label: '进行中', value: 'in_progress' },
  { label: '已完成', value: 'completed' },
]

function toggleStatusFilter(value: string) {
  const current = filter.value.status || []
  const next = current.includes(value) ? current.filter((s) => s !== value) : [...current, value]
  todoStore.setFilter({ status: next })
}

function toggleStarFilter() {
  todoStore.setFilter({ isStarred: filter.value.isStarred ? undefined : true })
}

function formatDate(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function isOverdue(todo: any): boolean {
  return todo.dueTs && todo.dueTs < Date.now() && todo.status !== 'completed' && todo.status !== 'cancelled'
}

// 切换到「进行中」状态
async function setInProgress(todoId: number) {
  if (isBrowserEnvironment()) return
  await window.collabApi?.updateTodo(todoId, { status: 'in_progress' })
  todoStore.updateTodoField(todoId, { status: 'in_progress' })
}

// 编辑对话框
const editingTodo = ref<any | null>(null)
const editTodoForm = ref({ title: '', priority: 'normal', status: 'pending', dueTs: '', progress: 0, notes: '' })

function openEditTodo(todo: any) {
  editingTodo.value = todo
  editTodoForm.value = {
    title: todo.title,
    priority: todo.priority ?? 'normal',
    status: todo.status,
    dueTs: todo.dueTs ? new Date(todo.dueTs).toISOString().slice(0, 10) : '',
    progress: todo.progress ?? 0,
    notes: todo.notes ?? '',
  }
}

function closeEditTodo() {
  editingTodo.value = null
}

async function saveEditTodo() {
  if (!editingTodo.value || isBrowserEnvironment()) return
  const updates: Record<string, any> = {
    title: editTodoForm.value.title,
    priority: editTodoForm.value.priority,
    status: editTodoForm.value.status,
    dueTs: editTodoForm.value.dueTs ? new Date(editTodoForm.value.dueTs).getTime() : undefined,
    progress: Math.max(0, Math.min(100, Number(editTodoForm.value.progress))),
    notes: editTodoForm.value.notes || undefined,
  }
  await window.collabApi?.updateTodo(editingTodo.value.id, updates)
  todoStore.updateTodoField(editingTodo.value.id, updates)
  closeEditTodo()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Layer 3: 首次使用身份确认弹窗 -->
    <Teleport to="body">
      <div
        v-if="showIdentityModal"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
        data-testid="identity-confirm-dialog"
      >
        <div class="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
          <!-- 标题 -->
          <div class="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-user-circle" class="h-6 w-6 text-pink-500" />
              <h3 class="text-base font-semibold text-gray-900 dark:text-white">要使用待办功能，需先设置「我是谁」</h3>
            </div>
            <p class="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              在这个聊天群中，您是哪位成员？（按发言量排序）
            </p>
          </div>

          <!-- 候选成员 -->
          <div class="px-6 py-4">
            <div v-if="isLoadingCandidates" class="flex items-center justify-center py-6">
              <div class="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
            </div>
            <div v-else-if="identityModalCandidates.length > 0" class="space-y-2">
              <button
                v-for="c in identityModalCandidates"
                :key="c.id"
                class="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-left transition-all hover:border-pink-400 hover:bg-pink-50 dark:border-gray-700 dark:hover:border-pink-600 dark:hover:bg-pink-900/20"
                data-testid="member-option"
                @click="confirmIdentity(c.name)"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {{ c.name.charAt(0) }}
                  </div>
                  <span class="font-medium text-gray-900 dark:text-white">{{ c.name }}</span>
                </div>
                <span class="text-xs text-gray-400">{{ c.messageCount }} 条消息</span>
              </button>
            </div>

            <!-- 手动输入 -->
            <div class="mt-3">
              <label class="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                或者输入其他名称：
              </label>
              <div class="flex gap-2">
                <input
                  v-model="identityModalCustomName"
                  type="text"
                  placeholder="您的昵称或名字..."
                  class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  @keyup.enter="confirmIdentity(identityModalCustomName)"
                />
                <button
                  class="rounded-lg bg-pink-500 px-3 py-2 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-50"
                  :disabled="!identityModalCustomName.trim()"
                  @click="confirmIdentity(identityModalCustomName)"
                >
                  确认
                </button>
              </div>
            </div>
          </div>

          <!-- 底部 -->
          <div class="flex justify-end border-t border-gray-200 px-6 py-3 dark:border-gray-700">
            <button class="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" @click="skipIdentity">
              跳过此会话
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 顶部工具栏 -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
      <div class="flex items-center gap-3 text-sm">
        <span class="font-medium text-gray-900 dark:text-white">
          {{ statistics.total }} 个待办
          <span v-if="scopeFilter !== 'all'" class="text-gray-500">({{ scopedTodos.length }} 在当前筛选)</span>
        </span>
        <span v-if="statistics.overdue > 0" class="text-red-500">{{ statistics.overdue }} 个已超期</span>
        <span v-if="statistics.starred > 0" class="text-yellow-500">{{ statistics.starred }} 个星标</span>

        <!-- 来源过滤（待办是跨群的个人备忘） -->
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

      <div class="flex items-center gap-2">
        <!-- 星标过滤 -->
        <button
          class="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
          :class="
            filter.isStarred
              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
              : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          "
          @click="toggleStarFilter"
        >
          <UIcon name="i-heroicons-star" class="h-3.5 w-3.5" />
          星标
        </button>

        <!-- 新建按钮 -->
        <button
          class="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          @click="showCreateDialog = true"
        >
          <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
          新建待办
        </button>
      </div>
    </div>

    <!-- 状态过滤器 -->
    <div class="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
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
        @click="toggleStatusFilter(opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>

    <!-- 待办列表 -->
    <div class="flex-1 overflow-y-auto">
      <!-- 加载中 -->
      <div v-if="loading" class="flex h-32 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="filteredTodos.length === 0"
        class="flex h-48 flex-col items-center justify-center gap-2 text-gray-400"
      >
        <UIcon name="i-heroicons-check-circle" class="h-10 w-10" />
        <p class="text-sm">暂无待办</p>
        <p class="text-xs">AI 会自动同步分配给您的任务，或手动创建新待办</p>
      </div>

      <!-- 待办卡片列表 (虚拟滚动) -->
      <div
        v-else
        v-bind="containerProps"
        :style="{ height: `${VIRTUAL_CONTAINER_HEIGHT}px`, overflowY: 'auto' }"
        data-testid="todo-list"
      >
        <ul v-bind="wrapperProps" class="divide-y divide-gray-100 dark:divide-gray-800">
          <li
            v-for="{ data: todo } in virtualTodos"
            :key="todo.id"
            class="group px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            data-testid="todo-item"
          >
            <div class="flex items-start gap-3">
              <!-- 完成复选框 -->
              <button
                class="mt-0.5 shrink-0 rounded-full border-2 border-gray-300 p-0.5 transition-colors hover:border-green-500 dark:border-gray-600"
                :class="{ 'border-green-500 bg-green-500': todo.status === 'completed' }"
                @click="completeTodo(todo.id)"
              >
                <UIcon
                  name="i-heroicons-check"
                  class="h-3 w-3"
                  :class="todo.status === 'completed' ? 'text-white' : 'text-transparent'"
                />
              </button>

              <!-- 内容 -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <!-- 优先级 -->
                  <UIcon
                    name="i-heroicons-flag"
                    class="h-3.5 w-3.5 shrink-0"
                    :class="priorityColors[todo.priority] || priorityColors.normal"
                  />

                  <p
                    class="truncate text-sm font-medium text-gray-900 dark:text-white"
                    :class="{
                      'line-through opacity-60': todo.status === 'completed' || todo.status === 'cancelled',
                    }"
                  >
                    {{ todo.title }}
                  </p>

                  <span
                    class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="statusColors[todo.status]"
                    data-testid="todo-status-badge"
                  >
                    {{ statusLabels[todo.status] }}
                  </span>
                </div>

                <p v-if="todo.description" class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                  {{ todo.description }}
                </p>

                <!-- 进度条（仅在 in_progress 且 progress > 0 时显示） -->
                <div
                  v-if="todo.status === 'in_progress' && (todo.progress ?? 0) > 0"
                  class="mt-1.5 flex items-center gap-2"
                >
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      class="h-full rounded-full bg-blue-500 transition-all"
                      :style="{ width: `${todo.progress ?? 0}%` }"
                    />
                  </div>
                  <span class="shrink-0 text-xs text-gray-400" data-testid="todo-progress-text">
                    {{ todo.progress ?? 0 }}%
                  </span>
                </div>

                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                  <!-- 截止日期 -->
                  <span v-if="todo.dueTs" :class="{ 'text-red-500': isOverdue(todo) }">
                    截止 {{ formatDate(todo.dueTs) }}
                  </span>

                  <!-- 来源标签 -->
                  <span v-if="todo.sourceType === 'task'" class="text-blue-400" data-testid="todo-source">
                    来自任务
                  </span>

                  <!-- 来源会话 badge：跨群聚合，点击可筛选 -->
                  <span
                    v-if="todo.sourceSessionId"
                    class="flex cursor-pointer items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/60"
                    :title="'点击仅显示此会话的待办'"
                    @click.stop="scopeFilter = todo.sourceSessionId"
                  >
                    <UIcon name="i-heroicons-chat-bubble-left" class="h-3 w-3" />
                    {{ sessionNameMap.get(todo.sourceSessionId) || '未知会话' }}
                  </span>

                  <!-- 备注 -->
                  <span v-if="todo.notes" class="italic">{{ todo.notes }}</span>
                </div>
              </div>

              <!-- 右侧操作 -->
              <div class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <!-- 推进到进行中 -->
                <button
                  v-if="todo.status === 'pending'"
                  class="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-900/20"
                  title="标记为进行中"
                  data-testid="todo-status"
                  @click="setInProgress(todo.id)"
                >
                  <UIcon name="i-heroicons-play" class="h-4 w-4" />
                </button>

                <!-- 编辑 -->
                <button
                  class="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="编辑"
                  :data-testid="`todo-edit-${todo.id}`"
                  @click="openEditTodo(todo)"
                >
                  <UIcon name="i-heroicons-pencil-square" class="h-4 w-4" />
                </button>

                <!-- 星标 -->
                <button
                  class="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                  :class="{ 'text-yellow-400': todo.isStarred, 'text-gray-400': !todo.isStarred }"
                  @click="toggleStar(todo.id)"
                >
                  <UIcon :name="todo.isStarred ? 'i-heroicons-star-solid' : 'i-heroicons-star'" class="h-4 w-4" />
                </button>

                <!-- 删除 -->
                <button
                  class="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  @click="deleteTodo(todo.id)"
                >
                  <UIcon name="i-heroicons-trash" class="h-4 w-4" />
                </button>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- 新建待办对话框 -->
    <div
      v-if="showCreateDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="create-todo-dialog"
      @click.self="showCreateDialog = false"
    >
      <div class="w-full max-w-sm rounded-xl bg-white shadow-2xl dark:bg-gray-900">
        <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 class="font-medium text-gray-900 dark:text-white">新建待办</h3>
          <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" @click="showCreateDialog = false">
            <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
          </button>
        </div>

        <div class="space-y-3 p-4">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">标题</label>
            <input
              v-model="newTodoTitle"
              type="text"
              placeholder="待办标题..."
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              @keyup.enter="handleCreateTodo"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">优先级</label>
            <select
              v-model="newTodoPriority"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              data-testid="todo-priority"
            >
              <option value="low">低</option>
              <option value="normal">普通</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">截止日期（可选）</label>
            <input
              v-model="newTodoDueDate"
              type="date"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              data-testid="todo-due-date"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            @click="showCreateDialog = false"
          >
            取消
          </button>
          <button
            class="rounded-lg bg-pink-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-50"
            :disabled="!newTodoTitle.trim() || isCreating"
            @click="handleCreateTodo"
          >
            {{ isCreating ? '创建中...' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 编辑待办对话框 -->
    <Teleport to="body">
      <div
        v-if="editingTodo"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="closeEditTodo"
      >
        <div class="w-full max-w-sm rounded-xl bg-white shadow-2xl dark:bg-gray-900">
          <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h3 class="font-medium text-gray-900 dark:text-white">编辑待办</h3>
            <button class="text-gray-400 hover:text-gray-600" @click="closeEditTodo">
              <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
            </button>
          </div>

          <div class="space-y-3 p-4">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">标题</label>
              <input
                v-model="editTodoForm.title"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                data-testid="todo-title-input"
              />
            </div>

            <div class="flex gap-3">
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">状态</label>
                <select
                  v-model="editTodoForm.status"
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
                  v-model="editTodoForm.priority"
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
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                进度 {{ editTodoForm.progress }}%
              </label>
              <input
                v-model.number="editTodoForm.progress"
                type="range"
                min="0"
                max="100"
                step="5"
                class="w-full accent-blue-500"
                data-testid="todo-progress"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">截止日期</label>
              <input
                v-model="editTodoForm.dueTs"
                type="date"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">备注</label>
              <input
                v-model="editTodoForm.notes"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>

          <div class="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <button
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
              @click="closeEditTodo"
            >
              取消
            </button>
            <button
              class="rounded-lg bg-pink-500 px-4 py-2 text-sm text-white hover:bg-pink-600 disabled:opacity-50"
              :disabled="!editTodoForm.title.trim()"
              data-testid="todo-save"
              @click="saveEditTodo"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
