/**
 * 关注点 Pinia Store
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FocusItem } from '@electron/main/services/focusService'

export const useFocusStore = defineStore('focus', () => {
  const items = ref<FocusItem[]>([])
  const loading = ref(false)
  const selectedType = ref<string | null>(null)
  // 视图状态：'active' 显示当前关注点；'archived' 显示已归档历史
  const viewStatus = ref<'active' | 'archived'>('active')

  const filteredItems = computed(() => {
    if (!selectedType.value) return items.value
    return items.value.filter((i) => i.type === selectedType.value)
  })

  const statistics = computed(() => ({
    total: items.value.length,
    active: items.value.filter((i) => i.status === 'active').length,
  }))

  function setTypeFilter(type: string | null) {
    selectedType.value = type
  }

  async function loadItems(globalUserId?: string) {
    loading.value = true
    try {
      const opts: Record<string, unknown> = { status: viewStatus.value }
      if (globalUserId) opts.globalUserId = globalUserId
      const result = await window.collabApi?.getFocusItems(opts as any)
      if (result?.success && result.data) {
        items.value = result.data
      }
    } catch (error) {
      console.error('[FocusStore] loadItems failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function setViewStatus(status: 'active' | 'archived') {
    if (viewStatus.value === status) return
    viewStatus.value = status
    await loadItems()
  }

  // 恢复已归档条目：把 status 改回 'active'，从当前(已归档)列表中移除
  async function restoreItem(itemId: number): Promise<boolean> {
    const result = await window.collabApi?.updateFocusItem(itemId, { status: 'active' })
    if (result?.success) {
      const idx = items.value.findIndex((i) => i.id === itemId)
      if (idx !== -1) items.value.splice(idx, 1)
    }
    return Boolean(result?.success)
  }

  async function createItem(
    item: Omit<FocusItem, 'id' | 'createdTs' | 'updatedTs' | 'mentionCount' | 'relatedSessionCount'>
  ): Promise<number | null> {
    const result = await window.collabApi?.createFocusItem(item)
    if (result?.success && result.data !== undefined) {
      await loadItems(item.globalUserId)
      return result.data
    }
    return null
  }

  async function archiveItem(itemId: number): Promise<boolean> {
    const result = await window.collabApi?.archiveFocusItem(itemId)
    if (result?.success) {
      const idx = items.value.findIndex((i) => i.id === itemId)
      if (idx !== -1) items.value.splice(idx, 1)
    }
    return Boolean(result?.success)
  }

  return {
    items,
    filteredItems,
    loading,
    selectedType,
    viewStatus,
    statistics,
    setTypeFilter,
    setViewStatus,
    loadItems,
    createItem,
    archiveItem,
    restoreItem,
  }
})
