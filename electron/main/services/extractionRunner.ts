/**
 * AI 提取执行服务（主进程异步运行）
 * 导入完成后从聊天记录中提取任务，推送进度到渲染进程
 * 使用主进程事件循环异步运行，直接复用 LLM 模块
 */

import type { BrowserWindow } from 'electron'
import { getAllRecentMessages } from '../worker/query/messages'
import { taskService } from './taskService'
import { graphService } from './graphService'
import { knowledgeService } from './knowledgeService'
import { focusService } from './focusService'
import { extractionJobService } from '../database/global/extraction'
import { getActiveConfig, buildPiModel } from '../ai/llm'
import { completeSimple, type TextContent as PiTextContent } from '@mariozechner/pi-ai'
import type { GlobalTask } from './taskService'

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
  const m = a.length, n = b.length
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
    const relationships = (parsed.relationships || []).filter((r) => r.sourceName && r.targetName && r.confidence >= 0.5)

    console.log(`[ExtractionRunner] Graph LLM extracted ${entities.length} entities, ${relationships.length} relationships`)
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

  // 保存实体节点
  let savedNodes = 0
  for (const entity of entities) {
    try {
      // 找到该实体第一次出现的消息引用
      const messageRef = messages.find((m) =>
        m.content.includes(entity.name) || m.content.includes(entity.displayName || '')
      )
      const nodeId = graphService.upsertNode({
        type: entity.type,
        isCoreType: ['person', 'project', 'technology', 'organization'].includes(entity.type),
        name: entity.name,
        displayName: entity.displayName,
        properties: entity.properties || {},
        firstSeenTs: messageRef?.timestamp || now,
        lastSeenTs: now,
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
        console.warn(`[ExtractionRunner] Skipping edge: cannot find nodes for "${rel.sourceName}" -> "${rel.targetName}"`)
        continue
      }
      graphService.upsertEdge({
        type: rel.relationType,
        isCoreType: ['assigned_to', 'uses', 'belongs_to', 'leads'].includes(rel.relationType),
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        properties: rel.properties || {},
        firstSeenTs: now,
        lastSeenTs: now,
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
export async function startGraphExtraction(
  sessionId: string,
  win: BrowserWindow
): Promise<void> {
  // 1. 创建/获取提取任务（去重）
  const job = await extractionJobService.createJob(sessionId, 'graph')

  if (job.status === 'done') {
    console.log('[ExtractionRunner] Graph extraction already done for session:', sessionId)
    return
  }

  extractionJobService.startJob(job.id)
  sendGraphProgress(win, job.id, sessionId, 5, '开始读取消息（图谱提取）...')

  try {
    const { messages: rawMessages, total } = getAllRecentMessages(sessionId, undefined, 999999)
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
    console.log(`[ExtractionRunner] Graph: ${deduplicated.length} unique entities, ${allRelationships.length} relationships`)

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

    console.log(`[ExtractionRunner] Graph extraction done: ${savedNodes} nodes, ${savedEdges} edges for session ${sessionId}`)
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
export async function startTaskExtraction(
  sessionId: string,
  win: BrowserWindow
): Promise<void> {
  // 1. 创建/获取提取任务（去重）
  let job = await extractionJobService.createJob(sessionId, 'tasks')

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
    const { messages: rawMessages, total } = getAllRecentMessages(sessionId, undefined, 999999)

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
          dueTs: task.dueDate ? new Date(task.dueDate).getTime() : undefined,
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

function sendProgress(
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
    const { messages: rawMessages, total } = getAllRecentMessages(sessionId, undefined, 999999)
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
  type: 'topic' | 'person' | 'task' | 'project' | 'keyword'
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
    const { messages: rawMessages, total } = getAllRecentMessages(sessionId, undefined, 999999)
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
