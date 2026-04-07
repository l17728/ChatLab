/**
 * Phase 4 - Admin API Test Isolation & Enhanced Coverage
 *
 * Enhanced tests based on Phase 3 isolation pattern
 * Focus: Database state isolation, concurrent operations, boundary conditions
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as path from 'path'

// ==================== Test Setup (Same as Phase 3) ====================

// Mock Electron app module
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') {
        return path.join(process.cwd(), '.test-data')
      }
      return `/tmp/${name}`
    },
  },
}))

const TEST_DB_DIR = path.join(process.cwd(), '.test-data')
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'webui-users.json')
const testBaseURL = 'http://127.0.0.1:9871'

function resetDatabase(): void {
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.removeSync(TEST_DB_PATH)
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

/**
 * HTTP request helper with consistent error handling
 */
async function adminRequest(
  method: string,
  path: string,
  options?: { body?: any; token?: string }
): Promise<{ status: number; data: any; headers?: Record<string, string> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }

  try {
    const response = await fetch(`${testBaseURL}${path}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })

    const data = await response.json().catch(() => ({}))
    return {
      status: response.status,
      data,
      headers: Object.fromEntries(response.headers.entries())
    }
  } catch (error) {
    console.error(`[Test] Request failed: ${method} ${path}`, error)
    throw error
  }
}

// ==================== Main Test Suite ====================

describe('Phase 4: Admin API with Isolation', () => {
  let adminToken: string

  beforeEach(async () => {
    console.log('[Test] Setup: Reset database and get fresh admin token')
    resetDatabase()

    // Get fresh admin token for each test
    const loginResponse = await adminRequest('POST', '/api/webui/auth/login', {
      body: { username: 'admin', password: 'admin123' },
    })
    if (loginResponse.data.success) {
      adminToken = loginResponse.data.data.token
      console.log('[Test] Fresh admin token obtained')
    } else {
      throw new Error('Failed to obtain admin token')
    }
  })

  afterEach(() => {
    console.log('[Test] Teardown: Clean database')
    resetDatabase()
  })

  // ==================== User Lifecycle Tests ====================

  describe('User Lifecycle with Isolation', () => {
    it('should create, disable, enable, then delete user (full lifecycle)', async () => {
      console.log('[Test] Starting user lifecycle test')
      const testUser = 'lifecycle-user-' + Date.now()

      // Step 1: Register user
      console.log('[Test] Step 1: Register user')
      let response = await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: testUser, password: 'lifecycle123' },
      })
      expect(response.data.success).toBe(true)

      // Step 2: Verify user is active
      console.log('[Test] Step 2: Verify user is active')
      response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const user = response.data.data.users.find((u: any) => u.username === testUser)
      expect(user).toBeDefined()
      expect(user.isActive).toBe(true)

      // Step 3: Disable user
      console.log('[Test] Step 3: Disable user')
      response = await adminRequest('POST', '/api/webui/admin/users/disable', {
        body: { username: testUser },
        token: adminToken,
      })
      expect(response.status).toBe(200)

      // Step 4: Verify user is inactive
      console.log('[Test] Step 4: Verify user is inactive')
      response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const disabledUser = response.data.data.users.find((u: any) => u.username === testUser)
      expect(disabledUser.isActive).toBe(false)

      // Step 5: Re-enable user
      console.log('[Test] Step 5: Re-enable user')
      response = await adminRequest('POST', '/api/webui/admin/users/enable', {
        body: { username: testUser },
        token: adminToken,
      })
      expect(response.status).toBe(200)

      // Step 6: Verify user is active again
      console.log('[Test] Step 6: Verify user is active again')
      response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const reenabledUser = response.data.data.users.find((u: any) => u.username === testUser)
      expect(reenabledUser.isActive).toBe(true)

      // Step 7: Delete user
      console.log('[Test] Step 7: Delete user')
      response = await adminRequest('POST', '/api/webui/admin/users/delete', {
        body: { username: testUser },
        token: adminToken,
      })
      expect(response.status).toBe(200)

      // Step 8: Verify user is deleted
      console.log('[Test] Step 8: Verify user is deleted')
      response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const deletedUser = response.data.data.users.find((u: any) => u.username === testUser)
      expect(deletedUser).toBeUndefined()

      console.log('[Test] ✅ Full lifecycle completed')
    })

    it('should allow recreating user after deletion', async () => {
      console.log('[Test] Testing user recreation after deletion')
      const testUser = 'recreate-' + Date.now()

      // Create and delete
      await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: testUser, password: 'pass123' },
      })
      await adminRequest('POST', '/api/webui/admin/users/delete', {
        body: { username: testUser },
        token: adminToken,
      })

      // Recreate with same name
      const response = await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: testUser, password: 'newpass123' },
      })

      expect(response.data.success).toBe(true)
      console.log('[Test] ✅ User successfully recreated')
    })

    it('should not allow deleting admin user', async () => {
      console.log('[Test] Testing admin deletion protection')
      const response = await adminRequest('POST', '/api/webui/admin/users/delete', {
        body: { username: 'admin' },
        token: adminToken,
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.data.success).toBe(false)

      // Verify admin still exists
      const listResponse = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const admin = listResponse.data.data.users.find((u: any) => u.username === 'admin')
      expect(admin).toBeDefined()
      expect(admin.isActive).toBe(true)

      console.log('[Test] ✅ Admin deletion properly protected')
    })
  })

  // ==================== State Isolation Tests ====================

  describe('State Isolation Between Tests', () => {
    it('should start with clean state (only admin exists)', async () => {
      console.log('[Test] Checking initial clean state')
      const response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })

      expect(response.data.data.users.length).toBe(1)
      expect(response.data.data.users[0].username).toBe('admin')
      console.log('[Test] ✅ Clean state verified')
    })

    it('should not see users from previous tests (isolation test 1)', async () => {
      console.log('[Test] Isolation test 1: Create a user')
      await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: 'isolation-test-1', password: 'pass123' },
      })
      const response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      expect(response.data.data.users.length).toBe(2)
    })

    it('should not see users from previous tests (isolation test 2)', async () => {
      console.log('[Test] Isolation test 2: Verify clean state')
      const response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })

      // Should only have admin, not the user from isolation test 1
      expect(response.data.data.users.length).toBe(1)
      expect(response.data.data.users[0].username).toBe('admin')
      console.log('[Test] ✅ Isolation verified - no pollution from previous test')
    })
  })

  // ==================== Concurrent Operation Tests ====================

  describe('Concurrent User Operations', () => {
    it('should handle rapid enable/disable cycles', async () => {
      console.log('[Test] Testing rapid enable/disable cycles')
      const testUser = 'cycle-' + Date.now()

      // Create user
      await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: testUser, password: 'pass123' },
      })

      // Rapid cycles: disable -> enable -> disable -> enable
      for (let i = 0; i < 3; i++) {
        console.log(`[Test] Cycle ${i + 1}: disable`)
        let response = await adminRequest('POST', '/api/webui/admin/users/disable', {
          body: { username: testUser },
          token: adminToken,
        })
        expect(response.status).toBe(200)

        console.log(`[Test] Cycle ${i + 1}: enable`)
        response = await adminRequest('POST', '/api/webui/admin/users/enable', {
          body: { username: testUser },
          token: adminToken,
        })
        expect(response.status).toBe(200)
      }

      // Final state should be active
      const response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const user = response.data.data.users.find((u: any) => u.username === testUser)
      expect(user.isActive).toBe(true)
      console.log('[Test] ✅ Rapid cycles handled correctly')
    })

    it('should handle creating multiple users sequentially', async () => {
      console.log('[Test] Testing sequential user creation')
      const users = ['user-a', 'user-b', 'user-c']

      // Create all users
      for (const user of users) {
        const response = await adminRequest('POST', '/api/webui/auth/register', {
          body: { username: user, password: 'pass123' },
        })
        expect(response.data.success).toBe(true)
      }

      // Verify all were created
      const listResponse = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const usernames = listResponse.data.data.users.map((u: any) => u.username)

      for (const user of users) {
        expect(usernames).toContain(user)
      }
      expect(listResponse.data.data.users.length).toBe(users.length + 1) // +1 for admin

      console.log('[Test] ✅ Sequential creation verified')
    })
  })

  // ==================== Edge Case Tests ====================

  describe('Edge Cases & Boundary Conditions', () => {
    it('should handle duplicate enable/disable operations', async () => {
      console.log('[Test] Testing duplicate operations on same user')
      const testUser = 'dup-' + Date.now()

      await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: testUser, password: 'pass123' },
      })

      // Disable twice
      let response = await adminRequest('POST', '/api/webui/admin/users/disable', {
        body: { username: testUser },
        token: adminToken,
      })
      expect(response.status).toBe(200)

      response = await adminRequest('POST', '/api/webui/admin/users/disable', {
        body: { username: testUser },
        token: adminToken,
      })
      expect(response.status).toBe(200) // Should be idempotent

      // Enable twice
      response = await adminRequest('POST', '/api/webui/admin/users/enable', {
        body: { username: testUser },
        token: adminToken,
      })
      expect(response.status).toBe(200)

      response = await adminRequest('POST', '/api/webui/admin/users/enable', {
        body: { username: testUser },
        token: adminToken,
      })
      expect(response.status).toBe(200) // Should be idempotent

      console.log('[Test] ✅ Duplicate operations handled correctly')
    })

    it('should reject operations on non-existent users', async () => {
      console.log('[Test] Testing operations on non-existent users')

      const nonExistent = 'does-not-exist-' + Date.now()

      // Try to disable non-existent user
      let response = await adminRequest('POST', '/api/webui/admin/users/disable', {
        body: { username: nonExistent },
        token: adminToken,
      })
      expect(response.status).toBeGreaterThanOrEqual(400)

      // Try to enable non-existent user
      response = await adminRequest('POST', '/api/webui/admin/users/enable', {
        body: { username: nonExistent },
        token: adminToken,
      })
      expect(response.status).toBeGreaterThanOrEqual(400)

      // Try to delete non-existent user
      response = await adminRequest('POST', '/api/webui/admin/users/delete', {
        body: { username: nonExistent },
        token: adminToken,
      })
      expect(response.status).toBeGreaterThanOrEqual(400)

      console.log('[Test] ✅ Non-existent user operations rejected correctly')
    })

    it('should handle very long usernames gracefully', async () => {
      console.log('[Test] Testing very long usernames')
      const longUsername = 'a'.repeat(255) // Maximum reasonable length

      const response = await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: longUsername, password: 'pass123' },
      })

      // Should either accept or reject gracefully, not crash
      expect([true, false]).toContain(response.data.success)
      console.log(`[Test] Long username handling: ${response.data.success ? 'accepted' : 'rejected'}`)
    })

    it('should handle special characters in usernames', async () => {
      console.log('[Test] Testing special characters in usernames')
      const specialChars = 'user@domain.com'

      const response = await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: specialChars, password: 'pass123' },
      })

      // Should handle gracefully
      if (response.data.success) {
        // If accepted, verify it can be listed
        const listResponse = await adminRequest('GET', '/api/webui/admin/users', {
          token: adminToken,
        })
        const user = listResponse.data.data.users.find((u: any) => u.username === specialChars)
        expect(user).toBeDefined()
      }
      console.log('[Test] ✅ Special character handling verified')
    })
  })

  // ==================== Statistics Accuracy Tests ====================

  describe('Statistics Accuracy', () => {
    it('should update statistics when users are created', async () => {
      console.log('[Test] Testing statistics updates on user creation')

      const response1 = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const initialCount = response1.data.data.statistics.totalUsers

      // Create new user
      await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: 'stats-' + Date.now(), password: 'pass123' },
      })

      const response2 = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const updatedCount = response2.data.data.statistics.totalUsers

      expect(updatedCount).toBe(initialCount + 1)
      console.log('[Test] ✅ Statistics updated correctly')
    })

    it('should track active/inactive user counts correctly', async () => {
      console.log('[Test] Testing active/inactive user tracking')

      const testUser = 'stats-inactive-' + Date.now()

      // Create user (active)
      await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: testUser, password: 'pass123' },
      })

      let response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const activeCount1 = response.data.data.statistics.activeUsers

      // Disable user
      await adminRequest('POST', '/api/webui/admin/users/disable', {
        body: { username: testUser },
        token: adminToken,
      })

      response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      const activeCount2 = response.data.data.statistics.activeUsers
      const inactiveCount = response.data.data.statistics.inactiveUsers

      expect(activeCount2).toBe(activeCount1 - 1)
      expect(inactiveCount).toBeGreaterThan(0)
      console.log('[Test] ✅ Active/inactive counts tracked correctly')
    })
  })
})
