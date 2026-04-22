/**
 * AI 提取执行服务（主进程异步运行）
 * 导入完成后从聊天记录中提取任务，推送进度到渲染进程
 * 使用主进程事件循环异步运行，直接复用 LLM 模块
 */

import type { BrowserWindow } from 'electron'
import { getAllRecentMessages } from '../worker/workerManager'
import { taskService } from './taskService'
import { graphService } from './graphService'
import { knowledgeService } from './knowledgeService'
import { focusService } from './focusService'
import { todoService } from './todoService'
import { extractionJobService } from '../database/global/extraction'
import { getActiveConfig, buildPiModel } from '../ai/llm'
import {
  completeSimple,
  stream as piStream,
  Type,
  type TextContent as PiTextContent,
  type Tool as PiTool,
  type Context as PiContext,
} from '@mariozechner/pi-ai'
import type { GlobalTask } from './taskService'

// ==================== 统一提取工具定义 ====================
// 使用 Function Calling 约束 LLM 输出，保证 100% 合法的结构化数据
// 相比纯 prompt + 正则解析，优点：
//   1. provider 在解码层面保证 JSON 语法合法，不会截断乱码
//   2. 字段缺失会被 provider 主动补齐为默认值或报错
//   3. thinking 模式的思考过程走 thinking 通道，不会污染工具参数

const extractionToolSchema = Type.Object({
  tasks: Type.Array(
    Type.Object({
      title: Type.String({ description: '任务标题，简洁描述要做的事' }),
      description: Type.Optional(Type.String({ description: '可选详细描述' })),
      ownerName: Type.Optional(Type.String({ description: '负责人显示名' })),
      priority: Type.Optional(
        Type.Union([Type.Literal('low'), Type.Literal('normal'), Type.Literal('high'), Type.Literal('urgent')])
      ),
      dueDate: Type.Optional(Type.String({ description: '截止日期 YYYY-MM-DD' })),
      confidence: Type.Number({ minimum: 0, maximum: 1, description: '0-1 置信度' }),
    }),
    { description: '任务列表：有明确负责人 / 交付物 / 截止日期的正式工作项' }
  ),
  todos: Type.Array(
    Type.Object({
      title: Type.String({ description: '待办标题，应从"我"的视角表述要做的事' }),
      description: Type.Optional(Type.String({ description: '补充说明：是谁提出的、为什么提出、相关上下文' })),
      requesterName: Type.Optional(Type.String({ description: '提出请求 / 发起委托的人的显示名' })),
      mentionType: Type.Optional(
        Type.Union([Type.Literal('at_me'), Type.Literal('name_me')], {
          description: 'at_me = 消息中明确 @我；name_me = 消息中直接点名叫我的昵称',
        })
      ),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
    {
      description:
        '待办列表：**专指别人对"我"发出的、没有明确时间的请求或委托**——形如"@我 去做某事"、"小明帮我看一下"、"X 你有空 Y 一下"等无具体截止时间的提醒型事项。有明确截止日期的归入 tasks，而不是 todos。',
    }
  ),
  focus: Type.Array(
    Type.Object({
      title: Type.String({ description: '关注点的主题/对象名称，不超过 20 字' }),
      type: Type.Union([Type.Literal('topic'), Type.Literal('person'), Type.Literal('task'), Type.Literal('project')]),
      watcher: Type.Optional(
        Type.String({
          description: '谁在关注这个事项。如果某人反复提及/跟踪某事，填该人显示名；如果是全群共同关注，留空',
        })
      ),
      description: Type.Optional(Type.String()),
      keywords: Type.Array(Type.String(), { description: '1-5 个相关关键词（辅助检索）' }),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
    {
      description:
        '关注点列表：形如"某人 → 关注某事"的映射。type=person 表示是一个被关注的人物，watcher 表示关注者。反复出现、值得持续跟踪的事项才提取。',
    }
  ),
  faqs: Type.Array(
    Type.Object({
      question: Type.String(),
      answer: Type.String(),
      category: Type.Optional(Type.String()),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
    { description: 'FAQ 列表：仅提取明确的 Q&A 交互（谁问了什么、谁怎么答）' }
  ),
  concepts: Type.Array(
    Type.Object({
      title: Type.String({ description: '概念名称，例如"WebSocket"、"WAL 模式"' }),
      content: Type.String({ description: '该概念的解释/定义，聚合群聊中出现的说明' }),
      category: Type.Optional(Type.String()),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
    { description: '概念列表：技术名词 / 业务术语 / 抽象模型的定义或释义' }
  ),
  documents: Type.Array(
    Type.Object({
      title: Type.String({ description: '文档名称或主题' }),
      content: Type.String({ description: '文档的关键说明 / 链接 / 引用，包含 URL 或路径' }),
      category: Type.Optional(Type.String()),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
    { description: '文档列表：群聊中提到的 wiki / confluence / notion / github 链接、设计稿、需求文档' }
  ),
  procedures: Type.Array(
    Type.Object({
      title: Type.String({ description: '流程名称，例如"上线流程"、"Hotfix 流程"' }),
      content: Type.String({ description: '步骤列表，用 1. 2. 3. 编号呈现' }),
      category: Type.Optional(Type.String()),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
    { description: '流程列表：分步骤的 SOP / 操作手册 / 故障处理顺序' }
  ),
  tips: Type.Array(
    Type.Object({
      title: Type.String({ description: '技巧标题' }),
      content: Type.String({ description: '技巧的具体内容和适用场景' }),
      category: Type.Optional(Type.String()),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
    { description: '技巧列表：最佳实践 / 经验心得 / 避坑指南' }
  ),
  graph: Type.Object({
    entities: Type.Array(
      Type.Object({
        name: Type.String({ description: '实体唯一标识' }),
        type: Type.Union([
          Type.Literal('person'),
          Type.Literal('project'),
          Type.Literal('technology'),
          Type.Literal('organization'),
          Type.Literal('concept'),
          Type.Literal('location'),
          Type.Literal('other'),
        ]),
        displayName: Type.Optional(Type.String()),
        confidence: Type.Number({ minimum: 0, maximum: 1 }),
      })
    ),
    relationships: Type.Array(
      Type.Object({
        sourceName: Type.String(),
        targetName: Type.String(),
        relationType: Type.String({ description: '关系类型，如 assigned_to/uses/leads' }),
        confidence: Type.Number({ minimum: 0, maximum: 1 }),
      })
    ),
  }),
})

const extractionTool: PiTool<typeof extractionToolSchema> = {
  name: 'save_extracted_info',
  description:
    '从群聊记录中提取并保存多类信息：任务(tasks)、待办(todos)、关注点(focus)、问答(faqs)、概念(concepts)、文档(documents)、流程(procedures)、技巧(tips)、知识图谱(graph)。模型必须调用此工具，不要直接回复文本。',
  parameters: extractionToolSchema,
}

interface ExtractedTodo {
  title: string
  description?: string
  requesterName?: string
  mentionType?: 'at_me' | 'name_me'
  confidence: number
}

interface ExtractedKnowledge {
  title: string
  content: string
  category?: string
  confidence: number
}

interface UnifiedExtractionResult {
  tasks: ExtractedTask[]
  todos: ExtractedTodo[]
  focus: ExtractedFocusItem[]
  faqs: ExtractedFAQ[]
  concepts: ExtractedKnowledge[]
  documents: ExtractedKnowledge[]
  procedures: ExtractedKnowledge[]
  tips: ExtractedKnowledge[]
  graph: ExtractedGraphData
}

interface ExtractedTask {
  title: string
  description?: string
  ownerName?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  dueDate?: string
  confidence: number
}

interface ChatMessage {
  id: number
  senderName: string
  content: string
  timestamp: number
}

interface ExtractedEntity {
  name: string
  type: 'person' | 'project' | 'technology' | 'organization' | 'concept' | 'location' | 'other'
  displayName?: string
  confidence: number
  properties?: Record<string, unknown>
}

interface ExtractedRelationship {
  sourceName: string
  targetName: string
  relationType: string
  confidence: number
  properties?: Record<string, unknown>
}

interface ExtractedGraphData {
  entities: ExtractedEntity[]
  relationships: ExtractedRelationship[]
}

/**
 * 简单 Levenshtein 编辑距离（用于 FAQ 跨会话去重）
 */
function levenshteinSimple(a: string, b: string): number {
  const m = a.length,
    n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i || j))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/**
 * 将聊天消息格式化成 LLM 可读文本
 */
function formatMessagesForLLM(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const date = new Date(m.timestamp).toLocaleString('zh-CN')
      return `[${date}] ${m.senderName}: ${m.content}`
    })
    .join('\n')
}

/**
 * 使用 LLM 从消息批次中提取任务
 */
async function extractTasksWithLLM(messages: ChatMessage[]): Promise<ExtractedTask[]> {
  const config = getActiveConfig()
  if (!config) {
    console.warn('[ExtractionRunner] No active LLM config, skipping extraction')
    return []
  }

  const model = buildPiModel(config)
  const prompt = `你是一个任务提取助手。请从以下群聊记录中识别并提取所有任务相关信息。

【群聊记录】
${formatMessagesForLLM(messages)}

【输出要求】
返回 JSON 数组，每个任务包含以下字段：
- title: 任务标题（简洁描述）
- description: 详细描述（可选）
- ownerName: 负责人名称（群聊中提到的名字，可选）
- priority: 优先级 low/normal/high/urgent（可选）
- dueDate: 截止日期 YYYY-MM-DD 格式（可选）
- confidence: 置信度 0-1（必填，你有多确定这是一个任务）

只返回 JSON 数组，不要有任何额外说明。如果没有发现任何任务，返回空数组 []。`

  try {
    const result = await completeSimple(
      model,
      {
        systemPrompt: '你是一个任务提取助手，专门从群聊记录中识别任务相关信息，只输出 JSON 数组。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey: config.apiKey,
        temperature: 0.3,
        maxTokens: 2000,
      }
    )

    const text = result.content
      .filter((item): item is PiTextContent => item.type === 'text')
      .map((item) => item.text)
      .join('')
      .trim()

    // 解析 JSON（容错：提取第一个 [...] 块）
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []

    const parsed = JSON.parse(match[0]) as ExtractedTask[]
    return parsed.filter((t) => t.title && t.confidence >= 0.6)
  } catch (error) {
    console.error('[ExtractionRunner] LLM extraction failed:', error)
    return []
  }
}

/**
 * 去重：合并标题相似的任务
 */
function deduplicateTasks(tasks: ExtractedTask[]): ExtractedTask[] {
  const seen = new Map<string, ExtractedTask>()

  for (const task of tasks) {
    const key = task.title.toLowerCase().trim()
    const existing = seen.get(key)
    if (!existing || task.confidence > existing.confidence) {
      seen.set(key, task)
    }
  }

  return Array.from(seen.values())
}

/**
 * 使用 LLM 从消息批次中提取实体和关系
 */
async function extractGraphDataWithLLM(messages: ChatMessage[]): Promise<ExtractedGraphData> {
  const config = getActiveConfig()
  if (!config) {
    console.warn('[ExtractionRunner] No active LLM config, skipping graph extraction')
    return { entities: [], relationships: [] }
  }

  const model = buildPiModel(config)
  const prompt = `你是一个知识图谱提取助手。请从以下群聊记录中识别实体和它们之间的关系。

【群聊记录】
${formatMessagesForLLM(messages)}

【输出要求】
返回 JSON 对象，包含两个数组：
1. entities（实体）：
   - name: 实体唯一标识符（英文或中文，用于去重）
   - type: 类型，必须是 person/project/technology/organization/concept/location/other 之一
   - displayName: 显示名称（可选，中文友好名）
   - confidence: 置信度 0-1（必填）
   - properties: 附加属性对象（可选，如 role/description/url 等）

2. relationships（关系）：
   - sourceName: 源实体 name（必须与 entities 中的 name 匹配）
   - targetName: 目标实体 name（必须与 entities 中的 name 匹配）
   - relationType: 关系类型（如 assigned_to/uses/belongs_to/mentions/related_to/leads 等）
   - confidence: 置信度 0-1（必填）
   - properties: 附加属性（可选）

只返回 JSON 对象，格式：{"entities":[...],"relationships":[...]}。如果没有发现任何实体，返回空数组。`

  try {
    console.log(`[ExtractionRunner] Calling LLM for graph extraction, ${messages.length} messages`)
    const result = await completeSimple(
      model,
      {
        systemPrompt: '你是一个知识图谱提取助手，专门从群聊记录中识别实体和关系，只输出 JSON 对象。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey: config.apiKey,
        temperature: 0.2,
        maxTokens: 3000,
      }
    )

    const text = result.content
      .filter((item): item is PiTextContent => item.type === 'text')
      .map((item) => item.text)
      .join('')
      .trim()

    // 容错解析：提取第一个 {...} 块
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      console.warn('[ExtractionRunner] Graph LLM returned no JSON object')
      return { entities: [], relationships: [] }
    }

    const parsed = JSON.parse(match[0]) as ExtractedGraphData
    const entities = (parsed.entities || []).filter((e) => e.name && e.confidence >= 0.5)
    const relationships = (parsed.relationships || []).filter(
      (r) => r.sourceName && r.targetName && r.confidence >= 0.5
    )

    console.log(
      `[ExtractionRunner] Graph LLM extracted ${entities.length} entities, ${relationships.length} relationships`
    )
    return { entities, relationships }
  } catch (error) {
    console.error('[ExtractionRunner] Graph LLM extraction failed:', error)
    return { entities: [], relationships: [] }
  }
}

/**
 * 去重实体：合并 name 相同的实体，保留最高置信度
 */
function deduplicateEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>()
  for (const entity of entities) {
    const key = entity.name.toLowerCase().trim()
    const existing = seen.get(key)
    if (!existing || entity.confidence > existing.confidence) {
      seen.set(key, entity)
    }
  }
  return Array.from(seen.values())
}

/**
 * 将提取的实体和关系持久化到 knowledge_graph.db
 */
async function saveGraphData(
  entities: ExtractedEntity[],
  relationships: ExtractedRelationship[],
  sessionId: string,
  messages: ChatMessage[]
): Promise<{ savedNodes: number; savedEdges: number }> {
  const now = Date.now()
  const nameToNodeId = new Map<string, number>()

  // 统一时间单位为毫秒：部分平台(如 QQ)的 message.ts 存储为秒，需乘 1000
  const toMs = (t: number) => (t > 0 && t < 1e12 ? t * 1000 : t)

  // 为每个实体扫描一次消息，记录它首次/最近出现的时间戳范围
  // （避免每条实体重复 scan，同时让时间属性反映真实聊天时间）
  const entityTimeRange = new Map<string, { min: number; max: number; firstRef?: ChatMessage }>()
  for (const entity of entities) {
    const key = entity.name.toLowerCase().trim()
    const displayName = entity.displayName || ''
    let minTs = Infinity
    let maxTs = -Infinity
    let firstRef: ChatMessage | undefined
    for (const m of messages) {
      if (m.content.includes(entity.name) || (displayName && m.content.includes(displayName))) {
        const ts = toMs(m.timestamp)
        if (ts < minTs) {
          minTs = ts
          firstRef = m
        }
        if (ts > maxTs) maxTs = ts
      }
    }
    if (minTs === Infinity) {
      // 未匹配到消息时，回退到该批次消息的时间范围而非当前时间，
      // 避免 Date.now() 污染图谱时间轴
      const tsList = messages.map((m) => toMs(m.timestamp)).filter((t) => t > 0)
      minTs = tsList.length > 0 ? Math.min(...tsList) : now
      maxTs = tsList.length > 0 ? Math.max(...tsList) : now
    }
    entityTimeRange.set(key, { min: minTs, max: maxTs, firstRef })
  }

  // 保存实体节点
  let savedNodes = 0
  for (const entity of entities) {
    try {
      const key = entity.name.toLowerCase().trim()
      const range = entityTimeRange.get(key)!
      const messageRef = range.firstRef
      const nodeId = graphService.upsertNode({
        type: entity.type,
        isCoreType: ['person', 'project', 'technology', 'organization'].includes(entity.type),
        name: entity.name,
        displayName: entity.displayName,
        properties: entity.properties || {},
        firstSeenTs: range.min,
        lastSeenTs: range.max,
        sourceSessions: [sessionId],
        sourceMessageRefs: messageRef ? [{ sessionId, messageId: messageRef.id }] : [],
        confidence: entity.confidence,
      })
      nameToNodeId.set(entity.name.toLowerCase().trim(), nodeId)
      savedNodes++
      console.log(`[ExtractionRunner] Upserted node: ${entity.name} (type=${entity.type}, id=${nodeId})`)
    } catch (err) {
      console.error(`[ExtractionRunner] Failed to save entity "${entity.name}":`, err)
    }
  }

  // 保存关系边
  let savedEdges = 0
  for (const rel of relationships) {
    try {
      const sourceId = nameToNodeId.get(rel.sourceName.toLowerCase().trim())
      const targetId = nameToNodeId.get(rel.targetName.toLowerCase().trim())
      if (!sourceId || !targetId) {
        console.warn(
          `[ExtractionRunner] Skipping edge: cannot find nodes for "${rel.sourceName}" -> "${rel.targetName}"`
        )
        continue
      }
      const sRange = entityTimeRange.get(rel.sourceName.toLowerCase().trim())
      const tRange = entityTimeRange.get(rel.targetName.toLowerCase().trim())
      const edgeMin = sRange && tRange ? Math.min(sRange.min, tRange.min) : now
      const edgeMax = sRange && tRange ? Math.max(sRange.max, tRange.max) : now
      graphService.upsertEdge({
        type: rel.relationType,
        isCoreType: ['assigned_to', 'uses', 'belongs_to', 'leads'].includes(rel.relationType),
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        properties: rel.properties || {},
        firstSeenTs: edgeMin,
        lastSeenTs: edgeMax,
        sourceSessions: [sessionId],
        confidence: rel.confidence,
      })
      savedEdges++
      console.log(`[ExtractionRunner] Upserted edge: ${rel.sourceName} -[${rel.relationType}]-> ${rel.targetName}`)
    } catch (err) {
      console.error(`[ExtractionRunner] Failed to save relationship "${rel.sourceName}" -> "${rel.targetName}":`, err)
    }
  }

  return { savedNodes, savedEdges }
}

/**
 * 启动知识图谱提取（异步，不阻塞）
 * 导入完成后调用此函数（与任务提取并行）
 */
export async function startGraphExtraction(sessionId: string, win: BrowserWindow): Promise<void> {
  // 1. 创建/获取提取任务（去重）
  const job = await extractionJobService.createJob(sessionId, 'graph')

  if (job.status === 'done') {
    console.log('[ExtractionRunner] Graph extraction already done for session:', sessionId)
    return
  }

  extractionJobService.startJob(job.id)
  sendGraphProgress(win, job.id, sessionId, 5, '开始读取消息（图谱提取）...')

  try {
    const { messages: rawMessages, total } = await getAllRecentMessages(sessionId, undefined, 999999)
    console.log(`[ExtractionRunner] Graph extraction: ${total} messages for session ${sessionId}`)

    if (total === 0) {
      extractionJobService.finishJob(job.id, { nodesExtracted: 0, edgesExtracted: 0 })
      sendGraphProgress(win, job.id, sessionId, 100, '无消息可分析（图谱）')
      return
    }

    sendGraphProgress(win, job.id, sessionId, 10, `共 ${total} 条消息，开始图谱分析...`)

    const messages: ChatMessage[] = rawMessages.map((m: any) => ({
      id: m.id,
      senderName: m.senderName || m.sender_name || '未知',
      content: m.content || '',
      timestamp: m.timestamp || m.ts || 0,
    }))

    // 滑动窗口批处理（batchSize=60, overlap=5，图谱需要更多上下文）
    const batchSize = 60
    const overlap = 5
    if (batchSize <= overlap)
      throw new Error(`[ExtractionRunner] batchSize(${batchSize}) must be > overlap(${overlap})`)
    const allEntities: ExtractedEntity[] = []
    const allRelationships: ExtractedRelationship[] = []

    for (let i = 0; i < messages.length; i += batchSize - overlap) {
      const end = Math.min(messages.length, i + batchSize)
      const batch = messages.slice(i, end)

      console.log(`[ExtractionRunner] Graph batch ${i}-${end} of ${messages.length}`)
      const { entities, relationships } = await extractGraphDataWithLLM(batch)
      allEntities.push(...entities)
      allRelationships.push(...relationships)

      const progress = Math.min(85, 10 + Math.floor((end / messages.length) * 75))
      sendGraphProgress(win, job.id, sessionId, progress, `已分析 ${end}/${messages.length} 条消息（图谱）`)
    }

    // 去重实体
    const deduplicated = deduplicateEntities(allEntities)
    console.log(
      `[ExtractionRunner] Graph: ${deduplicated.length} unique entities, ${allRelationships.length} relationships`
    )

    sendGraphProgress(win, job.id, sessionId, 90, `提取到 ${deduplicated.length} 个实体，正在保存图谱...`)

    const { savedNodes, savedEdges } = await saveGraphData(deduplicated, allRelationships, sessionId, messages)

    extractionJobService.finishJob(job.id, { nodesExtracted: savedNodes, edgesExtracted: savedEdges })
    sendGraphProgress(win, job.id, sessionId, 100, `图谱完成：${savedNodes} 节点，${savedEdges} 边`)

    win.webContents.send('collab:extractionDone', {
      jobId: job.id,
      sessionId,
      jobType: 'graph',
      result: { nodesExtracted: savedNodes, edgesExtracted: savedEdges },
    })

    console.log(
      `[ExtractionRunner] Graph extraction done: ${savedNodes} nodes, ${savedEdges} edges for session ${sessionId}`
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[ExtractionRunner] Graph extraction failed:', errMsg)
    extractionJobService.failJob(job.id, 'GRAPH_EXTRACTION_ERROR', errMsg)

    win.webContents.send('collab:extractionError', {
      jobId: job.id,
      sessionId,
      jobType: 'graph',
      error: errMsg,
    })
  }
}

/**
 * 启动任务提取（异步，不阻塞）
 * 导入完成后调用此函数
 */
export async function startTaskExtraction(sessionId: string, win: BrowserWindow): Promise<void> {
  // 1. 创建/获取提取任务（去重）
  const job = await extractionJobService.createJob(sessionId, 'tasks')

  // 已完成则跳过
  if (job.status === 'done') {
    console.log('[ExtractionRunner] Task extraction already done for session:', sessionId)
    return
  }

  // 标记为运行中
  extractionJobService.startJob(job.id)
  sendProgress(win, job.id, sessionId, 5, '开始读取消息...')

  try {
    // 2. 查询所有消息（getAllRecentMessages 内部处理数据库打开）
    const { messages: rawMessages, total } = await getAllRecentMessages(sessionId, undefined, 999999)

    if (total === 0) {
      extractionJobService.finishJob(job.id, { tasksExtracted: 0 })
      sendProgress(win, job.id, sessionId, 100, '无消息可分析')
      return
    }

    sendProgress(win, job.id, sessionId, 10, `共 ${total} 条消息，开始分析...`)

    // 3. 滑动窗口批处理（batchSize=50，overlap=5）
    const messages: ChatMessage[] = rawMessages.map((m: any) => ({
      id: m.id,
      senderName: m.senderName || m.sender_name || '未知',
      content: m.content || '',
      timestamp: m.timestamp || m.ts || 0,
    }))

    const batchSize = 50
    const overlap = 5
    if (batchSize <= overlap)
      throw new Error(`[ExtractionRunner] batchSize(${batchSize}) must be > overlap(${overlap})`)
    const allExtracted: ExtractedTask[] = []

    for (let i = 0; i < messages.length; i += batchSize - overlap) {
      const start = Math.max(0, i)
      const end = Math.min(messages.length, i + batchSize)
      const batch = messages.slice(start, end)

      const extracted = await extractTasksWithLLM(batch)
      allExtracted.push(...extracted)

      const progress = Math.min(90, 10 + Math.floor((end / messages.length) * 80))
      sendProgress(win, job.id, sessionId, progress, `已分析 ${end}/${messages.length} 条消息`)
    }

    // 4. 去重
    const deduplicated = deduplicateTasks(allExtracted)

    sendProgress(win, job.id, sessionId, 92, `提取到 ${deduplicated.length} 个任务，正在保存...`)

    // 5. 保存到全局数据库
    let savedCount = 0
    for (const task of deduplicated) {
      try {
        const taskData: Omit<GlobalTask, 'id' | 'createdTs' | 'updatedTs'> = {
          title: task.title,
          description: task.description,
          status: 'pending',
          priority: task.priority || 'normal',
          ownerDisplayName: task.ownerName,
          dueTs: (() => {
            if (!task.dueDate) return undefined
            const ts = new Date(task.dueDate).getTime()
            return isNaN(ts) ? undefined : ts
          })(),
          confidence: task.confidence,
          isManual: false,
          tags: [],
          metadata: { sessionId },
        }
        taskService.createTask(taskData)
        savedCount++
      } catch (err) {
        console.error('[ExtractionRunner] Failed to save task:', err)
      }
    }

    // 6. 完成
    extractionJobService.finishJob(job.id, { tasksExtracted: savedCount })
    sendProgress(win, job.id, sessionId, 100, `完成，共提取 ${savedCount} 个任务`)

    // 通知渲染进程提取完成
    win.webContents.send('collab:extractionDone', {
      jobId: job.id,
      sessionId,
      jobType: 'tasks',
      result: { tasksExtracted: savedCount },
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[ExtractionRunner] Extraction failed:', errMsg)
    extractionJobService.failJob(job.id, 'EXTRACTION_ERROR', errMsg)

    win.webContents.send('collab:extractionError', {
      jobId: job.id,
      sessionId,
      jobType: 'tasks',
      error: errMsg,
    })
  }
}

function sendProgress(win: BrowserWindow, jobId: string, sessionId: string, progress: number, message: string): void {
  extractionJobService.updateProgress(jobId, progress, message)
  win.webContents.send('collab:extractionProgress', {
    jobId,
    sessionId,
    jobType: 'tasks',
    progress,
    message,
  })
}

// ==================== FAQ 知识提取 ====================

interface ExtractedFAQ {
  question: string
  answer: string
  category?: string
  confidence: number
}

/**
 * 使用 LLM 从消息批次中提取 FAQ 问答对
 */
async function extractFAQWithLLM(messages: ChatMessage[]): Promise<ExtractedFAQ[]> {
  const config = getActiveConfig()
  if (!config) return []

  const model = buildPiModel(config)
  const prompt = `你是一个知识提取助手。请从以下群聊记录中识别并提取问答对（FAQ）。

【群聊记录】
${formatMessagesForLLM(messages)}

【输出要求】
返回 JSON 数组，每项包含：
- question: 问题（简洁的疑问句）
- answer: 答案（完整、清晰的回答）
- category: 分类（可选，如"技术/流程/产品/其他"）
- confidence: 置信度 0-1（必填，你有多确定这是一个有效问答对）

只提取明确的问答交互，不要推测。如果没有发现任何问答对，返回空数组 []。
只返回 JSON 数组，不要有任何额外说明。`

  try {
    const result = await completeSimple(
      model,
      {
        systemPrompt: '你是一个知识提取助手，专门从群聊记录中识别问答对，只输出 JSON 数组。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      { apiKey: config.apiKey, temperature: 0.2, maxTokens: 2000 }
    )

    const text = result.content
      .filter((item): item is PiTextContent => item.type === 'text')
      .map((item) => item.text)
      .join('')
      .trim()

    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []

    const parsed = JSON.parse(match[0]) as ExtractedFAQ[]
    return parsed.filter((f) => f.question && f.answer && f.confidence >= 0.6)
  } catch (error) {
    console.error('[ExtractionRunner] FAQ LLM extraction failed:', error)
    return []
  }
}

/**
 * 去重 FAQ：合并问题相似的条目
 */
function deduplicateFAQs(faqs: ExtractedFAQ[]): ExtractedFAQ[] {
  const seen = new Map<string, ExtractedFAQ>()
  for (const faq of faqs) {
    const key = faq.question.toLowerCase().trim().slice(0, 30)
    const existing = seen.get(key)
    if (!existing || faq.confidence > existing.confidence) {
      seen.set(key, faq)
    }
  }
  return Array.from(seen.values())
}

/**
 * 启动 FAQ 知识提取（异步，不阻塞）
 */
export async function startFaqExtraction(sessionId: string, win: BrowserWindow): Promise<void> {
  const job = await extractionJobService.createJob(sessionId, 'faq')

  if (job.status === 'done') {
    console.log('[ExtractionRunner] FAQ extraction already done for session:', sessionId)
    return
  }

  extractionJobService.startJob(job.id)
  sendFaqProgress(win, job.id, sessionId, 5, '开始读取消息（FAQ提取）...')

  try {
    const { messages: rawMessages, total } = await getAllRecentMessages(sessionId, undefined, 999999)
    console.log(`[ExtractionRunner] FAQ extraction: ${total} messages for session ${sessionId}`)

    if (total === 0) {
      extractionJobService.finishJob(job.id, { faqExtracted: 0 })
      sendFaqProgress(win, job.id, sessionId, 100, '无消息可分析（FAQ）')
      return
    }

    sendFaqProgress(win, job.id, sessionId, 10, `共 ${total} 条消息，开始 FAQ 分析...`)

    const messages: ChatMessage[] = rawMessages.map((m: any) => ({
      id: m.id,
      senderName: m.senderName || m.sender_name || '未知',
      content: m.content || '',
      timestamp: m.timestamp || m.ts || 0,
    }))

    const batchSize = 40
    const overlap = 5
    if (batchSize <= overlap)
      throw new Error(`[ExtractionRunner] batchSize(${batchSize}) must be > overlap(${overlap})`)
    const allFAQs: ExtractedFAQ[] = []

    for (let i = 0; i < messages.length; i += batchSize - overlap) {
      const end = Math.min(messages.length, i + batchSize)
      const batch = messages.slice(i, end)

      console.log(`[ExtractionRunner] FAQ batch ${i}-${end} of ${messages.length}`)
      const faqs = await extractFAQWithLLM(batch)
      allFAQs.push(...faqs)

      const progress = Math.min(85, 10 + Math.floor((end / messages.length) * 75))
      sendFaqProgress(win, job.id, sessionId, progress, `已分析 ${end}/${messages.length} 条消息（FAQ）`)
    }

    const deduplicated = deduplicateFAQs(allFAQs)
    console.log(`[ExtractionRunner] FAQ: ${deduplicated.length} unique FAQ items`)

    sendFaqProgress(win, job.id, sessionId, 90, `提取到 ${deduplicated.length} 个问答，正在保存...`)

    // 跨会话去重：加载已有 FAQ 标题，跳过相似度 >80% 的重复项
    const existingFAQs = knowledgeService.queryItems({ type: ['faq'] })
    const existingTitles = existingFAQs.map((f) => f.title.toLowerCase().trim())

    let savedCount = 0
    for (const faq of deduplicated) {
      try {
        const newTitle = faq.question.toLowerCase().trim()
        const isDuplicate = existingTitles.some((existing) => {
          const longer = Math.max(existing.length, newTitle.length)
          if (longer === 0) return true
          const distance = levenshteinSimple(existing, newTitle)
          return 1 - distance / longer >= 0.8
        })
        if (isDuplicate) {
          console.log(`[ExtractionRunner] FAQ skipped (duplicate): ${faq.question.slice(0, 40)}`)
          continue
        }
        const newId = knowledgeService.createItem({
          type: 'faq',
          title: faq.question,
          content: faq.answer,
          category: faq.category,
          tags: [],
          sourceSessionIds: [sessionId],
          sourceMessageRefs: [],
          confidence: faq.confidence,
          isEdited: false,
          status: 'active',
        })
        existingTitles.push(newTitle) // prevent duplicates within same batch
        savedCount++
        void newId
      } catch (err) {
        console.error('[ExtractionRunner] Failed to save FAQ item:', err)
      }
    }

    extractionJobService.finishJob(job.id, { faqExtracted: savedCount })
    sendFaqProgress(win, job.id, sessionId, 100, `FAQ 完成：共 ${savedCount} 个问答`)

    win.webContents.send('collab:extractionDone', {
      jobId: job.id,
      sessionId,
      jobType: 'faq',
      result: { faqExtracted: savedCount },
    })

    console.log(`[ExtractionRunner] FAQ extraction done: ${savedCount} items for session ${sessionId}`)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[ExtractionRunner] FAQ extraction failed:', errMsg)
    extractionJobService.failJob(job.id, 'FAQ_EXTRACTION_ERROR', errMsg)

    win.webContents.send('collab:extractionError', {
      jobId: job.id,
      sessionId,
      jobType: 'faq',
      error: errMsg,
    })
  }
}

function sendFaqProgress(
  win: BrowserWindow,
  jobId: string,
  sessionId: string,
  progress: number,
  message: string
): void {
  extractionJobService.updateProgress(jobId, progress, message)
  win.webContents.send('collab:extractionProgress', {
    jobId,
    sessionId,
    jobType: 'faq',
    progress,
    message,
  })
}

// ==================== 关注点提取 ====================

interface ExtractedFocusItem {
  title: string
  type: 'topic' | 'person' | 'task' | 'project'
  watcher?: string
  description?: string
  keywords: string[]
  confidence: number
}

/**
 * 使用 LLM 从消息批次中识别关注点
 */
async function extractFocusWithLLM(messages: ChatMessage[]): Promise<ExtractedFocusItem[]> {
  const config = getActiveConfig()
  if (!config) return []

  const model = buildPiModel(config)
  const prompt = `你是一个关注点识别助手。请从以下群聊记录中识别反复出现、值得持续关注的事项（人物、项目、话题、任务、关键词）。

【群聊记录】
${formatMessagesForLLM(messages)}

【输出要求】
返回 JSON 数组，每项包含：
- title: 关注点名称（简洁，不超过20字）
- type: 类型，必须是 topic/person/task/project/keyword 之一
- description: 简要描述（可选）
- keywords: 相关关键词列表（1-5个）
- confidence: 置信度 0-1（必填）

只提取真正值得持续跟踪的重要事项，不要过度提取。如果没有发现值得关注的事项，返回空数组 []。
只返回 JSON 数组，不要有任何额外说明。`

  try {
    const result = await completeSimple(
      model,
      {
        systemPrompt: '你是一个关注点识别助手，专门从群聊记录中识别值得持续跟踪的事项，只输出 JSON 数组。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      { apiKey: config.apiKey, temperature: 0.3, maxTokens: 2000 }
    )

    const text = result.content
      .filter((item): item is PiTextContent => item.type === 'text')
      .map((item) => item.text)
      .join('')
      .trim()

    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []

    const parsed = JSON.parse(match[0]) as ExtractedFocusItem[]
    return parsed.filter((f) => f.title && f.confidence >= 0.6)
  } catch (error) {
    console.error('[ExtractionRunner] Focus LLM extraction failed:', error)
    return []
  }
}

/**
 * 去重关注点：合并名称相似的条目
 */
function deduplicateFocusItems(items: ExtractedFocusItem[]): ExtractedFocusItem[] {
  const seen = new Map<string, ExtractedFocusItem>()
  for (const item of items) {
    const key = `${item.type}:${item.title.toLowerCase().trim()}`
    const existing = seen.get(key)
    if (!existing || item.confidence > existing.confidence) {
      seen.set(key, item)
    }
  }
  return Array.from(seen.values())
}

/**
 * 启动关注点提取（异步，不阻塞）
 */
export async function startFocusExtraction(sessionId: string, win: BrowserWindow): Promise<void> {
  const job = await extractionJobService.createJob(sessionId, 'focus')

  if (job.status === 'done') {
    console.log('[ExtractionRunner] Focus extraction already done for session:', sessionId)
    return
  }

  extractionJobService.startJob(job.id)
  sendFocusProgress(win, job.id, sessionId, 5, '开始读取消息（关注点提取）...')

  try {
    const { messages: rawMessages, total } = await getAllRecentMessages(sessionId, undefined, 999999)
    console.log(`[ExtractionRunner] Focus extraction: ${total} messages for session ${sessionId}`)

    if (total === 0) {
      extractionJobService.finishJob(job.id, { focusExtracted: 0 })
      sendFocusProgress(win, job.id, sessionId, 100, '无消息可分析（关注点）')
      return
    }

    sendFocusProgress(win, job.id, sessionId, 10, `共 ${total} 条消息，开始关注点分析...`)

    const messages: ChatMessage[] = rawMessages.map((m: any) => ({
      id: m.id,
      senderName: m.senderName || m.sender_name || '未知',
      content: m.content || '',
      timestamp: m.timestamp || m.ts || 0,
    }))

    const batchSize = 50
    const overlap = 5
    if (batchSize <= overlap)
      throw new Error(`[ExtractionRunner] batchSize(${batchSize}) must be > overlap(${overlap})`)
    const allFocusItems: ExtractedFocusItem[] = []

    for (let i = 0; i < messages.length; i += batchSize - overlap) {
      const end = Math.min(messages.length, i + batchSize)
      const batch = messages.slice(i, end)

      console.log(`[ExtractionRunner] Focus batch ${i}-${end} of ${messages.length}`)
      const items = await extractFocusWithLLM(batch)
      allFocusItems.push(...items)

      const progress = Math.min(85, 10 + Math.floor((end / messages.length) * 75))
      sendFocusProgress(win, job.id, sessionId, progress, `已分析 ${end}/${messages.length} 条消息（关注点）`)
    }

    const deduplicated = deduplicateFocusItems(allFocusItems)
    console.log(`[ExtractionRunner] Focus: ${deduplicated.length} unique focus items`)

    sendFocusProgress(win, job.id, sessionId, 90, `识别到 ${deduplicated.length} 个关注点，正在保存...`)

    // 使用系统级占位用户 ID（全局关注点归属于系统，用户可在 UI 中认领）
    const systemUserId = 'system'
    let savedCount = 0
    for (const item of deduplicated) {
      try {
        focusService.createFocusItem({
          globalUserId: systemUserId,
          type: item.type,
          title: item.title,
          description: item.description,
          keywords: item.keywords,
          status: 'active',
          lastActivityTs: Date.now(),
        })
        savedCount++
      } catch (err) {
        console.error('[ExtractionRunner] Failed to save focus item:', err)
      }
    }

    extractionJobService.finishJob(job.id, { focusExtracted: savedCount })
    sendFocusProgress(win, job.id, sessionId, 100, `关注点完成：共 ${savedCount} 个`)

    win.webContents.send('collab:extractionDone', {
      jobId: job.id,
      sessionId,
      jobType: 'focus',
      result: { focusExtracted: savedCount },
    })

    console.log(`[ExtractionRunner] Focus extraction done: ${savedCount} items for session ${sessionId}`)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[ExtractionRunner] Focus extraction failed:', errMsg)
    extractionJobService.failJob(job.id, 'FOCUS_EXTRACTION_ERROR', errMsg)

    win.webContents.send('collab:extractionError', {
      jobId: job.id,
      sessionId,
      jobType: 'focus',
      error: errMsg,
    })
  }
}

function sendFocusProgress(
  win: BrowserWindow,
  jobId: string,
  sessionId: string,
  progress: number,
  message: string
): void {
  extractionJobService.updateProgress(jobId, progress, message)
  win.webContents.send('collab:extractionProgress', {
    jobId,
    sessionId,
    jobType: 'focus',
    progress,
    message,
  })
}
function sendGraphProgress(
  win: BrowserWindow,
  jobId: string,
  sessionId: string,
  progress: number,
  message: string
): void {
  extractionJobService.updateProgress(jobId, progress, message)
  win.webContents.send('collab:extractionProgress', {
    jobId,
    sessionId,
    jobType: 'graph',
    progress,
    message,
  })
}

// ==================== 统一多类型提取 ====================

/**
 * 批次进度上报回调，用于在 streaming 过程中把 token 累积反馈给 UI
 */
type BatchProgressCallback = (info: { textTokens: number; toolTokens: number }) => void

/**
 * 一次 LLM 调用同时输出 tasks / todos / focus / faqs / graph。
 *
 * 工作方式（长期最优方案）：
 *   1. 定义 save_extracted_info 工具 + typebox schema，让 provider 在解码阶段保证 JSON 合法
 *   2. 使用 stream() 迭代事件，借鉴 AIChat 的实现模式
 *   3. 丢弃 thinking_delta 事件，只累积 toolcall_delta / text_delta
 *   4. 在最终 done 事件里从 message.content 提取 ToolCall.arguments
 *   5. 120 秒超时 + AbortController，避免 provider 悬挂
 */
async function extractAllWithLLM(
  messages: ChatMessage[],
  onProgress?: BatchProgressCallback,
  globalNicknames: string[] = []
): Promise<UnifiedExtractionResult> {
  const empty: UnifiedExtractionResult = {
    tasks: [],
    todos: [],
    focus: [],
    faqs: [],
    concepts: [],
    documents: [],
    procedures: [],
    tips: [],
    graph: { entities: [], relationships: [] },
  }
  const config = getActiveConfig()
  if (!config) {
    console.warn('[ExtractionRunner] No active LLM config, skipping unified extraction')
    return empty
  }

  const model = buildPiModel(config)

  const myIdentitySection =
    globalNicknames.length > 0
      ? `【我是谁】\n用户（"我"）在聊天中使用以下昵称/ID：${globalNicknames.map((n) => `"${n}"`).join('、')}。凡是消息中以 @、"@名字"、或直接点名这些昵称的方式指向"我"的，都视为对"我"说话。\n\n`
      : `【我是谁】\n用户尚未配置主昵称，本批次不提取 todos（返回空数组）。\n\n`

  const todoRule =
    globalNicknames.length > 0
      ? `- todos（待办）：**只提取别人对"我"发出的、没有明确时间的请求或委托**。必须同时满足：(a) 消息 @我 或 直接点名我的昵称（见【我是谁】）；(b) 内容是让"我"去做某事或提醒"我"注意某事；(c) 没有明确的截止日期或时间点（有时间的归 tasks）。title 从"我"的视角表述（例如"回复小明关于 X 的问题"）；requesterName 写提出请求的人；mentionType 填 at_me 或 name_me。非针对"我"的事项一律不要放进 todos。`
      : `- todos（待办）：本次不提取，返回空数组。`

  const userPrompt = `以下是一段群聊记录，请调用 save_extracted_info 工具一次性提取其中多类信息。

${myIdentitySection}【群聊记录】
${formatMessagesForLLM(messages)}

【分类规则】
- tasks（任务）：有明确负责人 / 交付物 / 截止日期的正式工作项。
${todoRule}
- focus（关注点）：反复出现、值得持续跟踪的事项。形式是"某人关注某事"——watcher 字段写关注者显示名，title 写关注的对象。若全群共同关注则 watcher 留空。type=person 用于"被关注的人物"本身。
- faqs（问答）：只提取明确的 Q&A 交互（谁问、谁答）。
- concepts（概念）：技术名词/业务术语的定义和解释，例如"WebSocket 是..."。
- documents（文档）：群聊里提到的 wiki / confluence / notion / github 链接，Figma 设计稿，需求文档。content 要包含 URL。
- tips（技巧）：最佳实践、避坑经验、快捷方法。
- procedures（流程）：分步骤的 SOP、上线流程、故障处理顺序。
- graph.entities 的 name 全局唯一；graph.relationships 的 sourceName / targetName 必须能在 entities 中找到。
- 所有 confidence 必填，范围 [0, 1]；任何类别无内容返回空数组。
- 直接调用工具，不要输出任何解释性文字。`

  const context: PiContext = {
    systemPrompt:
      '你是一个结构化信息提取助手。你必须通过调用 save_extracted_info 工具来返回结果，不要输出普通文本、思考过程或代码块。每次都只调用一次工具。',
    messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
    tools: [extractionTool as PiTool],
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)

  try {
    console.log(`[ExtractionRunner] Unified LLM stream start, ${messages.length} messages`)

    // 使用 stream() 而不是 completeSimple()，目的：
    //   - 可以在事件层面过滤 thinking_*
    //   - 可以把 token 增长实时上报给 UI
    //   - 单次 tool_call 完成后立刻拿到结构化 arguments
    const eventStream = piStream(model, context, {
      apiKey: config.apiKey,
      temperature: 0.1,
      maxTokens: 8000,
      signal: controller.signal,
      // 强制 provider 调用工具而不是自由回复，OpenAI-compat 端点普遍支持
      toolChoice: { type: 'function', function: { name: 'save_extracted_info' } },
    } as any)

    let textTokens = 0
    let toolTokens = 0
    for await (const evt of eventStream) {
      switch (evt.type) {
        case 'text_delta':
          textTokens += evt.delta.length
          onProgress?.({ textTokens, toolTokens })
          break
        case 'toolcall_delta':
          toolTokens += evt.delta.length
          onProgress?.({ textTokens, toolTokens })
          break
        case 'thinking_delta':
          // 显式丢弃，不污染任何下游逻辑
          break
        case 'error':
          console.error('[ExtractionRunner] Unified stream error:', evt.error.errorMessage || evt.reason)
          return empty
      }
    }

    const final = await eventStream.result()
    // 找到第一个 toolCall 块，取 arguments
    const toolCall = final.content.find((c): c is Extract<typeof c, { type: 'toolCall' }> => c.type === 'toolCall')
    if (!toolCall || toolCall.name !== 'save_extracted_info') {
      // 兜底：如果 provider 没支持 tool_choice（少数情况），尝试从 text 块 parse JSON
      const fallbackText = final.content
        .filter((c): c is PiTextContent => c.type === 'text')
        .map((c) => c.text)
        .join('')
        .trim()
      if (!fallbackText) {
        console.warn('[ExtractionRunner] Unified LLM returned no tool call')
        return empty
      }
      console.warn('[ExtractionRunner] No tool call, falling back to raw text parse')
      return parseRawJsonFallback(fallbackText, empty)
    }

    const args = toolCall.arguments as Partial<UnifiedExtractionResult>
    return sanitizeUnifiedResult(args, empty)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    if (controller.signal.aborted) {
      console.error('[ExtractionRunner] Unified LLM call aborted (120s timeout)')
    } else {
      console.error('[ExtractionRunner] Unified LLM extraction failed:', errMsg)
    }
    return empty
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 应用字段校验和置信度过滤，保证下游入库逻辑拿到的数据干净
 */
function sanitizeUnifiedResult(
  parsed: Partial<UnifiedExtractionResult>,
  empty: UnifiedExtractionResult
): UnifiedExtractionResult {
  try {
    const filterKnowledge = (arr: any[] | undefined) =>
      (arr || []).filter(
        (k) =>
          k?.title &&
          typeof k.content === 'string' &&
          k.content.trim() &&
          typeof k.confidence === 'number' &&
          k.confidence >= 0.6
      ) as ExtractedKnowledge[]
    return {
      tasks: (parsed.tasks || []).filter((t) => t?.title && typeof t.confidence === 'number' && t.confidence >= 0.6),
      todos: (parsed.todos || []).filter((t) => t?.title && typeof t.confidence === 'number' && t.confidence >= 0.5),
      focus: (parsed.focus || []).filter((f) => f?.title && typeof f.confidence === 'number' && f.confidence >= 0.6),
      faqs: (parsed.faqs || []).filter(
        (f) => f?.question && f?.answer && typeof f.confidence === 'number' && f.confidence >= 0.6
      ),
      concepts: filterKnowledge(parsed.concepts),
      documents: filterKnowledge(parsed.documents),
      procedures: filterKnowledge(parsed.procedures),
      tips: filterKnowledge(parsed.tips),
      graph: {
        entities: (parsed.graph?.entities || []).filter(
          (e) => e?.name && typeof e.confidence === 'number' && e.confidence >= 0.5
        ),
        relationships: (parsed.graph?.relationships || []).filter(
          (r) => r?.sourceName && r?.targetName && typeof r.confidence === 'number' && r.confidence >= 0.5
        ),
      },
    }
  } catch (err) {
    console.error('[ExtractionRunner] sanitizeUnifiedResult failed:', err)
    return empty
  }
}

/**
 * 纯文本 JSON 兜底解析——仅当 provider 不支持 tool_choice 强制约束时触发
 */
function parseRawJsonFallback(raw: string, empty: UnifiedExtractionResult): UnifiedExtractionResult {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```json|```/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return empty
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<UnifiedExtractionResult>
    return sanitizeUnifiedResult(parsed, empty)
  } catch (err) {
    console.error('[ExtractionRunner] Fallback JSON parse failed:', (err as Error).message)
    return empty
  }
}

function deduplicateTodos(todos: ExtractedTodo[]): ExtractedTodo[] {
  const seen = new Map<string, ExtractedTodo>()
  for (const t of todos) {
    const key = t.title.toLowerCase().trim()
    const existing = seen.get(key)
    if (!existing || t.confidence > existing.confidence) {
      seen.set(key, t)
    }
  }
  return Array.from(seen.values())
}

/**
 * 启动统一多类型提取（异步，不阻塞）
 * 使用一次 LLM 调用覆盖 tasks/todos/focus/faqs/graph 五类输出
 * 进度事件 jobType='all'，监听器通过 sessionId 判断归属
 */
export async function startUnifiedExtraction(
  sessionId: string,
  win: BrowserWindow,
  forceRerun: boolean = false,
  globalNicknames: string[] = []
): Promise<void> {
  const job = await extractionJobService.createJob(sessionId, 'all', forceRerun)

  // 不再因"已完成"而短路——允许反复重跑，由下游保存阶段的 dedup 兜底。
  // 若已有活跃任务（pending/running），createJob 会返回同一个 job；避免重复 start。
  if (job.status === 'running') {
    console.log('[ExtractionRunner] Unified extraction already in progress for session:', sessionId)
    return
  }

  extractionJobService.startJob(job.id)

  // 单调棘轮：由于批次滑窗重叠（batchSize=30, overlap=5）+ token 流式回调与批次完成
  // 计算基准不同（i 与 end），进度值在相邻事件之间会短暂回退（例如 30 → 25）。
  // 这里统一用一个 ratchet 包装 sendUnifiedProgress，确保上报值只增不减。
  let highestProgress = 0
  function reportProgress(progress: number, message: string) {
    const clamped = Math.min(100, Math.max(0, progress))
    // 允许 100 作为最终收尾信号（message 变化时即便同值也要发送最新文案）
    if (clamped < highestProgress && clamped < 100) return
    highestProgress = Math.max(highestProgress, clamped)
    sendUnifiedProgress(win, job.id, sessionId, highestProgress, message)
  }

  reportProgress(5, '开始读取消息（统一提取）...')

  try {
    const { messages: rawMessages, total } = await getAllRecentMessages(sessionId, undefined, 999999)
    console.log(`[ExtractionRunner] Unified extraction: ${total} messages for session ${sessionId}`)

    if (total === 0) {
      extractionJobService.finishJob(job.id, {})
      reportProgress(100, '无消息可分析')
      return
    }

    const messages: ChatMessage[] = rawMessages.map((m: any) => ({
      id: m.id,
      senderName: m.senderName || m.sender_name || '未知',
      content: m.content || '',
      timestamp: m.timestamp || m.ts || 0,
    }))

    // ========== 全量分析（取消增量过滤，每次都重新扫描全部消息）==========
    // 每条新纪录入库前都会走 dedup（taskService.findIdByNormalizedTitle 等），
    // 重复项会合并 source / 直接跳过，因此重复分析是安全的。
    const maxMessageId = messages.reduce((mx, m) => (m.id > mx ? m.id : mx), 0)

    reportProgress(10, `全量分析 · 共 ${messages.length} 条消息`)

    const batchSize = 30
    const overlap = 5
    if (batchSize <= overlap)
      throw new Error(`[ExtractionRunner] batchSize(${batchSize}) must be > overlap(${overlap})`)

    const allTasks: ExtractedTask[] = []
    const allTodos: ExtractedTodo[] = []
    const allFocus: ExtractedFocusItem[] = []
    const allFaqs: ExtractedFAQ[] = []
    const allConcepts: ExtractedKnowledge[] = []
    const allDocuments: ExtractedKnowledge[] = []
    const allProcedures: ExtractedKnowledge[] = []
    const allTips: ExtractedKnowledge[] = []
    const allEntities: ExtractedEntity[] = []
    const allRelationships: ExtractedRelationship[] = []

    for (let i = 0; i < messages.length; i += batchSize - overlap) {
      const end = Math.min(messages.length, i + batchSize)
      const batch = messages.slice(i, end)
      const batchLabel = `${i + 1}-${end}/${messages.length}`

      console.log(`[ExtractionRunner] Unified batch ${i}-${end} of ${messages.length}`)

      // 节流 token 进度：每 500ms 最多推一次，避免刷爆 IPC
      // 关键：token 回调和批次完成都用 `end / messages.length` 作为基准——批次结束位置
      // 是单调递增的（即使滑窗重叠，end 也永远不回退），配合外层 ratchet 可彻底消除回退。
      let lastPush = 0
      const res = await extractAllWithLLM(
        batch,
        ({ toolTokens }) => {
          const now = Date.now()
          if (now - lastPush < 500) return
          lastPush = now
          const progress = Math.min(85, 10 + Math.floor((end / messages.length) * 75))
          reportProgress(progress, `批次 ${batchLabel} · 生成中 ${toolTokens} 字符`)
        },
        globalNicknames
      )

      allTasks.push(...res.tasks)
      allTodos.push(...res.todos)
      allFocus.push(...res.focus)
      allFaqs.push(...res.faqs)
      allConcepts.push(...res.concepts)
      allDocuments.push(...res.documents)
      allProcedures.push(...res.procedures)
      allTips.push(...res.tips)
      allEntities.push(...res.graph.entities)
      allRelationships.push(...res.graph.relationships)

      const progress = Math.min(85, 10 + Math.floor((end / messages.length) * 75))
      reportProgress(
        progress,
        `已分析 ${end}/${messages.length} 条消息 · 累计 tasks=${allTasks.length} todos=${allTodos.length} focus=${allFocus.length} faqs=${allFaqs.length}`
      )
    }

    const dedupedTasks = deduplicateTasks(allTasks)
    const dedupedTodos = deduplicateTodos(allTodos)
    const dedupedFocus = deduplicateFocusItems(allFocus)
    const dedupedFaqs = deduplicateFAQs(allFaqs)
    const dedupedEntities = deduplicateEntities(allEntities)

    reportProgress(90, '正在保存全部结果...')

    // 1. Tasks —— createTask 只写主表，还要再写 task_source 才能被 getTasksBySession 查到
    // 跨批次去重：若 DB 中已有同标题任务（大小写/空白不敏感），不再新建，只追加 source
    let savedTasks = 0
    let mergedTasks = 0
    const firstMsgTs = messages[0]?.timestamp ?? Math.floor(Date.now() / 1000)
    const firstMsgId = messages[0]?.id ?? 0
    for (const task of dedupedTasks) {
      try {
        const existingId = taskService.findIdByNormalizedTitle(task.title)
        if (existingId != null) {
          taskService.addTaskSource(existingId, sessionId, firstMsgId, firstMsgTs, task.confidence)
          mergedTasks++
          continue
        }
        const taskData: Omit<GlobalTask, 'id' | 'createdTs' | 'updatedTs'> = {
          title: task.title,
          description: task.description,
          status: 'pending',
          priority: task.priority || 'normal',
          ownerDisplayName: task.ownerName,
          dueTs: (() => {
            if (!task.dueDate) return undefined
            const ts = new Date(task.dueDate).getTime()
            return isNaN(ts) ? undefined : ts
          })(),
          confidence: task.confidence,
          isManual: false,
          tags: [],
          metadata: { sessionId },
        }
        const taskId = taskService.createTask(taskData)
        taskService.addTaskSource(taskId, sessionId, firstMsgId, firstMsgTs, task.confidence)
        savedTasks++
      } catch (err) {
        console.error('[ExtractionRunner] Failed to save task:', err)
      }
    }
    if (mergedTasks > 0) {
      console.log(`[ExtractionRunner] Tasks: ${savedTasks} new, ${mergedTasks} merged into existing`)
    }

    // 2. Todos —— 本次提取语义：别人 @我 / 点名我 的无时间请求
    // 跨批次去重：(globalUserId, 归一化标题) 已存在则跳过
    let savedTodos = 0
    let skippedTodos = 0
    for (const todo of dedupedTodos) {
      try {
        if (todoService.findIdByNormalizedTitle('system', todo.title) != null) {
          skippedTodos++
          continue
        }
        const requesterPrefix = todo.requesterName ? `来自 ${todo.requesterName}：` : ''
        const mentionTag = todo.mentionType === 'at_me' ? '[@我]' : todo.mentionType === 'name_me' ? '[点名]' : ''
        const composedDescription = [requesterPrefix + (todo.description || ''), mentionTag]
          .filter((s) => s.trim())
          .join(' ')
          .trim()
        todoService.createTodo({
          globalUserId: 'system',
          title: todo.title,
          description: composedDescription || undefined,
          status: 'pending',
          priority: 'normal',
          progress: 0,
          tags: todo.mentionType ? [todo.mentionType] : [],
          isStarred: false,
          sourceType: 'manual',
          sourceSessionId: sessionId,
        })
        savedTodos++
      } catch (err) {
        console.error('[ExtractionRunner] Failed to save todo:', err)
      }
    }
    if (skippedTodos > 0) {
      console.log(`[ExtractionRunner] Todos: ${savedTodos} new, ${skippedTodos} skipped (duplicate)`)
    }

    // 3. Focus —— watcher 字段映射到 globalUserId，保留"谁在关注"的信息
    // 跨批次去重：(globalUserId, type, 归一化标题) 已存在则跳过
    let savedFocus = 0
    let skippedFocus = 0
    for (const item of dedupedFocus) {
      try {
        const userId = item.watcher || 'system'
        if (focusService.findIdByNormalizedTitle(userId, item.type, item.title) != null) {
          skippedFocus++
          continue
        }
        focusService.createFocusItem({
          globalUserId: userId,
          type: item.type,
          title: item.title,
          description: item.description,
          keywords: item.keywords,
          status: 'active',
          lastActivityTs: Date.now(),
        })
        savedFocus++
      } catch (err) {
        console.error('[ExtractionRunner] Failed to save focus item:', err)
      }
    }
    if (skippedFocus > 0) {
      console.log(`[ExtractionRunner] Focus: ${savedFocus} new, ${skippedFocus} skipped (duplicate)`)
    }

    // 4. FAQs（跨会话去重）
    let savedFaqs = 0
    try {
      const existingFAQs = knowledgeService.queryItems({ type: ['faq'] })
      const existingTitles = existingFAQs.map((f) => f.title.toLowerCase().trim())
      for (const faq of dedupedFaqs) {
        try {
          const newTitle = faq.question.toLowerCase().trim()
          const isDuplicate = existingTitles.some((existing) => {
            const longer = Math.max(existing.length, newTitle.length)
            if (longer === 0) return true
            const distance = levenshteinSimple(existing, newTitle)
            return 1 - distance / longer >= 0.8
          })
          if (isDuplicate) continue
          knowledgeService.createItem({
            type: 'faq',
            title: faq.question,
            content: faq.answer,
            category: faq.category,
            tags: [],
            sourceSessionIds: [sessionId],
            sourceMessageRefs: [],
            confidence: faq.confidence,
            isEdited: false,
            status: 'active',
          })
          existingTitles.push(newTitle)
          savedFaqs++
        } catch (err) {
          console.error('[ExtractionRunner] Failed to save FAQ:', err)
        }
      }
    } catch (err) {
      console.error('[ExtractionRunner] FAQ save phase failed:', err)
    }

    // 5. Concepts / Documents / Procedures / Tips —— 写入 knowledge_item 表
    const saveKnowledgeBatch = (items: ExtractedKnowledge[], kType: 'concept' | 'document' | 'procedure' | 'tip') => {
      let count = 0
      const existing = knowledgeService.queryItems({ type: [kType] })
      const existingTitles = existing.map((f) => f.title.toLowerCase().trim())
      const seenInThisBatch = new Set<string>()
      for (const k of items) {
        try {
          const norm = k.title.toLowerCase().trim()
          if (seenInThisBatch.has(norm)) continue
          const isDup = existingTitles.some((e) => {
            const longer = Math.max(e.length, norm.length)
            if (longer === 0) return true
            return 1 - levenshteinSimple(e, norm) / longer >= 0.85
          })
          if (isDup) continue
          knowledgeService.createItem({
            type: kType,
            title: k.title,
            content: k.content,
            category: k.category,
            tags: [],
            sourceSessionIds: [sessionId],
            sourceMessageRefs: [],
            confidence: k.confidence,
            isEdited: false,
            status: 'active',
          })
          seenInThisBatch.add(norm)
          count++
        } catch (err) {
          console.error(`[ExtractionRunner] Failed to save ${kType}:`, err)
        }
      }
      return count
    }

    const savedConcepts = saveKnowledgeBatch(allConcepts, 'concept')
    const savedDocuments = saveKnowledgeBatch(allDocuments, 'document')
    const savedProcedures = saveKnowledgeBatch(allProcedures, 'procedure')
    const savedTips = saveKnowledgeBatch(allTips, 'tip')

    // 6. Graph
    let savedNodes = 0
    let savedEdges = 0
    try {
      const res = await saveGraphData(dedupedEntities, allRelationships, sessionId, messages)
      savedNodes = res.savedNodes
      savedEdges = res.savedEdges
    } catch (err) {
      console.error('[ExtractionRunner] Graph save phase failed:', err)
    }

    extractionJobService.finishJob(job.id, {
      tasksExtracted: savedTasks,
      todosExtracted: savedTodos,
      focusExtracted: savedFocus,
      faqExtracted: savedFaqs,
      conceptsExtracted: savedConcepts,
      documentsExtracted: savedDocuments,
      proceduresExtracted: savedProcedures,
      tipsExtracted: savedTips,
      nodesExtracted: savedNodes,
      edgesExtracted: savedEdges,
      // 保留最后一次扫描到的消息 ID 作为审计信息（不再用于增量跳过）
      lastAnalyzedMessageId: maxMessageId,
      mode: 'full',
    })

    reportProgress(
      100,
      `完成：${savedTasks} 任务 / ${savedTodos} 待办 / ${savedFocus} 关注点 / ${savedFaqs} 问答 / ${savedConcepts + savedDocuments + savedProcedures + savedTips} 知识 / ${savedNodes} 实体`
    )

    win.webContents.send('collab:extractionDone', {
      jobId: job.id,
      sessionId,
      jobType: 'all',
      result: {
        tasksExtracted: savedTasks,
        todosExtracted: savedTodos,
        focusExtracted: savedFocus,
        faqExtracted: savedFaqs,
        conceptsExtracted: savedConcepts,
        documentsExtracted: savedDocuments,
        proceduresExtracted: savedProcedures,
        tipsExtracted: savedTips,
        nodesExtracted: savedNodes,
        edgesExtracted: savedEdges,
      },
    })

    console.log(
      `[ExtractionRunner] Unified extraction done for ${sessionId}: ` +
        `tasks=${savedTasks} todos=${savedTodos} focus=${savedFocus} faqs=${savedFaqs} ` +
        `concepts=${savedConcepts} documents=${savedDocuments} procedures=${savedProcedures} tips=${savedTips} ` +
        `nodes=${savedNodes} edges=${savedEdges}`
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[ExtractionRunner] Unified extraction failed:', errMsg)
    extractionJobService.failJob(job.id, 'UNIFIED_EXTRACTION_ERROR', errMsg)
    win.webContents.send('collab:extractionError', {
      jobId: job.id,
      sessionId,
      jobType: 'all',
      error: errMsg,
    })
  }
}

function sendUnifiedProgress(
  win: BrowserWindow,
  jobId: string,
  sessionId: string,
  progress: number,
  message: string
): void {
  extractionJobService.updateProgress(jobId, progress, message)
  win.webContents.send('collab:extractionProgress', {
    jobId,
    sessionId,
    jobType: 'all',
    progress,
    message,
  })
}
