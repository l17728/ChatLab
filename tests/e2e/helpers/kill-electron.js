'use strict'

/**
 * Kill all lingering Electron processes (Windows-specific).
 * Called in globalSetup, globalTeardown, and stopIsolatedApp to enforce
 * the core principle: "close the desktop app after every test."
 */

const { execSync } = require('child_process')

async function killElectronProcesses() {
  try {
    // Use PowerShell for reliable force-kill on Windows
    execSync('powershell -Command "Stop-Process -Name electron -Force -ErrorAction SilentlyContinue"', {
      stdio: 'ignore',
      timeout: 5000,
    })
    console.log('[KillElectron] Killed electron.exe processes')
  } catch {
    // No electron processes running — that's fine
  }

  // Wait for OS to release bound ports
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

module.exports = { killElectronProcesses }
