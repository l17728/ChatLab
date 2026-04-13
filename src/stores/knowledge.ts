/**
 * 知识库 Pinia Store
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { KnowledgeItem } from '@electron/main/services/knowledgeService'

export interface KnowledgeFilter {
  type?: string[]
  category?: string
  searchText?: string
  sortBy?: 'created' | 'updated' | 'helpful' | 'views'
  sortOrder?: 'asc' | 'desc'
}

export const useKnowledgeStore = defineStore('knowledge', () => {
  const items = ref<KnowledgeItem[]>([])
  const categories = ref<Array<{ category: string; count: number }>>([])
  const loading = ref(false)
  // 视图状态：'active' = 当前知识库；'archived' = 已归档
  const viewStatus = ref<'active' | 'archived'>('active')
  const filter = ref<KnowledgeFilter>({
    sortBy: 'helpful',
    sortOrder: 'desc',
  })

  /**
   * 多层渐进式搜索
   * Layer 1 (exact=3): 标题完全包含搜索词
   * Layer 2 (word=2):  所有关键词均出现在 title+content 中
   * Layer 3 (partial=1): 至少一个关键词出现
   * 返回带 matchLevel 分数的列表，按分数降序
   */
  function multiLayerSearch(list: KnowledgeItem[], raw: string): Array<KnowledgeItem & { matchLevel: number }> {
    const text = raw.trim().toLowerCase()
    if (!text) return list.map((i) => ({ ...i, matchLevel: 3 }))
    const words = text.split(/\s+/).filter(Boolean)

    const scored: Array<KnowledgeItem & { matchLevel: number }> = []
    for (const item of list) {
      const haystack = `${item.title} ${item.content} ${item.summary ?? ''}`.toLowerCase()
      const titleLow = item.title.toLowerCase()

      let level = 0
      // Layer 1: exact phrase in title
      if (titleLow.includes(text)) {
        level = 3
      } else if (words.every((w) => haystack.includes(w))) {
        // Layer 2: all words appear somewhere
        level = 2
      } else if (words.some((w) => haystack.includes(w))) {
        // Layer 3: at least one word appears
        level = 1
      }

      if (level > 0) scored.push({ ...item, matchLevel: level })
    }

    return scored.sort((a, b) => b.matchLevel - a.matchLevel)
  }

  const filteredItems = computed(() => {
    let result = [...items.value]

    if (filter.value.type && filter.value.type.length > 0) {
      result = result.filter((item) => filter.value.type!.includes(item.type))
    }

    if (filter.value.category) {
      result = result.filter((item) => item.category === filter.value.category)
    }

    if (filter.value.searchText) {
      result = multiLayerSearch(result, filter.value.searchText)
    } else {
      result = result.map((i) => ({ ...i, matchLevel: 3 as number }))
    }

    // Apply sorting
    const sortByField = filter.value.sortBy || 'helpful'
    const dir = filter.value.sortOrder === 'asc' ? 1 : -1
    result.sort((a, b) => {
      if (sortByField === 'helpful') return (b.helpfulCount - a.helpfulCount) * dir
      if (sortByField === 'views') return ((b.viewCount ?? 0) - (a.viewCount ?? 0)) * dir
      if (sortByField === 'created') return (b.createdTs - a.createdTs) * dir
      if (sortByField === 'updated') return (b.updatedTs - a.updatedTs) * dir
      return 0
    })

    return result
  })

  const statistics = computed(() => ({
    total: items.value.length,
    faq: items.value.filter((i) => i.type === 'faq').length,
    document: items.value.filter((i) => i.type === 'document').length,
    concept: items.value.filter((i) => i.type === 'concept').length,
  }))

  function setFilter(newFilter: Partial<KnowledgeFilter>) {
    filter.value = { ...filter.value, ...newFilter }
  }

  async function loadItems(options?: { type?: string[]; category?: string }) {
    loading.value = true
    try {
      const mergedOptions = { ...(options || {}), status: viewStatus.value }
      const result = await window.collabApi?.getKnowledgeItems(mergedOptions as any)
      if (result?.success && result.data) {
        items.value = result.data
      }
    } catch (error) {
      console.error('[KnowledgeStore] loadItems failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function setViewStatus(status: 'active' | 'archived') {
    if (viewStatus.value === status) return
    viewStatus.value = status
    await loadItems()
  }

  // 恢复已归档知识条目：改回 active 并从当前(已归档)列表中移除
  async function restoreItem(itemId: number): Promise<boolean> {
    const result = await window.collabApi?.updateKnowledgeItem(itemId, { status: 'active' })
    if (result?.success) {
      const idx = items.value.findIndex((i) => i.id === itemId)
      if (idx !== -1) items.value.splice(idx, 1)
    }
    return Boolean(result?.success)
  }

  async function loadCategories() {
    try {
      const result = await window.collabApi?.getKnowledgeCategories()
      if (result?.success && result.data) {
        categories.value = result.data
      }
    } catch (error) {
      console.error('[KnowledgeStore] loadCategories failed:', error)
    }
  }

  async function markHelpful(itemId: number): Promise<void> {
    await window.collabApi?.markKnowledgeHelpful(itemId)
    const idx = items.value.findIndex((i) => i.id === itemId)
    if (idx !== -1) {
      items.value[idx] = { ...items.value[idx], helpfulCount: items.value[idx].helpfulCount + 1 }
    }
  }

  async function archiveItem(itemId: number): Promise<boolean> {
    const result = await window.collabApi?.archiveKnowledgeItem(itemId)
    if (result?.success) {
      const idx = items.value.findIndex((i) => i.id === itemId)
      if (idx !== -1) items.value.splice(idx, 1)
    }
    return Boolean(result?.success)
  }

  async function updateItem(itemId: number, updates: Partial<KnowledgeItem>): Promise<boolean> {
    const result = await window.collabApi?.updateKnowledgeItem(itemId, updates)
    if (result?.success) {
      const idx = items.value.findIndex((i) => i.id === itemId)
      if (idx !== -1) {
        items.value[idx] = { ...items.value[idx], ...updates, updatedTs: Date.now() }
      }
    }
    return Boolean(result?.success)
  }

  return {
    items,
    filteredItems,
    categories,
    loading,
    filter,
    viewStatus,
    statistics,
    setFilter,
    setViewStatus,
    loadItems,
    loadCategories,
    markHelpful,
    archiveItem,
    restoreItem,
    updateItem,
  }
})
