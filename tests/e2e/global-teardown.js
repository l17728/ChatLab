'use strict'

const { killElectronProcesses } = require('./helpers/kill-electron')

/**
 * Playwright global teardown — kill any leftover Electron processes after the full test run.
 * Enforces the core principle: "close the desktop app after every test."
 */
module.exports = async function globalTeardown() {
  console.log('\n[GlobalTeardown] Killing any remaining Electron processes...')
  await killElectronProcesses()
  console.log('[GlobalTeardown] Cleanup complete.\n')
}
