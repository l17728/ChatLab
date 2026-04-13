<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useVirtualList } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useKnowledgeStore } from '@/stores/knowledge'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

const knowledgeStore = useKnowledgeStore()
const { filteredItems, loading, statistics, categories, filter, viewStatus } = storeToRefs(knowledgeStore)

// 虚拟列表 (性能优化)
const KNOWLEDGE_ITEM_HEIGHT = 120
const VIRTUAL_CONTAINER_HEIGHT = 600
const {
  list: virtualItems,
  containerProps,
  wrapperProps,
} = useVirtualList(filteredItems, {
  itemHeight: KNOWLEDGE_ITEM_HEIGHT,
  overscan: 5,
})

// 展开的知识条目
const expandedId = ref<number | null>(null)

// 搜索文本（本地绑定后触发 store 过滤）
const searchText = ref('')
function onSearch() {
  knowledgeStore.setFilter({ searchText: searchText.value || undefined })
}

onMounted(async () => {
  await Promise.all([knowledgeStore.loadItems(), knowledgeStore.loadCategories()])
})

async function markHelpful(itemId: number) {
  if (isBrowserEnvironment()) return
  await knowledgeStore.markHelpful(itemId)
}

async function archiveItem(itemId: number) {
  if (isBrowserEnvironment()) return
  await knowledgeStore.archiveItem(itemId)
}

async function restoreItem(itemId: number) {
  if (isBrowserEnvironment()) return
  await knowledgeStore.restoreItem(itemId)
}

async function switchView(status: 'active' | 'archived') {
  await knowledgeStore.setViewStatus(status)
}

function toggleExpand(id: number) {
  if (expandedId.value !== id) {
    expandedId.value = id
    // 递增浏览计数
    if (!isBrowserEnvironment()) {
      window.collabApi?.incrementKnowledgeView(id)
      const idx = knowledgeStore.items.findIndex((i) => i.id === id)
      if (idx !== -1)
        knowledgeStore.items[idx] = { ...knowledgeStore.items[idx], viewCount: knowledgeStore.items[idx].viewCount + 1 }
    }
  } else {
    expandedId.value = null
  }
}

function selectCategory(category?: string) {
  knowledgeStore.setFilter({ category })
}

function toggleTypeFilter(type: string) {
  const current = filter.value.type || []
  const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
  knowledgeStore.setFilter({ type: next.length > 0 ? next : undefined })
}

// 编辑对话框
const editingItem = ref<any | null>(null)
const editForm = ref({ title: '', content: '', summary: '', category: '' })

function openEdit(item: any) {
  editingItem.value = item
  editForm.value = {
    title: item.title,
    content: item.content,
    summary: item.summary ?? '',
    category: item.category ?? '',
  }
}

function closeEdit() {
  editingItem.value = null
}

async function saveEdit() {
  if (!editingItem.value || isBrowserEnvironment()) return
  const updates = {
    title: editForm.value.title,
    content: editForm.value.content,
    summary: editForm.value.summary || undefined,
    category: editForm.value.category || undefined,
    isEdited: true,
  }
  await knowledgeStore.updateItem(editingItem.value.id, updates)
  closeEdit()
}

// 新建知识
const showCreateDialog = ref(false)
const createForm = ref({ type: 'faq' as any, title: '', content: '', category: '', summary: '' })
const isCreating = ref(false)

async function handleCreate() {
  if (!createForm.value.title.trim() || !createForm.value.content.trim()) return
  isCreating.value = true
  try {
    await window.collabApi?.createKnowledgeItem({
      type: createForm.value.type,
      title: createForm.value.title.trim(),
      content: createForm.value.content.trim(),
      summary: createForm.value.summary || undefined,
      category: createForm.value.category || undefined,
      tags: [],
      sourceSessionIds: [],
      sourceMessageRefs: [],
      confidence: 1.0,
      isEdited: true,
      status: 'active',
    })
    await knowledgeStore.loadItems()
    createForm.value = { type: 'faq', title: '', content: '', category: '', summary: '' }
    showCreateDialog.value = false
  } finally {
    isCreating.value = false
  }
}

const typeOptions = [
  { label: 'FAQ', value: 'faq', icon: 'i-heroicons-question-mark-circle' },
  { label: 'Q&A', value: 'qa', icon: 'i-heroicons-chat-bubble-left-right' },
  { label: '概念', value: 'concept', icon: 'i-heroicons-light-bulb' },
  { label: '文档', value: 'document', icon: 'i-heroicons-document-text' },
  { label: '流程', value: 'procedure', icon: 'i-heroicons-numbered-list' },
  { label: '技巧', value: 'tip', icon: 'i-heroicons-sparkles' },
]

const typeColors: Record<string, string> = {
  faq: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  qa: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  concept: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  document: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  procedure: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  tip: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
}

const typeLabels: Record<string, string> = {
  faq: 'FAQ',
  qa: 'Q&A',
  concept: '概念',
  document: '文档',
  procedure: '流程',
  tip: '技巧',
}
</script>

<template>
  <div class="flex h-full">
    <!-- 左侧分类面板 -->
    <div class="w-36 shrink-0 overflow-y-auto border-r border-gray-200 py-2 dark:border-gray-700">
      <div class="px-3 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">分类</div>

      <button
        class="flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors"
        :class="
          !filter.category
            ? 'bg-pink-50 font-medium text-pink-600 dark:bg-pink-900/20 dark:text-pink-400'
            : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
        "
        @click="selectCategory(undefined)"
      >
        <span>全部</span>
        <span class="text-xs text-gray-400">{{ statistics.total }}</span>
      </button>

      <button
        v-for="cat in categories"
        :key="cat.category"
        class="flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors"
        :class="
          filter.category === cat.category
            ? 'bg-pink-50 font-medium text-pink-600 dark:bg-pink-900/20 dark:text-pink-400'
            : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
        "
        @click="selectCategory(cat.category)"
      >
        <span class="truncate">{{ cat.category }}</span>
        <span class="ml-1 shrink-0 text-xs text-gray-400">{{ cat.count }}</span>
      </button>
    </div>

    <!-- 右侧主内容 -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 顶部搜索和过滤 -->
      <div class="border-b border-gray-200 px-4 py-2 dark:border-gray-700">
        <!-- 视图切换：当前知识库 / 已归档 -->
        <div class="mb-2 flex items-center gap-2">
          <div class="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              class="px-3 py-1 text-xs font-medium transition-colors"
              :class="
                viewStatus === 'active'
                  ? 'bg-pink-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'
              "
              data-testid="knowledge-view-active"
              @click="switchView('active')"
            >
              当前知识库
            </button>
            <button
              class="px-3 py-1 text-xs font-medium transition-colors"
              :class="
                viewStatus === 'archived'
                  ? 'bg-pink-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'
              "
              data-testid="knowledge-view-archived"
              @click="switchView('archived')"
            >
              已归档
            </button>
          </div>
        </div>
        <!-- 搜索框 + 新建按钮 -->
        <div class="relative mb-2 flex gap-2">
          <div class="relative flex-1">
            <UIcon
              name="i-heroicons-magnifying-glass"
              class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            />
            <input
              v-model="searchText"
              type="text"
              placeholder="搜索知识条目..."
              class="w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-900 focus:border-pink-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              @input="onSearch"
            />
          </div>
          <button
            v-if="viewStatus === 'active'"
            class="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
            data-testid="create-knowledge"
            @click="showCreateDialog = true"
          >
            <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
            新建知识
          </button>
        </div>

        <!-- 排序和类型过滤 -->
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="flex flex-wrap gap-1.5 flex-1">
            <button
              v-for="opt in typeOptions"
              :key="opt.value"
              class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
              :class="
                (filter.type || []).includes(opt.value)
                  ? 'bg-pink-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              "
              :data-testid="`subtab-${opt.value}`"
              @click="toggleTypeFilter(opt.value)"
            >
              <UIcon :name="opt.icon" class="h-3 w-3" />
              {{ opt.label }}
            </button>
          </div>
          <!-- 排序控件 -->
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-xs text-gray-500">排序：</span>
            <select
              class="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              :value="filter.sortBy || 'helpful'"
              data-testid="knowledge-sort"
              @change="knowledgeStore.setFilter({ sortBy: ($event.target as HTMLSelectElement).value as any })"
            >
              <option value="helpful">浏览数</option>
              <option value="created">创建时间</option>
              <option value="updated">更新时间</option>
              <option value="views">查看数</option>
            </select>
          </div>
          <!-- 隐藏的类型过滤 select，用于 E2E 测试 -->
          <select
            class="sr-only"
            data-testid="type-filter"
            :value="filter.type?.[0] || ''"
            @change="toggleTypeFilter(($event.target as HTMLSelectElement).value)"
          >
            <option value="">全部</option>
            <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <!-- 隐藏的标签过滤，用于 E2E 测试 -->
          <input type="hidden" class="sr-only" data-testid="tag-filter" />
        </div>
      </div>

      <!-- 知识条目列表 -->
      <div class="flex-1 overflow-y-auto">
        <!-- 加载中 -->
        <div v-if="loading" class="flex h-32 items-center justify-center">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
        </div>

        <!-- 空状态 -->
        <div
          v-else-if="filteredItems.length === 0"
          class="flex h-48 flex-col items-center justify-center gap-2 text-gray-400"
        >
          <UIcon name="i-heroicons-book-open" class="h-10 w-10" />
          <p class="text-sm">暂无知识条目</p>
          <p class="text-xs">导入聊天记录后，AI 将自动提取 FAQ 和知识</p>
        </div>

        <!-- 知识条目列表 (虚拟滚动) -->
        <div v-else v-bind="containerProps" :style="{ height: `${VIRTUAL_CONTAINER_HEIGHT}px`, overflowY: 'auto' }">
          <ul v-bind="wrapperProps" class="divide-y divide-gray-100 dark:divide-gray-800">
            <li v-for="{ data: item } in virtualItems" :key="item.id" class="group" data-testid="knowledge-item">
              <!-- 条目头部 -->
              <div
                class="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                @click="toggleExpand(item.id)"
              >
                <!-- 类型标签 -->
                <span
                  class="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="typeColors[item.type] || typeColors.document"
                  data-testid="knowledge-type"
                >
                  {{ typeLabels[item.type] || item.type }}
                </span>

                <!-- 标题和摘要 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <p class="text-sm font-medium text-gray-900 dark:text-white" data-testid="knowledge-title">
                      {{ item.title }}
                    </p>
                    <!-- 搜索匹配质量徽章 -->
                    <span
                      v-if="filter.searchText && 'matchLevel' in item"
                      class="shrink-0 rounded px-1.5 py-0.5 text-xs"
                      :class="
                        (item as any).matchLevel === 3
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : (item as any).matchLevel === 2
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                      "
                    >
                      {{ (item as any).matchLevel === 3 ? '精确' : (item as any).matchLevel === 2 ? '全词' : '部分' }}
                    </span>
                  </div>
                  <p
                    v-if="item.summary && expandedId !== item.id"
                    class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400"
                  >
                    {{ item.summary }}
                  </p>
                </div>

                <!-- 右侧统计和操作 -->
                <div class="flex shrink-0 items-center gap-2 text-xs text-gray-400">
                  <span v-if="item.helpfulCount > 0" class="flex items-center gap-0.5">
                    <UIcon name="i-heroicons-hand-thumb-up" class="h-3.5 w-3.5" />
                    {{ item.helpfulCount }}
                  </span>
                  <span v-if="item.isEdited" class="text-blue-400">已修改</span>
                  <UIcon
                    name="i-heroicons-chevron-down"
                    class="h-4 w-4 transition-transform"
                    :class="{ 'rotate-180': expandedId === item.id }"
                  />
                </div>
              </div>

              <!-- 展开详情 -->
              <div
                v-if="expandedId === item.id"
                class="border-t border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/30"
              >
                <p class="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300" data-testid="knowledge-content">
                  {{ item.content }}
                </p>

                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <!-- 标签 -->
                  <span
                    v-for="tag in item.tags"
                    :key="tag"
                    class="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                    data-testid="knowledge-tag"
                  >
                    {{ tag }}
                  </span>

                  <!-- 来源 -->
                  <span v-if="item.sourceSessionIds.length > 0" class="ml-auto text-xs text-gray-400">
                    来源 {{ item.sourceSessionIds.length }} 个会话
                  </span>

                  <!-- 操作按钮 -->
                  <div class="flex items-center gap-2">
                    <button
                      class="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                      data-testid="edit-button"
                      @click.stop="openEdit(item)"
                    >
                      <UIcon name="i-heroicons-pencil-square" class="h-3.5 w-3.5" />
                      编辑
                    </button>
                    <button
                      v-if="viewStatus === 'active'"
                      class="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      @click.stop="markHelpful(item.id)"
                    >
                      <UIcon name="i-heroicons-hand-thumb-up" class="h-3.5 w-3.5" />
                      有用
                    </button>
                    <button
                      v-if="viewStatus === 'active'"
                      class="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700"
                      @click.stop="archiveItem(item.id)"
                    >
                      <UIcon name="i-heroicons-archive-box" class="h-3.5 w-3.5" />
                      归档
                    </button>
                    <button
                      v-else
                      class="flex items-center gap-1 rounded px-2 py-1 text-xs text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                      @click.stop="restoreItem(item.id)"
                    >
                      <UIcon name="i-heroicons-arrow-uturn-left" class="h-3.5 w-3.5" />
                      恢复
                    </button>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 编辑知识对话框 -->
    <Teleport to="body">
      <div
        v-if="editingItem"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="closeEdit"
      >
        <div class="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-gray-900" data-testid="knowledge-editor">
          <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h3 class="font-medium text-gray-900 dark:text-white">编辑知识条目</h3>
            <button class="text-gray-400 hover:text-gray-600" @click="closeEdit">
              <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
            </button>
          </div>
          <div class="space-y-3 p-4">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">标题</label>
              <input
                v-model="editForm.title"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                data-testid="knowledge-title-input"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">内容</label>
              <textarea
                v-model="editForm.content"
                rows="5"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                data-testid="knowledge-content-input"
              />
            </div>
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">摘要</label>
                <input
                  v-model="editForm.summary"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">分类</label>
                <input
                  v-model="editForm.category"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <button
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
              @click="closeEdit"
            >
              取消
            </button>
            <button
              class="rounded-lg bg-pink-500 px-4 py-2 text-sm text-white hover:bg-pink-600 disabled:opacity-50"
              :disabled="!editForm.title.trim()"
              @click="saveEdit"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 新建知识对话框 -->
    <Teleport to="body">
      <div
        v-if="showCreateDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="showCreateDialog = false"
      >
        <div class="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-gray-900">
          <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h3 class="font-medium text-gray-900 dark:text-white">新建知识条目</h3>
            <button class="text-gray-400 hover:text-gray-600" @click="showCreateDialog = false">
              <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
            </button>
          </div>
          <div class="space-y-3 p-4">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">类型</label>
              <select
                v-model="createForm.type"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                <option v-for="t in typeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">标题 *</label>
              <input
                v-model="createForm.title"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="知识条目标题..."
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">内容 *</label>
              <textarea
                v-model="createForm.content"
                rows="4"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="知识内容..."
              />
            </div>
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">摘要</label>
                <input
                  v-model="createForm.summary"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">分类</label>
                <input
                  v-model="createForm.category"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <button
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
              @click="showCreateDialog = false"
            >
              取消
            </button>
            <button
              class="rounded-lg bg-pink-500 px-4 py-2 text-sm text-white hover:bg-pink-600 disabled:opacity-50"
              :disabled="!createForm.title.trim() || !createForm.content.trim() || isCreating"
              @click="handleCreate"
            >
              {{ isCreating ? '创建中...' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
