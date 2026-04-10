/**
 * 关注点 Pinia Store
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FocusItem } from '@/electron/main/services/focusService'

export const useFocusStore = defineStore('focus', () => {
  const items = ref<FocusItem[]>([])
  const loading = ref(false)
  const selectedType = ref<string | null>(null)

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
      const result = await window.collabApi?.getFocusItems(globalUserId ? { globalUserId } : undefined)
      if (result?.success && result.data) {
        items.value = result.data
      }
    } catch (error) {
      console.error('[FocusStore] loadItems failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function createItem(item: Omit<FocusItem, 'id' | 'createdTs' | 'updatedTs' | 'mentionCount' | 'relatedSessionCount'>): Promise<number | null> {
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
    statistics,
    setTypeFilter,
    loadItems,
    createItem,
    archiveItem,
  }
})
