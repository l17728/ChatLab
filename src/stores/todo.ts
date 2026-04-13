/**
 * 待办管理 Pinia Store
 * 负责个人待办列表的前端状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PersonalTodo } from '@electron/main/services/todoService'

export interface TodoFilter {
  status?: string[]
  priority?: string[]
  isStarred?: boolean
  sourceType?: 'task' | 'manual'
  searchText?: string
  sortBy?: 'created' | 'due' | 'updated'
  sortOrder?: 'asc' | 'desc'
}

export const useTodoStore = defineStore('todo', () => {
  const todos = ref<PersonalTodo[]>([])
  const loading = ref(false)
  const filter = ref<TodoFilter>({
    status: ['pending', 'in_progress'],
    sortBy: 'due',
    sortOrder: 'asc',
  })

  // 统计信息
  const statistics = computed(() => {
    const stats = {
      total: todos.value.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      starred: 0,
      overdue: 0,
    }

    const now = Date.now()
    todos.value.forEach((todo) => {
      if (todo.status === 'pending') stats.pending++
      else if (todo.status === 'in_progress') stats.inProgress++
      else if (todo.status === 'completed') stats.completed++
      if (todo.isStarred) stats.starred++
      if (todo.dueTs && todo.dueTs < now && todo.status !== 'completed' && todo.status !== 'cancelled') {
        stats.overdue++
      }
    })

    return stats
  })

  // 过滤后的待办
  const filteredTodos = computed(() => {
    let result = [...todos.value]

    if (filter.value.status && filter.value.status.length > 0) {
      result = result.filter((todo) => filter.value.status!.includes(todo.status))
    }

    if (filter.value.priority && filter.value.priority.length > 0) {
      result = result.filter((todo) => filter.value.priority!.includes(todo.priority))
    }

    if (filter.value.isStarred) {
      result = result.filter((todo) => todo.isStarred)
    }

    if (filter.value.sourceType) {
      result = result.filter((todo) => todo.sourceType === filter.value.sourceType)
    }

    if (filter.value.searchText) {
      const text = filter.value.searchText.toLowerCase()
      result = result.filter(
        (todo) =>
          todo.title.toLowerCase().includes(text) ||
          todo.description?.toLowerCase().includes(text) ||
          todo.notes?.toLowerCase().includes(text)
      )
    }

    const sortBy = filter.value.sortBy || 'created'
    const sortOrder = filter.value.sortOrder || 'asc'

    result.sort((a, b) => {
      let aVal: number
      let bVal: number

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

      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })

    return result
  })

  function setFilter(newFilter: Partial<TodoFilter>) {
    filter.value = { ...filter.value, ...newFilter }
  }

  function setTodos(newTodos: PersonalTodo[]) {
    todos.value = newTodos
  }

  function updateTodoLocal(todoId: number, updates: Partial<PersonalTodo>) {
    const idx = todos.value.findIndex((t) => t.id === todoId)
    if (idx !== -1) {
      todos.value[idx] = { ...todos.value[idx], ...updates, updatedTs: Date.now() }
    }
  }

  function removeTodoLocal(todoId: number) {
    const idx = todos.value.findIndex((t) => t.id === todoId)
    if (idx !== -1) {
      todos.value.splice(idx, 1)
    }
  }

  /**
   * 加载所有待办（跨会话）
   */
  async function loadAll(globalUserId?: string) {
    loading.value = true
    try {
      const result = await window.collabApi?.getTodos(globalUserId ? { globalUserId } : undefined)
      if (result?.success && result.data) {
        todos.value = result.data
      }
    } catch (error) {
      console.error('[TodoStore] loadAll failed:', error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 标记待办完成
   */
  async function completeTodo(todoId: number): Promise<boolean> {
    const result = await window.collabApi?.updateTodo(todoId, { status: 'completed' })
    if (result?.success) {
      updateTodoLocal(todoId, { status: 'completed' })
    }
    return Boolean(result?.success)
  }

  /**
   * 切换星标
   */
  async function toggleStar(todoId: number): Promise<boolean> {
    const todo = todos.value.find((t) => t.id === todoId)
    if (!todo) return false
    const newStarred = !todo.isStarred
    const result = await window.collabApi?.updateTodo(todoId, { isStarred: newStarred })
    if (result?.success) {
      updateTodoLocal(todoId, { isStarred: newStarred })
    }
    return Boolean(result?.success)
  }

  /**
   * 删除待办
   */
  async function deleteTodo(todoId: number): Promise<boolean> {
    const result = await window.collabApi?.deleteTodo(todoId)
    if (result?.success) {
      removeTodoLocal(todoId)
    }
    return Boolean(result?.success)
  }

  /**
   * 创建手动待办
   */
  async function createManualTodo(
    title: string,
    options: {
      globalUserId: string
      description?: string
      priority?: PersonalTodo['priority']
      dueTs?: number
    }
  ): Promise<number | null> {
    const result = await window.collabApi?.createTodo({
      globalUserId: options.globalUserId,
      title,
      description: options.description,
      status: 'pending',
      priority: options.priority || 'normal',
      dueTs: options.dueTs,
      tags: [],
      isStarred: false,
      sourceType: 'manual',
    })
    if (result?.success && result.data !== undefined) {
      await loadAll(options.globalUserId)
      return result.data
    }
    return null
  }

  /**
   * 从任务同步待办（调用 IPC collab:syncTodoFromTask）
   */
  async function syncFromTask(globalUserId: string, taskId: number): Promise<number | null> {
    const result = await window.collabApi?.syncTodoFromTask(globalUserId, taskId)
    if (result?.success && result.data !== undefined) {
      await loadAll(globalUserId)
      return result.data
    }
    return null
  }

  return {
    todos,
    filteredTodos,
    loading,
    filter,
    statistics,
    setFilter,
    setTodos,
    updateTodoLocal,
    updateTodoField: updateTodoLocal,
    removeTodoLocal,
    loadAll,
    completeTodo,
    toggleStar,
    deleteTodo,
    createManualTodo,
    syncFromTask,
  }
})
