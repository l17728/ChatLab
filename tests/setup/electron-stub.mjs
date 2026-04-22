/**
 * 测试用 electron 模块桩
 *
 * 主进程代码（包括 paths.ts / logger.ts / database/global/index.ts 等）都会
 * `import { app, ipcMain, BrowserWindow, shell } from 'electron'`。
 * 在真正的 Electron runtime 之外这些 binding 不存在——`node --test` 就会直接
 * 抛 ERR_MODULE_NOT_FOUND。
 *
 * 这个桩只提供 **最小可运行面**：app.getPath 返回一个 per-pid 的临时目录，
 * 保证被测代码里的路径构造逻辑能正常跑通；其它接口用 no-op 代替。
 *
 * 搭配 ./electron-stub-loader.mjs 使用，后者把 'electron' import 重定向到这里。
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const tmpBase = path.join(os.tmpdir(), `chatlab-test-${process.pid}`)
fs.mkdirSync(tmpBase, { recursive: true })

export const app = {
  getPath(name = 'userData') {
    const p = path.join(tmpBase, name)
    fs.mkdirSync(p, { recursive: true })
    return p
  },
  getAppPath() {
    return tmpBase
  },
  isPackaged: false,
  on() {},
  once() {},
  whenReady() {
    return Promise.resolve()
  },
  quit() {},
}

export const ipcMain = {
  handle() {},
  on() {},
  once() {},
  removeHandler() {},
  removeAllListeners() {},
}

export const BrowserWindow = class {
  static getAllWindows() {
    return []
  }
  webContents = { send() {} }
  on() {}
  once() {}
  close() {}
}

export const shell = {
  showItemInFolder() {},
  openPath() {
    return Promise.resolve('')
  },
  openExternal() {
    return Promise.resolve()
  },
}

export const dialog = {
  showOpenDialog() {
    return Promise.resolve({ canceled: true, filePaths: [] })
  },
  showSaveDialog() {
    return Promise.resolve({ canceled: true, filePath: undefined })
  },
  showMessageBox() {
    return Promise.resolve({ response: 0 })
  },
}

export const Menu = {
  buildFromTemplate() {
    return {
      popup() {},
      closePopup() {},
    }
  },
  setApplicationMenu() {},
}

export const nativeImage = {
  createFromPath() {
    return { isEmpty: () => true }
  },
}

export default { app, ipcMain, BrowserWindow, shell, dialog, Menu, nativeImage }
