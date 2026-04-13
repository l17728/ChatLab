'use strict'

const { killElectronProcesses } = require('./helpers/kill-electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SYSTEM_USERDATA = path.join(os.homedir(), 'AppData', 'Roaming', 'ChatLab')

/**
 * Playwright global setup — kill any leftover Electron processes before the test run.
 * Also ensures the system api-server.json is in a valid state.
 */
module.exports = async function globalSetup() {
  console.log('\n[GlobalSetup] Killing any leftover Electron processes...')
  await killElectronProcesses()

  // Ensure system api-server.json has a valid numeric port
  const systemSettingsDir = path.join(SYSTEM_USERDATA, 'data', 'settings')
  const systemApiConfig = path.join(systemSettingsDir, 'api-server.json')
  try {
    if (fs.existsSync(systemApiConfig)) {
      const config = JSON.parse(fs.readFileSync(systemApiConfig, 'utf-8'))
      if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
        console.log('[GlobalSetup] Fixing invalid api-server.json port...')
        config.port = 9871
        fs.writeFileSync(systemApiConfig, JSON.stringify(config, null, 2), 'utf-8')
      }
    }
  } catch (e) {
    console.warn('[GlobalSetup] Could not validate api-server.json:', e.message)
  }

  // Delete system webui-users.json so Electron creates fresh admin/admin123 user
  const webUiUsersFile = path.join(SYSTEM_USERDATA, 'webui-users.json')
  try {
    if (fs.existsSync(webUiUsersFile)) {
      fs.unlinkSync(webUiUsersFile)
      console.log('[GlobalSetup] Deleted stale webui-users.json (will be recreated with admin/admin123)')
    }
  } catch (e) {
    console.warn('[GlobalSetup] Could not delete webui-users.json:', e.message)
  }

  // Also delete rate limiting state
  const rateLimitFile = path.join(SYSTEM_USERDATA, 'webui-rate-limit.json')
  try {
    if (fs.existsSync(rateLimitFile)) {
      fs.unlinkSync(rateLimitFile)
      console.log('[GlobalSetup] Deleted webui-rate-limit.json')
    }
  } catch {
    /* ignore */
  }

  // Delete global collaboration databases so each test run starts with a clean slate.
  // These live in system userData because module-level singletons cache _appDataDir before
  // app.setPath('userData', tempDir) runs. Stale WAL locks from prior crashed runs can
  // cause createTodo / write operations to block indefinitely.
  const globalDbDir = path.join(SYSTEM_USERDATA, 'data', 'databases', 'global')
  for (const dbName of ['collaboration', 'knowledge_graph', 'identity']) {
    for (const suffix of ['', '-wal', '-shm']) {
      const dbFile = path.join(globalDbDir, `${dbName}.db${suffix}`)
      try {
        if (fs.existsSync(dbFile)) {
          fs.unlinkSync(dbFile)
          console.log(`[GlobalSetup] Deleted ${dbName}.db${suffix}`)
        }
      } catch (e) {
        console.warn(`[GlobalSetup] Could not delete ${dbName}.db${suffix}:`, e.message)
      }
    }
  }

  console.log('[GlobalSetup] Clean start confirmed.\n')
}
