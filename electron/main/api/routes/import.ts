/**
 * ChatLab API — Import routes (Push mode)
 *
 * POST /api/v1/import              Import to new session
 * POST /api/v1/sessions/:id/import Incremental import to existing session
 *
 * Content-Type dispatch:
 *   application/json     → parse body → temp .json → chatlab parser
 *   application/x-ndjson → pipe raw stream → temp .jsonl → chatlab-jsonl parser
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { getTempDir } from '../../paths'
import * as worker from '../../worker/workerManager'
import { startUnifiedExtraction } from '../../services/extractionRunner'
import {
  successResponse,
  sessionNotFound,
  importInProgress,
  importFailed,
  invalidFormat,
  errorResponse,
} from '../errors'

let isImporting = false

function getTempFilePath(ext: string): string {
  const id = crypto.randomBytes(8).toString('hex')
  return path.join(getTempDir(), `api-import-${id}${ext}`)
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (err) {
    console.error('[ChatLab API] Failed to cleanup temp file:', err)
  }
}

/**
 * Notify renderer process to refresh session list.
 * Lazy-requires electron to avoid circular dependency.
 */
function notifySessionListChanged(): void {
  try {
    const { BrowserWindow } = require('electron')
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      win.webContents.send('api:importCompleted')
    }
  } catch {
    // ignore
  }
}

export function getImportingStatus(): boolean {
  return isImporting
}

async function handleImport(request: FastifyRequest, reply: FastifyReply, sessionId?: string): Promise<void> {
  if (isImporting) {
    const err = importInProgress()
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  const contentType = (request.headers['content-type'] || '').toLowerCase()
  const isJsonl = contentType.includes('application/x-ndjson')
  const isJson = contentType.includes('application/json')

  if (!isJsonl && !isJson) {
    const err = invalidFormat('Content-Type must be application/json or application/x-ndjson')
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  isImporting = true
  let tempFile = ''

  try {
    if (isJson) {
      // JSON mode: fastify already parsed body, write to temp file
      const body = request.body
      if (!body || typeof body !== 'object') {
        const err = invalidFormat('Request body is not valid JSON')
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }

      tempFile = getTempFilePath('.json')
      fs.writeFileSync(tempFile, JSON.stringify(body), 'utf-8')
    } else {
      // JSONL mode: pipe raw stream to temp file
      tempFile = getTempFilePath('.jsonl')
      const writeStream = fs.createWriteStream(tempFile)
      await pipeline(request.raw, writeStream)
    }

    let result: any

    if (sessionId) {
      // Incremental import to specified session
      const session = await worker.getSession(sessionId)
      if (!session) {
        const err = sessionNotFound(sessionId)
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }

      result = await worker.incrementalImport(sessionId, tempFile)

      if (result.success) {
        try {
          await worker.generateIncrementalSessions(sessionId)
        } catch {
          // non-blocking
        }

        notifySessionListChanged()

        reply.send(
          successResponse({
            mode: 'incremental',
            sessionId,
            newMessageCount: result.newMessageCount,
          })
        )
        return
      } else {
        const err = importFailed(result.error || 'Incremental import failed')
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }
    } else {
      // New session import
      result = await worker.streamImport(tempFile)

      if (result.success) {
        notifySessionListChanged()

        // 与 IPC 导入路径保持一致：新会话导入后异步触发统一提取
        if (result.sessionId) {
          setImmediate(() => {
            try {
              const { BrowserWindow } = require('electron')
              const win = BrowserWindow.getAllWindows()[0]
              if (win) {
                // 从身份缓存读取 globalNicknames，让 todos 语义过滤生效
                const { getGlobalNicknames } = require('../../identity/cache')
                startUnifiedExtraction(result.sessionId!, win, false, getGlobalNicknames()).catch((err: unknown) => {
                  console.error('[ChatLab API] Unified extraction failed:', err)
                })
              }
            } catch (err) {
              console.error('[ChatLab API] Failed to trigger extraction:', err)
            }
          })
        }

        reply.send(
          successResponse({
            mode: 'new',
            sessionId: result.sessionId,
          })
        )
        return
      } else {
        const err = importFailed(result.error || 'Import failed')
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }
    }
  } catch (error: any) {
    console.error('[ChatLab API] Import error:', error)
    const err = importFailed('Import process error')
    reply.code(err.statusCode).send(errorResponse(err))
  } finally {
    isImporting = false
    if (tempFile) {
      cleanupTempFile(tempFile)
    }
  }
}

export function registerImportRoutes(server: FastifyInstance): void {
  // JSONL mode: skip fastify's default body parsing, use request.raw stream directly
  server.addContentTypeParser('application/x-ndjson', (_request, _payload, done) => {
    done(null, undefined)
  })

  // POST /api/v1/import — Import to new session
  server.post('/api/v1/import', async (request, reply) => {
    await handleImport(request, reply)
  })

  // POST /api/v1/sessions/:id/import — Incremental import to existing session
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/import', async (request, reply) => {
    await handleImport(request, reply, request.params.id)
  })

  // POST /api/v1/sessions/:id/extract — 手动触发统一提取（开发调试用）
  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/extract', async (request, reply) => {
    try {
      const { BrowserWindow } = require('electron')
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) {
        reply.code(500).send(errorResponse(importFailed('No browser window available')))
        return
      }
      // 后台异步跑，立即返回；force=true 强制重跑
      setImmediate(() => {
        const { getGlobalNicknames } = require('../../identity/cache')
        startUnifiedExtraction(request.params.id, win, true, getGlobalNicknames()).catch((err: unknown) => {
          console.error('[ChatLab API] Manual unified extraction failed:', err)
        })
      })
      reply.send(successResponse({ triggered: true, sessionId: request.params.id }))
    } catch (err: any) {
      console.error('[ChatLab API] extract trigger failed:', err)
      reply.code(500).send(errorResponse(importFailed(String(err?.message || err))))
    }
  })
}
