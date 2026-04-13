/**
 * 网络设置 IPC 处理器
 * 处理代理配置的读取、保存和测试
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import {
  loadProxyConfig,
  saveProxyConfig,
  testProxyConnection,
  validateProxyUrl,
  type ProxyConfig,
} from '../network/proxy'

/**
 * 注册网络设置相关的 IPC 处理器
 */
export function registerNetworkHandlers(_context: IpcContext): void {
  console.log('[IpcMain] Registering network handlers...')

  /**
   * 获取代理配置
   */
  ipcMain.handle('network:getProxyConfig', (): ProxyConfig => {
    try {
      return loadProxyConfig()
    } catch (error) {
      console.error('[IpcMain] network:getProxyConfig failed:', error)
      return { mode: 'system', url: '' } as ProxyConfig
    }
  })

  /**
   * 保存代理配置
   */
  ipcMain.handle('network:saveProxyConfig', (_event, config: ProxyConfig): { success: boolean; error?: string } => {
    try {
      if (!config || typeof config !== 'object') {
        return { success: false, error: 'invalid config' }
      }
      // 如果是手动模式且填写了 URL，验证 URL 格式
      if (config.mode === 'manual' && config.url) {
        const validation = validateProxyUrl(config.url)
        if (!validation.valid) {
          return { success: false, error: validation.error }
        }
      }

      saveProxyConfig(config)
      return { success: true }
    } catch (error) {
      console.error('[IpcMain] network:saveProxyConfig failed:', error)
      return { success: false, error: '保存配置失败' }
    }
  })

  /**
   * 测试代理连接
   */
  ipcMain.handle(
    'network:testProxyConnection',
    async (_event, proxyUrl: string): Promise<{ success: boolean; error?: string }> => {
      if (typeof proxyUrl !== 'string' || !proxyUrl) return { success: false, error: 'invalid proxyUrl' }
      return testProxyConnection(proxyUrl)
    }
  )

  console.log('[IpcMain] Network handlers registered')
}
