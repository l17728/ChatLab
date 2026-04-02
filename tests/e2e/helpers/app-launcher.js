'use strict'

/**
 * Electron 应用启动器
 * 通过 CDP 端口启动 Electron 实例以供 E2E 测试使用
 * 支持 TEST_MODE 绕过单实例锁，允许并行运行多个实例
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

/**
 * 查找可用的 TCP 端口
 */
async function findAvailablePort(startPort = 9222) {
  const net = require('net')

  for (let port = startPort; port < startPort + 100; port++) {
    const server = net.createServer()

    return new Promise((resolve) => {
      server.listen(port, () => {
        server.close(() => {
          resolve(port)
        })
      })

      server.on('error', () => {
        server.close()
        resolve(null)
      })

      setTimeout(() => {
        server.close()
        resolve(null)
      }, 100)
    }).then((port) => {
      if (port) return port
      return findAvailablePort(port + 1)
    })
  }
}

/**
 * 启动 Electron 应用
 */
async function launchApp(options = {}) {
  const port = options.port || (await findAvailablePort(9222))

  const appPath = path.resolve(__dirname, '../../..')
  let electronExe
  if (process.platform === 'win32') {
    electronExe = path.resolve(appPath, 'node_modules/.bin/electron.cmd')
  } else {
    electronExe = path.resolve(appPath, 'node_modules/.bin/electron')
  }

  if (!fs.existsSync(electronExe)) {
    throw new Error(`Electron 可执行文件不存在: ${electronExe}`)
  }

  console.log(`[AppLauncher] 启动 Electron，CDP 端口: ${port}`)

  const proc = spawn(electronExe, [appPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      TEST_MODE: 'true',  // E2E 测试模式：允许多个实例
      REMOTE_DEBUGGING_PORT: port,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  })

  // 等待应用就绪
  await new Promise((resolve) => setTimeout(resolve, 2000))

  return {
    proc,
    port,
    async close() {
      console.log(`[AppLauncher] 关闭应用 (PID: ${proc.pid})`)
      return new Promise((resolve) => {
        if (proc.killed) {
          resolve()
          return
        }

        proc.on('exit', resolve)
        proc.kill()

        // 强制杀死超时
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL')
          }
          resolve()
        }, 5000)
      })
    },
  }
}

module.exports = { launchApp }
