<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useGraphStore } from '@/stores/graph'
import { isBrowserEnvironment } from '@/composables/useEnvironment'

const graphStore = useGraphStore()
const { filteredNodes, filteredEdges, loading, stats, selectedTypes, timeRange } = storeToRefs(graphStore)

const graphContainer = ref<HTMLElement | null>(null)
const cytoscapeInstance = shallowRef<any>(null)
const cytoscapeAvailable = ref(false)
const selectedNode = ref<any>(null)
const isFullscreen = ref(false)
const pinnedNodeIds = ref<Set<string>>(new Set())

// Hover tooltip state
const hoverTip = ref<{ visible: boolean; x: number; y: number; data: any }>({
  visible: false,
  x: 0,
  y: 0,
  data: null,
})

function formatTs(ts?: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Dual-handle time range slider
const allNodes = computed(() => graphStore.nodes)

const timeMin = computed(() => {
  const ts = allNodes.value.map((n) => n.firstSeenTs ?? n.lastSeenTs ?? 0).filter(Boolean)
  return ts.length > 0 ? Math.min(...ts) : Date.now() - 365 * 24 * 3600 * 1000
})

const timeMax = computed(() => {
  const ts = allNodes.value.map((n) => n.lastSeenTs ?? n.firstSeenTs ?? 0).filter(Boolean)
  return ts.length > 0 ? Math.max(...ts) : Date.now()
})

// Slider values as timestamps (0 = use min/max)
const sliderFrom = ref(0)
const sliderTo = ref(0)

function formatSliderDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function onSliderFromChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (v >= sliderTo.value && sliderTo.value !== 0) {
    sliderFrom.value = sliderTo.value - 1
  } else {
    sliderFrom.value = v
  }
  applyTimeRange()
}

function onSliderToChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (v <= sliderFrom.value && sliderFrom.value !== 0) {
    sliderTo.value = sliderFrom.value + 1
  } else {
    sliderTo.value = v
  }
  applyTimeRange()
}

function applyTimeRange() {
  const from = sliderFrom.value > 0 && sliderFrom.value > timeMin.value ? sliderFrom.value : undefined
  const to = sliderTo.value > 0 && sliderTo.value < timeMax.value ? sliderTo.value : undefined
  graphStore.setTimeRange(from, to)
}

function clearTimeRange() {
  sliderFrom.value = 0
  sliderTo.value = 0
  graphStore.setTimeRange(undefined, undefined)
}

// Export functions
function exportJSON() {
  const data = {
    nodes: filteredNodes.value.map((n) => ({
      id: n.id,
      name: n.name,
      displayName: n.displayName,
      type: n.type,
      occurrenceCount: n.occurrenceCount,
      confidence: n.confidence,
      firstSeenTs: n.firstSeenTs,
      lastSeenTs: n.lastSeenTs,
    })),
    edges: filteredEdges.value.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      type: e.type,
      occurrenceCount: e.occurrenceCount,
      confidence: e.confidence,
    })),
    exportedAt: Date.now(),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `knowledge-graph-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function exportGraphML() {
  const nodeIdMap = new Map(filteredNodes.value.map((n) => [n.id, `n${n.id}`]))
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/graphml">',
    '  <key id="name" for="node" attr.name="name" attr.type="string"/>',
    '  <key id="type" for="node" attr.name="type" attr.type="string"/>',
    '  <key id="confidence" for="node" attr.name="confidence" attr.type="double"/>',
    '  <key id="relType" for="edge" attr.name="type" attr.type="string"/>',
    '  <graph id="G" edgedefault="directed">',
  ]
  for (const n of filteredNodes.value) {
    lines.push(`    <node id="${nodeIdMap.get(n.id)}">`)
    lines.push(
      `      <data key="name">${(n.displayName || n.name).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</data>`
    )
    lines.push(`      <data key="type">${n.type}</data>`)
    lines.push(`      <data key="confidence">${n.confidence}</data>`)
    lines.push('    </node>')
  }
  for (const e of filteredEdges.value) {
    const src = nodeIdMap.get(e.sourceNodeId)
    const tgt = nodeIdMap.get(e.targetNodeId)
    if (src && tgt) {
      lines.push(`    <edge source="${src}" target="${tgt}">`)
      lines.push(`      <data key="relType">${e.type.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</data>`)
      lines.push('    </edge>')
    }
  }
  lines.push('  </graph>', '</graphml>')
  const blob = new Blob([lines.join('\n')], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `knowledge-graph-${new Date().toISOString().slice(0, 10)}.graphml`
  a.click()
  URL.revokeObjectURL(url)
}

// Node type color map
const typeColorMap: Record<string, string> = {
  Person: '#6366f1',
  Task: '#f59e0b',
  Event: '#10b981',
  Time: '#3b82f6',
  Location: '#8b5cf6',
  Artifact: '#ec4899',
}

function getNodeColor(type: string): string {
  return typeColorMap[type] || '#64748b'
}

async function initCytoscape() {
  if (!graphContainer.value) return

  try {
    // Dynamic import of cytoscape
    const cytoscapeModule = await import('cytoscape').catch(() => null)
    if (!cytoscapeModule) {
      cytoscapeAvailable.value = false
      return
    }
    const cytoscape = cytoscapeModule.default

    // Try to load fcose layout (optional)
    try {
      const fcose = await import('cytoscape-fcose')
      cytoscape.use(fcose.default)
    } catch {
      // fcose not available, use cose layout
    }

    cytoscapeAvailable.value = true

    const elements = buildCytoscapeElements()

    cytoscapeInstance.value = cytoscape({
      container: graphContainer.value,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'font-size': '7px',
            'font-weight': 500,
            color: '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'ellipsis',
            'text-max-width': 'data(size)',
            'text-outline-width': 1,
            'text-outline-color': 'data(color)',
            width: 'data(size)',
            height: 'data(size)',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#94a3b8',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': '6px',
            color: '#64748b',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#f43f5e',
          },
        },
      ],
      layout: {
        name: 'fcose' in cytoscape ? 'fcose' : 'cose',
        animate: true,
        animationDuration: 500,
      } as any,
    })

    cytoscapeInstance.value.on('tap', 'node', (evt: any) => {
      selectedNode.value = evt.target.data()
    })

    cytoscapeInstance.value.on('tap', (evt: any) => {
      if (evt.target === cytoscapeInstance.value) {
        selectedNode.value = null
      }
    })

    cytoscapeInstance.value.on('mouseover', 'node', (evt: any) => {
      const pos = evt.renderedPosition || evt.target.renderedPosition()
      hoverTip.value = {
        visible: true,
        x: pos.x,
        y: pos.y,
        data: evt.target.data(),
      }
    })

    cytoscapeInstance.value.on('mousemove', 'node', (evt: any) => {
      if (!hoverTip.value.visible) return
      const pos = evt.renderedPosition || evt.target.renderedPosition()
      hoverTip.value.x = pos.x
      hoverTip.value.y = pos.y
    })

    cytoscapeInstance.value.on('mouseout', 'node', () => {
      hoverTip.value.visible = false
    })
  } catch (error) {
    console.warn('[GraphTab] Cytoscape init failed:', error)
    cytoscapeAvailable.value = false
  }
}

function buildCytoscapeElements() {
  const nodeElements = filteredNodes.value.map((n) => ({
    data: {
      id: `n${n.id}`,
      label: n.displayName || n.name,
      type: n.type,
      color: n.color || getNodeColor(n.type),
      size: Math.min(60, Math.max(25, 15 + n.occurrenceCount * 3)),
      occurrenceCount: n.occurrenceCount,
      confidence: n.confidence,
      firstSeenTs: n.firstSeenTs,
      lastSeenTs: n.lastSeenTs,
    },
  }))

  const edgeElements = filteredEdges.value.map((e) => ({
    data: {
      id: `e${e.id}`,
      source: `n${e.sourceNodeId}`,
      target: `n${e.targetNodeId}`,
      label: e.type,
      occurrenceCount: e.occurrenceCount,
    },
  }))

  return [...nodeElements, ...edgeElements]
}

function updateGraph() {
  if (!cytoscapeInstance.value) return
  const elements = buildCytoscapeElements()
  cytoscapeInstance.value.elements().remove()
  cytoscapeInstance.value.add(elements)
  cytoscapeInstance.value.layout({ name: 'cose', animate: true }).run()
}

function fitGraph() {
  cytoscapeInstance.value?.fit()
}

function resetZoom() {
  cytoscapeInstance.value?.reset()
}

function toggleFullscreen() {
  const el = graphContainer.value?.closest('.flex.h-full') as HTMLElement | null
  if (!el) return
  if (!document.fullscreenElement) {
    el.requestFullscreen()
      .then(() => {
        isFullscreen.value = true
      })
      .catch(() => {})
  } else {
    document
      .exitFullscreen()
      .then(() => {
        isFullscreen.value = false
      })
      .catch(() => {})
  }
}

function togglePinNode() {
  if (!selectedNode.value || !cytoscapeInstance.value) return
  const nodeId = selectedNode.value.id as string
  const cyNode = cytoscapeInstance.value.$(`#${nodeId}`)
  if (!cyNode.length) return
  if (pinnedNodeIds.value.has(nodeId)) {
    pinnedNodeIds.value.delete(nodeId)
    cyNode.unlock()
  } else {
    pinnedNodeIds.value.add(nodeId)
    cyNode.lock()
  }
}

async function expandNeighbors() {
  if (!selectedNode.value || !cytoscapeInstance.value) return
  const nodeId = selectedNode.value.id as string
  const cyNode = cytoscapeInstance.value.$(`#${nodeId}`)
  if (!cyNode.length) return

  // Flash already-rendered 1-hop neighbors
  cyNode.neighborhood('node').flashClass('neighbor-flash', 800)

  // Fetch edges from DB for this node, load any unrendered neighbor nodes
  // 注意：nodeId 是 Cytoscape 中的格式 "n123"，需要移除前缀提取数字 ID
  const numericId = Number(nodeId.replace(/^n/, ''))
  if (!isNaN(numericId) && !isBrowserEnvironment()) {
    const edgesResult = await window.collabApi?.getGraphEdges([numericId])
    if (edgesResult?.success && edgesResult.data) {
      const neighborIds = edgesResult.data
        .flatMap((e) => [e.sourceNodeId, e.targetNodeId])
        .filter((id) => id !== numericId)
      const alreadyLoaded = new Set(graphStore.nodes.map((n) => n.id))
      const missing = neighborIds.filter((id) => !alreadyLoaded.has(id))
      if (missing.length > 0) {
        const nodesResult = await window.collabApi?.getGraphNodes()
        if (nodesResult?.success && nodesResult.data) {
          const newNodes = nodesResult.data.filter((n) => missing.includes(n.id))
          if (newNodes.length > 0) {
            graphStore.addNodes(newNodes)
          }
        }
      }
    }
  }

  cytoscapeInstance.value.layout({ name: 'cose', animate: true, animationDuration: 400 }).run()
  console.log('[GraphTab] Expanded neighbors of', nodeId)
}

const isRebuilding = ref(false)
async function rebuildGraph() {
  if (isBrowserEnvironment() || isRebuilding.value) return
  isRebuilding.value = true
  try {
    // graph is global, sessionId not needed
    const result = await window.collabApi?.createExtractionJob('__global__', 'graph', true)
    if (!result?.success) {
      // fallback: reload from DB
      await graphStore.loadGraph()
    }
  } finally {
    isRebuilding.value = false
  }
}

const nodeTypeOptions = computed(() => {
  if (!stats.value) return []
  return stats.value.nodeTypes.map((t) => ({ label: t.type, value: t.type, count: t.count }))
})

function toggleTypeFilter(type: string) {
  const current = [...selectedTypes.value]
  const idx = current.indexOf(type)
  if (idx !== -1) {
    current.splice(idx, 1)
  } else {
    current.push(type)
  }
  graphStore.setTypeFilter(current)
}

const fullscreenHandler = () => {
  isFullscreen.value = !!document.fullscreenElement
}

onMounted(async () => {
  if (isBrowserEnvironment()) return
  document.addEventListener('fullscreenchange', fullscreenHandler)
  await Promise.all([graphStore.loadStats(), graphStore.loadGraph()])
  await initCytoscape()
})

onUnmounted(() => {
  cytoscapeInstance.value?.destroy()
  document.removeEventListener('fullscreenchange', fullscreenHandler)
})

watch([filteredNodes, filteredEdges], () => {
  if (cytoscapeInstance.value) {
    updateGraph()
  }
})
</script>

<template>
  <div class="flex h-full">
    <!-- 左侧控制面板 -->
    <div class="w-44 shrink-0 overflow-y-auto border-r border-gray-200 py-2 dark:border-gray-700">
      <!-- 统计 -->
      <div class="px-3 py-2">
        <div class="text-xs font-medium text-gray-500 dark:text-gray-400">图谱概览</div>
        <div v-if="stats" class="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400" data-testid="graph-stats">
          <div>节点 {{ stats.nodeCount }}</div>
          <div>边 {{ stats.edgeCount }}</div>
        </div>
        <!-- 重新构建按钮 -->
        <button
          class="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
          :disabled="isRebuilding || loading"
          data-testid="graph-rebuild"
          @click="rebuildGraph"
        >
          <UIcon name="i-heroicons-arrow-path" class="h-3.5 w-3.5" :class="{ 'animate-spin': isRebuilding }" />
          {{ isRebuilding ? '重建中...' : '重新构建' }}
        </button>
      </div>

      <div class="mx-3 my-2 border-t border-gray-200 dark:border-gray-700" />

      <!-- 类型过滤 -->
      <div class="px-3 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">节点类型</div>
      <div class="mt-1 space-y-0.5">
        <button
          v-for="opt in nodeTypeOptions"
          :key="opt.value"
          class="flex w-full items-center justify-between px-3 py-1 text-xs transition-colors"
          :class="
            selectedTypes.length === 0 || selectedTypes.includes(opt.value)
              ? 'text-gray-700 dark:text-gray-300'
              : 'text-gray-400 dark:text-gray-600'
          "
          :data-testid="`type-filter-${opt.value.toLowerCase()}`"
          @click="toggleTypeFilter(opt.value)"
        >
          <div class="flex items-center gap-2">
            <div class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: getNodeColor(opt.value) }" />
            <span>{{ opt.label }}</span>
          </div>
          <span class="text-gray-400">{{ opt.count }}</span>
        </button>
      </div>

      <div class="mx-3 my-2 border-t border-gray-200 dark:border-gray-700" />

      <!-- 操作按钮 -->
      <div class="space-y-1 px-3">
        <button
          class="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          @click="fitGraph"
        >
          适应窗口
        </button>
        <button
          class="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          @click="resetZoom"
        >
          重置视图
        </button>
        <button
          class="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          @click="toggleFullscreen"
        >
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </button>
      </div>

      <div class="mx-3 my-2 border-t border-gray-200 dark:border-gray-700" />

      <!-- 时间范围过滤 -->
      <div class="px-3 py-1">
        <div class="flex items-center justify-between">
          <div class="text-xs font-medium text-gray-500 dark:text-gray-400">时间范围</div>
          <button
            v-if="timeRange.from !== undefined || timeRange.to !== undefined"
            class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="clearTimeRange"
          >
            清除
          </button>
        </div>

        <div v-if="allNodes.length > 0" class="mt-2">
          <!-- 日期标签 -->
          <div class="mb-1 flex justify-between text-xs text-gray-400">
            <span>{{ formatSliderDate(sliderFrom > 0 ? sliderFrom : timeMin) }}</span>
            <span>{{ formatSliderDate(sliderTo > 0 ? sliderTo : timeMax) }}</span>
          </div>

          <!-- 双滑块容器 -->
          <div class="relative h-5">
            <!-- 轨道 -->
            <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-gray-700" />
            <!-- 选中区域 -->
            <div
              class="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-pink-400"
              :style="{
                left: `${(((sliderFrom > 0 ? sliderFrom : timeMin) - timeMin) / (timeMax - timeMin)) * 100}%`,
                right: `${100 - (((sliderTo > 0 ? sliderTo : timeMax) - timeMin) / (timeMax - timeMin)) * 100}%`,
              }"
            />
            <!-- 起始滑块 -->
            <input
              type="range"
              :min="timeMin"
              :max="timeMax"
              :value="sliderFrom > 0 ? sliderFrom : timeMin"
              class="dual-slider absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
              data-testid="time-slider"
              @input="onSliderFromChange"
            />
            <!-- 结束滑块 -->
            <input
              type="range"
              :min="timeMin"
              :max="timeMax"
              :value="sliderTo > 0 ? sliderTo : timeMax"
              class="dual-slider absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
              data-testid="time-slider"
              @input="onSliderToChange"
            />
          </div>
        </div>

        <div v-else class="mt-1 text-xs text-gray-400">暂无节点时间数据</div>
      </div>

      <div class="mx-3 my-2 border-t border-gray-200 dark:border-gray-700" />

      <!-- 导出 -->
      <div class="space-y-1 px-3" data-testid="export-menu">
        <div class="text-xs font-medium text-gray-500 dark:text-gray-400">导出</div>
        <button
          class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          :disabled="filteredNodes.length === 0"
          @click="exportJSON"
        >
          导出 JSON
        </button>
        <button
          class="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
          :disabled="filteredNodes.length === 0"
          @click="exportGraphML"
        >
          导出 GraphML
        </button>
      </div>

      <!-- 选中节点详情 -->
      <div v-if="selectedNode" class="mx-3 mt-4">
        <div class="text-xs font-medium text-gray-500 dark:text-gray-400">节点详情</div>
        <div class="mt-2 rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-800">
          <div class="font-medium text-gray-900 dark:text-white">{{ selectedNode.label }}</div>
          <div class="mt-1 text-gray-500">{{ selectedNode.type }}</div>
          <div class="mt-1 text-gray-400">提及 {{ selectedNode.occurrenceCount }} 次</div>
          <div class="mt-1 text-gray-400">置信度 {{ Math.round(selectedNode.confidence * 100) }}%</div>
          <div class="mt-2 space-y-1">
            <button
              class="w-full rounded border px-2 py-0.5 text-xs transition-colors"
              :class="
                pinnedNodeIds.has(selectedNode.id)
                  ? 'border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400'
                  : 'border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
              "
              @click="togglePinNode"
            >
              {{ pinnedNodeIds.has(selectedNode.id) ? '取消固定' : '固定节点' }}
            </button>
            <button
              class="w-full rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
              @click="expandNeighbors"
            >
              展开邻居
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧图谱区域 -->
    <div class="relative flex-1">
      <!-- 加载中 -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center">
        <div class="h-8 w-8 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="filteredNodes.length === 0 && !loading"
        class="flex h-full flex-col items-center justify-center gap-2 text-gray-400"
      >
        <UIcon name="i-heroicons-share" class="h-12 w-12" />
        <p class="text-sm">暂无图谱数据</p>
        <p class="text-xs">导入聊天记录后，AI 将自动构建知识图谱</p>
      </div>

      <!-- Cytoscape 不可用 -->
      <div
        v-else-if="filteredNodes.length > 0 && !cytoscapeAvailable"
        class="flex h-full flex-col items-center justify-center gap-2 text-gray-400"
      >
        <UIcon name="i-heroicons-exclamation-triangle" class="h-10 w-10 text-yellow-400" />
        <p class="text-sm">图谱渲染库未加载</p>
        <p class="text-xs">当前共 {{ filteredNodes.length }} 个节点，{{ filteredEdges.length }} 条关系</p>
        <div class="mt-4 max-w-sm rounded-lg bg-gray-50 p-3 text-left text-xs text-gray-500 dark:bg-gray-800">
          <div class="font-medium text-gray-700 dark:text-gray-300">节点列表（前20）</div>
          <div v-for="node in filteredNodes.slice(0, 20)" :key="node.id" class="mt-1 flex items-center gap-2">
            <div class="h-2 w-2 rounded-full" :style="{ backgroundColor: getNodeColor(node.type) }" />
            <span>{{ node.displayName || node.name }}</span>
            <span class="text-gray-400">{{ node.type }}</span>
          </div>
        </div>
      </div>

      <!-- Cytoscape 画布 -->
      <div
        v-show="filteredNodes.length > 0 && cytoscapeAvailable"
        ref="graphContainer"
        class="relative h-full w-full"
        data-testid="graph-canvas"
      >
        <!-- 悬浮节点信息 -->
        <div
          v-show="hoverTip.visible && hoverTip.data"
          class="pointer-events-none absolute z-20 min-w-[160px] rounded-md border border-gray-200 bg-white/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95"
          :style="{
            left: `${hoverTip.x + 14}px`,
            top: `${hoverTip.y + 14}px`,
          }"
        >
          <div class="font-medium text-gray-900 dark:text-white">{{ hoverTip.data?.label }}</div>
          <div class="mt-0.5 flex items-center gap-1.5 text-gray-500">
            <span class="inline-block h-2 w-2 rounded-full" :style="{ backgroundColor: hoverTip.data?.color }" />
            <span>{{ hoverTip.data?.type }}</span>
          </div>
          <div class="mt-1 text-gray-500">
            提及 {{ hoverTip.data?.occurrenceCount }} 次 · 置信度
            {{ Math.round((hoverTip.data?.confidence ?? 0) * 100) }}%
          </div>
          <div v-if="hoverTip.data?.firstSeenTs" class="mt-1 text-[10px] text-gray-400">
            首次 {{ formatTs(hoverTip.data?.firstSeenTs) }}
          </div>
          <div v-if="hoverTip.data?.lastSeenTs" class="text-[10px] text-gray-400">
            最近 {{ formatTs(hoverTip.data?.lastSeenTs) }}
          </div>
        </div>
      </div>

      <!-- 隐藏的节点列表，用于 E2E 测试（Cytoscape 是 canvas，无 DOM 元素） -->
      <ul aria-hidden="true" class="sr-only">
        <li
          v-for="n in filteredNodes"
          :key="n.id"
          data-testid="graph-node"
          :data-type="n.type"
          :data-id="n.id"
          :data-label="n.displayName || n.name"
        />
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* Dual-handle range slider — make thumbs transparent bg, keep only the thumb circle */
.dual-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ec4899;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  pointer-events: all;
}
.dual-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ec4899;
  border: 2px solid white;
  cursor: pointer;
  pointer-events: all;
}
/* Prevent the track from showing; we draw our own */
.dual-slider::-webkit-slider-runnable-track {
  background: transparent;
}
.dual-slider::-moz-range-track {
  background: transparent;
}
</style>
