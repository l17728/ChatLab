/**
 * 任务管理 Pinia Store
 * 负责任务列表的前端状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GlobalTask } from '@electron/main/services/taskService'

export interface TaskFilter {
  source?: string // 会话ID或 'all'
  status?: string[] // 筛选的状态
  priority?: string[] // 筛选的优先级
  sortBy?: 'created' | 'due' | 'updated'
  sortOrder?: 'asc' | 'desc'
  searchText?: string
}

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<GlobalTask[]>([])
  const loading = ref(false)
  const filter = ref<TaskFilter>({
    status: ['pending', 'in_progress'],
    sortBy: 'due',
    sortOrder: 'asc',
  })

  // 统计信息
  const statistics = computed(() => {
    const stats = {
      total: tasks.value.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      overdue: 0,
    }

    const now = Date.now()
    tasks.value.forEach((task) => {
      stats[task.status as keyof typeof stats] = (stats[task.status as keyof typeof stats] as number) + 1
      if (task.dueTs && task.dueTs < now && task.status !== 'completed' && task.status !== 'cancelled') {
        stats.overdue++
      }
    })

    return stats
  })

  // 过滤后的任务
  const filteredTasks = computed(() => {
    let result = [...tasks.value]

    // 状态过滤
    if (filter.value.status && filter.value.status.length > 0) {
      result = result.filter((task) => filter.value.status!.includes(task.status))
    }

    // 优先级过滤
    if (filter.value.priority && filter.value.priority.length > 0) {
      result = result.filter((task) => filter.value.priority!.includes(task.priority))
    }

    // 搜索文本
    if (filter.value.searchText) {
      const text = filter.value.searchText.toLowerCase()
      result = result.filter(
        (task) =>
          task.title.toLowerCase().includes(text) ||
          task.description?.toLowerCase().includes(text) ||
          task.ownerDisplayName?.toLowerCase().includes(text)
      )
    }

    // 排序
    const sortBy = filter.value.sortBy || 'created'
    const sortOrder = filter.value.sortOrder || 'asc'

    result.sort((a, b) => {
      let aVal: number | string | undefined
      let bVal: number | string | undefined

      switch (sortBy) {
        case 'due':
          aVal = a.dueTs || Number.MAX_SAFE_INTEGER
          bVal = b.dueTs || Number.MAX_SAFE_INTEGER
          break
        case 'updated':
          aVal = a.updatedTs
          bVal = b.updatedTs
          break
        case 'created':
        default:
          aVal = a.createdTs
          bVal = b.createdTs
      }

      const comparison = (aVal as number) - (bVal as number)
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return result
  })

  /**
   * 设置过滤条件
   */
  function setFilter(newFilter: Partial<TaskFilter>) {
    filter.value = { ...filter.value, ...newFilter }
  }

  /**
   * 添加任务到列表
   */
  function addTask(task: GlobalTask) {
    tasks.value.push(task)
  }

  /**
   * 更新任务
   */
  function updateTask(taskId: number, updates: Partial<GlobalTask>) {
    const index = tasks.value.findIndex((t) => t.id === taskId)
    if (index !== -1) {
      tasks.value[index] = { ...tasks.value[index], ...updates, updatedTs: Date.now() }
    }
  }

  /**
   * 删除任务
   */
  function removeTask(taskId: number) {
    const index = tasks.value.findIndex((t) => t.id === taskId)
    if (index !== -1) {
      tasks.value.splice(index, 1)
    }
  }

  /**
   * 批量加载任务
   */
  function setTasks(newTasks: GlobalTask[]) {
    tasks.value = newTasks
  }

  /**
   * 标记加载状态
   */
  function setLoading(value: boolean) {
    loading.value = value
  }

  /**
   * 从主进程加载会话任务（通过 IPC）
   */
  async function loadBySession(sessionId: string) {
    loading.value = true
    try {
      const result = await window.collabApi?.getTasksBySession(sessionId)
      if (result?.success && result.data) {
        tasks.value = result.data
      }
    } catch (error) {
      console.error('[TaskStore] loadBySession failed:', error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 从主进程加载所有任务（带过滤）
   */
  async function loadAll(options?: { status?: string[]; sessionId?: string }) {
    loading.value = true
    try {
      const result = await window.collabApi?.getTasks(options)
      if (result?.success && result.data) {
        tasks.value = result.data
      }
    } catch (error) {
      console.error('[TaskStore] loadAll failed:', error)
    } finally {
      loading.value = false
    }
  }

  return {
    tasks,
    filteredTasks,
    loading,
    filter,
    statistics,
    setFilter,
    addTask,
    updateTask,
    removeTask,
    setTasks,
    setLoading,
    loadBySession,
    loadAll,
  }
})
