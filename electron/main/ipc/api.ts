/**
 * ChatLab API — IPC handlers for renderer process
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as apiServer from '../api'
import { loadConfig, regenerateToken, updateConfig } from '../api/config'
import { loadDataSources, addDataSource, updateDataSource, deleteDataSource, type DataSource } from '../api/dataSource'
import { initScheduler, stopAllTimers, reloadTimer, triggerPull } from '../api/pullScheduler'

export function registerApiHandlers(_ctx: IpcContext): void {
  // ==================== API Server Management ====================

  ipcMain.handle('api:getConfig', () => {
    try {
      const config = loadConfig()
      return {
        enabled: config.enabled,
        port: config.port,
        token: config.token,
        createdAt: config.createdAt,
      }
    } catch (error) {
      console.error('[IpcMain] api:getConfig failed:', error)
      return null
    }
  })

  ipcMain.handle('api:getStatus', () => {
    try {
      return apiServer.getStatus()
    } catch (error) {
      console.error('[IpcMain] api:getStatus failed:', error)
      return { running: false, error: String(error) }
    }
  })

  ipcMain.handle('api:setEnabled', async (_event, enabled: boolean) => {
    try {
      return await apiServer.setEnabled(enabled)
    } catch (error) {
      console.error('[IpcMain] api:setEnabled failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('api:setPort', async (_event, port: number) => {
    try {
      return await apiServer.setPort(port)
    } catch (error) {
      console.error('[IpcMain] api:setPort failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('api:regenerateToken', () => {
    try {
      return regenerateToken()
    } catch (error) {
      console.error('[IpcMain] api:regenerateToken failed:', error)
      return null
    }
  })

  ipcMain.handle('api:updateConfig', (_event, partial: Record<string, unknown>) => {
    try {
      return updateConfig(partial as any)
    } catch (error) {
      console.error('[IpcMain] api:updateConfig failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== Data Source Management ====================

  ipcMain.handle('api:getDataSources', () => {
    try {
      return loadDataSources()
    } catch (error) {
      console.error('[IpcMain] api:getDataSources failed:', error)
      return []
    }
  })

  ipcMain.handle(
    'api:addDataSource',
    (
      _event,
      partial: Omit<DataSource, 'id' | 'createdAt' | 'lastPullAt' | 'lastStatus' | 'lastError' | 'lastNewMessages'>
    ) => {
      try {
        const ds = addDataSource(partial)
        if (ds.enabled) {
          reloadTimer(ds.id)
        }
        return ds
      } catch (error) {
        console.error('[IpcMain] api:addDataSource failed:', error)
        return null
      }
    }
  )

  ipcMain.handle('api:updateDataSource', (_event, id: string, updates: Partial<DataSource>) => {
    try {
      const ds = updateDataSource(id, updates)
      if (ds) {
        reloadTimer(ds.id)
      }
      return ds
    } catch (error) {
      console.error('[IpcMain] api:updateDataSource failed:', error)
      return null
    }
  })

  ipcMain.handle('api:deleteDataSource', (_event, id: string) => {
    try {
      reloadTimer(id) // stops timer
      return deleteDataSource(id)
    } catch (error) {
      console.error('[IpcMain] api:deleteDataSource failed:', error)
      return false
    }
  })

  ipcMain.handle('api:triggerPull', async (_event, id: string) => {
    try {
      return await triggerPull(id)
    } catch (error) {
      console.error('[IpcMain] api:triggerPull failed:', error)
      return { success: false, error: String(error) }
    }
  })
}

/**
 * Auto-start API server and Pull scheduler after app launch
 */
export async function initApiServer(ctx: IpcContext): Promise<void> {
  await apiServer.autoStart()

  const status = apiServer.getStatus()
  if (status.error) {
    ctx.win.webContents.once('did-finish-load', () => {
      ctx.win.webContents.send('api:startupError', {
        error: status.error,
      })
    })
  }

  // Initialize Pull scheduler (independent of API server, pulls even if API is not running)
  initScheduler()
}

export async function cleanupApiServer(): Promise<void> {
  stopAllTimers()
  await apiServer.stop()
}
