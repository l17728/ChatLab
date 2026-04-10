/**
 * 知识图谱 Pinia Store
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GraphNode, GraphEdge } from '@/electron/main/services/graphService'

export const useGraphStore = defineStore('graph', () => {
  const nodes = ref<GraphNode[]>([])
  const edges = ref<GraphEdge[]>([])
  const loading = ref(false)
  const stats = ref<{ nodeCount: number; edgeCount: number; nodeTypes: Array<{ type: string; count: number }> } | null>(null)

  // 选中的节点类型过滤
  const selectedTypes = ref<string[]>([])

  // 时间范围过滤
  const timeRange = ref<{ from?: number; to?: number }>({})

  const filteredNodes = computed(() => {
    let result = nodes.value
    if (selectedTypes.value.length > 0) {
      result = result.filter((n) => selectedTypes.value.includes(n.type))
    }
    const { from, to } = timeRange.value
    if (from !== undefined) {
      result = result.filter((n) => (n.lastSeenTs ?? n.firstSeenTs ?? 0) >= from!)
    }
    if (to !== undefined) {
      result = result.filter((n) => (n.firstSeenTs ?? n.lastSeenTs ?? Infinity) <= to!)
    }
    return result
  })

  const filteredNodeIds = computed(() => filteredNodes.value.map((n) => n.id))

  const filteredEdges = computed(() =>
    edges.value.filter(
      (e) =>
        filteredNodeIds.value.includes(e.sourceNodeId) &&
        filteredNodeIds.value.includes(e.targetNodeId)
    )
  )

  async function loadGraph(options?: { types?: string[]; fromTs?: number; toTs?: number }) {
    loading.value = true
    try {
      const nodesResult = await window.collabApi?.getGraphNodes({
        ...options,
        limit: 300,
      })
      if (nodesResult?.success && nodesResult.data) {
        nodes.value = nodesResult.data
        const nodeIds = nodesResult.data.map((n) => n.id)
        const edgesResult = await window.collabApi?.getGraphEdges(nodeIds)
        if (edgesResult?.success && edgesResult.data) {
          edges.value = edgesResult.data
        }
      }
    } catch (error) {
      console.error('[GraphStore] loadGraph failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function loadStats() {
    try {
      const result = await window.collabApi?.getGraphStats()
      if (result?.success && result.data) {
        stats.value = result.data
      }
    } catch (error) {
      console.error('[GraphStore] loadStats failed:', error)
    }
  }

  function setTypeFilter(types: string[]) {
    selectedTypes.value = types
  }

  function setTimeRange(from?: number, to?: number) {
    timeRange.value = { from, to }
  }

  function addNodes(newNodes: GraphNode[]) {
    const existingIds = new Set(nodes.value.map((n) => n.id))
    for (const node of newNodes) {
      if (!existingIds.has(node.id)) {
        nodes.value.push(node)
        existingIds.add(node.id)
      }
    }
  }

  return {
    nodes,
    edges,
    loading,
    stats,
    selectedTypes,
    timeRange,
    filteredNodes,
    filteredEdges,
    filteredNodeIds,
    loadGraph,
    loadStats,
    setTypeFilter,
    setTimeRange,
    addNodes,
  }
})
