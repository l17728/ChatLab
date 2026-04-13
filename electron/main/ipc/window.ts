/**
 * 窗口和文件系统操作 IPC 处理器
 */

import { ipcMain, app, dialog, clipboard, shell, nativeTheme } from 'electron'
import * as fs from 'fs/promises'
import type { IpcContext } from './types'
import { simulateUpdateDialog, manualCheckForUpdates } from '../update'
import { t } from '../i18n'

type AppWithQuitFlag = typeof app & { isQuiting?: boolean }
// 通过类型扩展记录应用退出意图，避免使用 @ts-ignore。
const appWithQuitFlag = app as AppWithQuitFlag

/**
 * 注册窗口和文件系统操作 IPC 处理器
 */
export function registerWindowHandlers(ctx: IpcContext): void {
  const { win } = ctx

  // ==================== 窗口操作 ====================
  ipcMain.on('window-min', (ev) => {
    try {
      ev.preventDefault()
      win.minimize()
    } catch (error) {
      console.error('[IpcMain] window-min failed:', error)
    }
  })

  ipcMain.on('window-maxOrRestore', (ev) => {
    try {
      const winSizeState = win.isMaximized()
      if (winSizeState) {
        win.restore()
      } else {
        win.maximize()
      }
      ev.reply('windowState', win.isMaximized())
    } catch (error) {
      console.error('[IpcMain] window-maxOrRestore failed:', error)
    }
  })

  ipcMain.on('window-restore', () => {
    try {
      win.restore()
    } catch (error) {
      console.error('[IpcMain] window-restore failed:', error)
    }
  })

  ipcMain.on('window-hide', () => {
    try {
      win.hide()
    } catch (error) {
      console.error('[IpcMain] window-hide failed:', error)
    }
  })

  ipcMain.on('window-close', () => {
    try {
      win.close()
      appWithQuitFlag.isQuiting = true
      app.quit()
    } catch (error) {
      console.error('[IpcMain] window-close failed:', error)
    }
  })

  ipcMain.on('window-resize', (_, data) => {
    try {
      if (!data || typeof data !== 'object') return
      if (data.resize) {
        win.setResizable(true)
      } else {
        win.setSize(1180, 752)
        win.setResizable(false)
      }
    } catch (error) {
      console.error('[IpcMain] window-resize failed:', error)
    }
  })

  ipcMain.on('open-devtools', () => {
    try {
      win.webContents.openDevTools()
    } catch (error) {
      console.error('[IpcMain] open-devtools failed:', error)
    }
  })

  // 设置主题模式
  ipcMain.on('window:setThemeSource', (_, mode: 'system' | 'light' | 'dark') => {
    try {
      nativeTheme.themeSource = mode

      // Windows 上动态更新 overlay 颜色以匹配主题
      if (process.platform === 'win32' && win) {
        const isDark = nativeTheme.shouldUseDarkColors
        win.setTitleBarOverlay({
          color: isDark ? '#111827' : '#f9fafb', // dark: gray-900, light: gray-50
          symbolColor: isDark ? '#a1a1aa' : '#52525b', // dark: zinc-400, light: zinc-600
          height: 32,
        })
      }
    } catch (error) {
      console.error('[IpcMain] window:setThemeSource failed:', error)
    }
  })

  // ==================== 应用信息 ====================
  ipcMain.handle('app:getVersion', () => {
    try {
      return app.getVersion()
    } catch (error) {
      console.error('[IpcMain] app:getVersion failed:', error)
      return ''
    }
  })

  // 重启应用
  ipcMain.handle('app:relaunch', () => {
    try {
      app.relaunch()
      app.quit()
    } catch (error) {
      console.error('[IpcMain] app:relaunch failed:', error)
    }
  })

  // 获取远程配置（支持 JSON 和纯文本/Markdown）
  ipcMain.handle('app:fetchRemoteConfig', async (_, url: string) => {
    if (typeof url !== 'string' || !url) return { success: false, error: 'invalid url' }
    // SSRF guard: only allow http/https URLs
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { success: false, error: 'invalid url' }
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      console.warn('[IpcMain] app:fetchRemoteConfig blocked non-http URL:', parsed.protocol)
      return { success: false, error: 'invalid url: only https/http allowed' }
    }
    try {
      const response = await fetch(url)
      const contentType = response.headers.get('content-type') || ''

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
      }

      // 根据 Content-Type 或 URL 后缀决定解析方式
      const isJson = contentType.includes('application/json') || url.endsWith('.json')

      if (isJson) {
        const data = await response.json()
        return { success: true, data }
      } else {
        // 纯文本/Markdown 等其他格式
        const data = await response.text()
        return { success: true, data }
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // ==================== 更新检查 ====================
  ipcMain.on('check-update', () => {
    try {
      manualCheckForUpdates()
    } catch (error) {
      console.error('[IpcMain] check-update failed:', error)
    }
  })

  // 模拟更新弹窗（仅开发模式使用）
  ipcMain.on('simulate-update', () => {
    try {
      if (!app.isPackaged) {
        simulateUpdateDialog(win)
      }
    } catch (error) {
      console.error('[IpcMain] simulate-update failed:', error)
    }
  })

  // ==================== 通用工具 ====================
  ipcMain.handle('show-message', (event, args) => {
    event.sender.send('show-message', args)
  })

  // 复制到剪贴板（文本）
  ipcMain.handle('copyData', async (_, data) => {
    try {
      clipboard.writeText(data)
      return true
    } catch (error) {
      console.error('Copy operation error:', error)
      return false
    }
  })

  // 复制图片到剪贴板（base64 data URL）
  ipcMain.handle('copyImage', async (_, dataUrl: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl) return { success: false, error: 'invalid dataUrl' }
    try {
      // 从 data URL 中提取 base64 数据
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      // 使用 nativeImage 创建图片并写入剪贴板
      const { nativeImage } = await import('electron')
      const image = nativeImage.createFromBuffer(imageBuffer)
      clipboard.writeImage(image)
      return { success: true }
    } catch (error) {
      console.error('Image copy error:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 文件系统操作 ====================
  // 选择文件夹
  ipcMain.handle('selectDir', async (_, defaultPath = '') => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: t('dialog.selectDirectory'),
        defaultPath: defaultPath || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: t('dialog.selectFolder'),
      })
      if (!canceled) {
        return filePaths[0]
      }
      return null
    } catch (err) {
      console.error(t('dialog.selectFolderError'), err)
      return null
    }
  })

  // 检查文件是否存在
  ipcMain.handle('checkFileExist', async (_, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return false
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 在文件管理器中打开
  ipcMain.handle('openInFolder', async (_, dirPath) => {
    if (typeof dirPath !== 'string' || !dirPath) return false
    try {
      await fs.access(dirPath)
      await shell.showItemInFolder(dirPath)
      return true
    } catch (error) {
      console.error('Error opening directory:', error)
      return false
    }
  })

  // 显示打开对话框（通用）
  ipcMain.handle('dialog:showOpenDialog', async (_, options) => {
    try {
      if (!options || typeof options !== 'object') return { canceled: true, filePaths: [] }
      // 指定 parent window，避免无主窗口时对话框无法聚焦/不弹出
      return await dialog.showOpenDialog(win, options)
    } catch (error) {
      console.error('[IpcMain] dialog:showOpenDialog failed:', error)
      return { canceled: true, filePaths: [] }
    }
  })
}
