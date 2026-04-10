<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useFocusStore } from '@/stores/focus'
import { isBrowserEnvironment } from '@/composables/useEnvironment'
import type { FocusItem } from '@/electron/main/services/focusService'

const focusStore = useFocusStore()
const { filteredItems, loading, statistics, selectedType } = storeToRefs(focusStore)

// 创建对话框
const showCreateDialog = ref(false)
const newFocusTitle = ref('')
const newFocusType = ref<FocusItem['type']>('topic')
const newFocusKeywords = ref('')
const isCreating = ref(false)

onMounted(async () => {
  await focusStore.loadItems()
})

async function handleCreate() {
  if (!newFocusTitle.value.trim()) return
  isCreating.value = true
  try {
    await focusStore.createItem({
      globalUserId: 'user_self',
      type: newFocusType.value,
      title: newFocusTitle.value.trim(),
      keywords: newFocusKeywords.value
        .split(/[,，\s]+/)
        .map((k) => k.trim())
        .filter(Boolean),
      status: 'active',
    })
    newFocusTitle.value = ''
    newFocusKeywords.value = ''
    showCreateDialog.value = false
  } finally {
    isCreating.value = false
  }
}

async function archiveItem(id: number) {
  if (isBrowserEnvironment()) return
  await focusStore.archiveItem(id)
}

const typeOptions = [
  { label: '话题', value: 'topic' },
  { label: '人物', value: 'person' },
  { label: '任务', value: 'task' },
  { label: '项目', value: 'project' },
  { label: '关键词', value: 'keyword' },
]

const typeColors: Record<string, string> = {
  topic: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  person: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  task: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  project: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  keyword: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

const typeLabels: Record<string, string> = {
  topic: '话题',
  person: '人物',
  task: '任务',
  project: '项目',
  keyword: '关键词',
}

function formatDate(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// 查看动态
const activityFocusId = ref<number | null>(null)
const activityFocusTitle = ref('')
const activityItems = ref<Array<{ sessionId: string; messageId: number; messageTs: number; relevance: number; summary?: string }>>([])
const loadingActivity = ref(false)

async function viewActivity(item: any) {
  activityFocusId.value = item.id
  activityFocusTitle.value = item.title
  activityItems.value = []
  loadingActivity.value = true
  if (!isBrowserEnvironment()) {
    const result = await window.collabApi?.getFocusActivity(item.id, 20)
    if (result?.success && result.data) {
      activityItems.value = result.data
    }
  }
  loadingActivity.value = false
}

function closeActivity() {
  activityFocusId.value = null
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部工具栏 -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
      <div class="flex items-center gap-3 text-sm">
        <span class="font-medium text-gray-900 dark:text-white">
          {{ statistics.active }} 个关注点
        </span>
      </div>
      <button
        class="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
        @click="showCreateDialog = true"
      >
        <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
        添加关注
      </button>
    </div>

    <!-- 类型过滤 -->
    <div class="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
      <button
        class="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
        :class="
          !selectedType
            ? 'bg-pink-500 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
        "
        @click="focusStore.setTypeFilter(null)"
      >
        全部
      </button>
      <button
        v-for="opt in typeOptions"
        :key="opt.value"
        class="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
        :class="
          selectedType === opt.value
            ? 'bg-pink-500 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
        "
        @click="focusStore.setTypeFilter(opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>

    <!-- 关注点列表 -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="loading" class="flex h-32 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
      </div>

      <div
        v-else-if="filteredItems.length === 0"
        class="flex h-48 flex-col items-center justify-center gap-2 text-gray-400"
      >
        <UIcon name="i-heroicons-eye" class="h-10 w-10" />
        <p class="text-sm">暂无关注点</p>
        <p class="text-xs">添加您关注的话题、人物或关键词，AI 将持续追踪相关动态</p>
      </div>

      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="item in filteredItems"
          :key="item.id"
          class="group flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
          data-testid="focus-item"
        >
          <!-- 类型标签 -->
          <span
            class="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
            :class="typeColors[item.type] || typeColors.keyword"
            data-testid="focus-type"
          >
            {{ typeLabels[item.type] || item.type }}
          </span>

          <!-- 内容 -->
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-white" data-testid="focus-title">{{ item.title }}</p>

            <!-- 关键词 -->
            <div v-if="item.keywords.length > 0" class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="kw in item.keywords.slice(0, 5)"
                :key="kw"
                class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              >
                {{ kw }}
              </span>
            </div>

            <!-- 统计信息 -->
            <div class="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
              <span v-if="item.mentionCount > 0">
                {{ item.mentionCount }} 次提及
              </span>
              <span v-if="item.relatedSessionCount > 0">
                {{ item.relatedSessionCount }} 个会话
              </span>
              <span v-if="item.lastActivityTs">
                最近 {{ formatDate(item.lastActivityTs) }}
              </span>
            </div>

            <!-- 最新摘要 -->
            <p v-if="item.lastSummary" class="mt-1 text-xs italic text-gray-500 dark:text-gray-400">
              {{ item.lastSummary }}
            </p>
          </div>

          <!-- 操作按钮 -->
          <div class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <!-- 查看动态 -->
            <button
              class="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-900/20"
              title="查看动态"
              :data-testid="`focus-update-${item.id}`"
              @click="viewActivity(item)"
            >
              <UIcon name="i-heroicons-clock" class="h-4 w-4" />
              <span class="sr-only">查看动态</span>
            </button>
            <button
              class="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
              @click="archiveItem(item.id)"
            >
              <UIcon name="i-heroicons-archive-box" class="h-4 w-4" />
            </button>
          </div>
        </li>
      </ul>
    </div>

    <!-- 创建关注点对话框 -->
    <div
      v-if="showCreateDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="create-focus-dialog"
      @click.self="showCreateDialog = false"
    >
      <div class="w-full max-w-sm rounded-xl bg-white shadow-2xl dark:bg-gray-900">
        <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 class="font-medium text-gray-900 dark:text-white">添加关注点</h3>
          <button class="text-gray-400 hover:text-gray-600" @click="showCreateDialog = false">
            <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
          </button>
        </div>

        <div class="space-y-3 p-4">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">类型</label>
            <select
              v-model="newFocusType"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              data-testid="focus-type"
            >
              <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">标题</label>
            <input
              v-model="newFocusTitle"
              type="text"
              placeholder="关注点名称..."
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              data-testid="focus-title-input"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">关键词（逗号分隔）</label>
            <input
              v-model="newFocusKeywords"
              type="text"
              placeholder="关键词1, 关键词2..."
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              data-testid="focus-keywords"
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
            :disabled="!newFocusTitle.trim() || isCreating"
            @click="handleCreate"
          >
            {{ isCreating ? '创建中...' : '添加' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 动态抽屉 -->
    <Teleport to="body">
      <div
        v-if="activityFocusId !== null"
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
        @click.self="closeActivity"
      >
        <div class="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl dark:bg-gray-900 sm:rounded-2xl">
          <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h3 class="font-medium text-gray-900 dark:text-white">
              <span class="text-pink-500">{{ activityFocusTitle }}</span> 的动态
            </h3>
            <button class="text-gray-400 hover:text-gray-600" @click="closeActivity">
              <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
            </button>
          </div>

          <div class="max-h-80 overflow-y-auto p-4">
            <div v-if="loadingActivity" class="flex h-24 items-center justify-center">
              <div class="h-5 w-5 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
            </div>
            <div
              v-else-if="activityItems.length === 0"
              class="flex h-24 flex-col items-center justify-center gap-1 text-gray-400"
            >
              <UIcon name="i-heroicons-inbox" class="h-8 w-8" />
              <p class="text-xs">暂无动态记录</p>
            </div>
            <ul v-else class="space-y-3">
              <li
                v-for="act in activityItems"
                :key="`${act.sessionId}-${act.messageId}`"
                class="rounded-lg border border-gray-100 p-3 dark:border-gray-700"
                data-testid="focus-update"
              >
                <div class="flex items-center justify-between text-xs text-gray-400">
                  <span data-testid="update-session">会话 {{ act.sessionId.slice(-8) }}</span>
                  <span data-testid="update-time">{{ formatDate(act.messageTs) }}</span>
                </div>
                <p v-if="act.summary" class="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {{ act.summary }}
                </p>
                <p v-else class="mt-1 text-xs italic text-gray-400">消息 #{{ act.messageId }}</p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
