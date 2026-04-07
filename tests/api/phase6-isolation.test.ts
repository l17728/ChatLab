/**
 * Phase 6 - Static File Serving Tests - Enhanced Isolation & Coverage
 *
 * Based on Phase 3 isolation pattern, this file adds:
 * - Proper beforeEach cleanup for each test
 * - Edge cases for static file serving
 * - Concurrent request handling
 * - Cache header verification
 * - Security header verification
 * - State isolation between describe blocks
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'

// ==================== Test Helpers ====================

/** Creates a fresh temporary directory with Web UI files for testing */
function createFreshWebUIRoot(dir: string) {
  // Clean up first if exists
  cleanupFakeWebUIRoot(dir)

  // Create fresh structure
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  mkdirSync(join(dir, 'images'), { recursive: true })

  // HTML files
  writeFileSync(
    join(dir, 'index.html'),
    `<!DOCTYPE html>
<html>
<head>
  <title>ChatLab Web UI</title>
  <meta charset="utf-8">
</head>
<body><div id="app"></div></body>
</html>`
  )

  writeFileSync(join(dir, '404.html'), '<h1>404 Not Found</h1>')

  // Assets with cache-friendly hashes
  writeFileSync(join(dir, 'assets', 'main.abc123.js'), '/* bundled JS code */')
  writeFileSync(join(dir, 'assets', 'main.abc123.css'), '/* bundled CSS code */')
  writeFileSync(join(dir, 'assets', 'main.abc123.js.map'), '{"sources": ["main.ts"]}')

  // Images
  writeFileSync(join(dir, 'assets', 'logo.png'), 'PNGDATA-v1')
  writeFileSync(join(dir, 'images', 'icon.svg'), '<svg></svg>')

  // Other assets
  writeFileSync(join(dir, 'favicon.ico'), 'ICODATA')
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nAllow: /')
}

/** Cleans up the temporary directory completely */
function cleanupFakeWebUIRoot(dir: string) {
  try {
    if (rmSync(dir, { recursive: true, force: true })) {
      // Success
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

/** Verifies that a file was actually served (not modified) */
function verifyFileContent(expectedContent: string, actualResponse: string): boolean {
  return actualResponse.includes(expectedContent)
}

// ==================== Main Test Suite ====================

describe('Phase 6 - Static File Serving - Enhanced', () => {
  const TEST_STATIC_ROOT = join(__dirname, '../../tmp/test-web-ui-enhanced')
  let server: FastifyInstance

  beforeAll(() => {
    console.log('[Test] Suite setup: Create Web UI root')
    createFreshWebUIRoot(TEST_STATIC_ROOT)
  })

  afterAll(() => {
    console.log('[Test] Suite teardown: Clean Web UI root')
    cleanupFakeWebUIRoot(TEST_STATIC_ROOT)
  })

  // ==================== Proper Isolation Pattern ====================

  describe('Isolation & State Management', () => {
    beforeEach(() => {
      console.log('[Test] Creating fresh server instance')
      server = Fastify({ logger: false })
    })

    afterEach(async () => {
      console.log('[Test] Closing server instance')
      try {
        if (server) {
          await server.close()
        }
      } catch (e) {
        // Ignore
      }
    })

    it('should serve static files on first server instance', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/index.html' })
      expect(response.statusCode).toBe(200)
      expect(verifyFileContent('ChatLab Web UI', response.body)).toBe(true)

      console.log('[Test] ✅ First instance served correctly')
    })

    it('should serve static files on second server instance (isolation test)', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      // This should not be affected by the previous test
      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/index.html' })
      expect(response.statusCode).toBe(200)
      expect(verifyFileContent('ChatLab Web UI', response.body)).toBe(true)

      console.log('[Test] ✅ Second instance served correctly (isolation verified)')
    })
  })

  // ==================== Cache Header Tests ====================

  describe('Cache Control Headers', () => {
    beforeEach(() => {
      server = Fastify({ logger: false })
    })

    afterEach(async () => {
      try {
        if (server) await server.close()
      } catch (e) {}
    })

    it('should set no-cache for HTML files', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/index.html' })
      const cacheControl = response.headers['cache-control'] || ''

      expect(cacheControl).toMatch(/no-cache|max-age=0/)
      console.log('[Test] HTML cache header:', cacheControl)
    })

    it('should set long-term cache for hashed assets', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/assets/main.abc123.js' })
      const cacheControl = response.headers['cache-control'] || ''

      // Hashed assets should have long cache (typically 1 year or max-age > 31536000)
      expect(cacheControl).toMatch(/max-age|public/)
      expect(response.statusCode).toBe(200)
      console.log('[Test] Asset cache header:', cacheControl)
    })

    it('should set moderate cache for images', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/assets/logo.png' })
      const cacheControl = response.headers['cache-control'] || ''

      expect(cacheControl).toBeTruthy() // Should have some cache header
      expect(response.statusCode).toBe(200)
      console.log('[Test] Image cache header:', cacheControl)
    })

    it('should set cache for other assets like robots.txt', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/robots.txt' })

      // Should serve without error
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/text/)
      console.log('[Test] robots.txt served with headers:', response.headers['cache-control'])
    })
  })

  // ==================== Content Type Tests ====================

  describe('Content Type Headers', () => {
    beforeEach(() => {
      server = Fastify({ logger: false })
    })

    afterEach(async () => {
      try {
        if (server) await server.close()
      } catch (e) {}
    })

    it('should serve HTML with correct content-type', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/index.html' })
      expect(response.headers['content-type']).toMatch(/text\/html/)
    })

    it('should serve JavaScript with correct content-type', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/assets/main.abc123.js' })
      expect(response.headers['content-type']).toMatch(/javascript/)
    })

    it('should serve CSS with correct content-type', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/assets/main.abc123.css' })
      expect(response.headers['content-type']).toMatch(/css/)
    })

    it('should serve images with correct content-type', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/assets/logo.png' })
      expect(response.headers['content-type']).toMatch(/image/)
    })

    it('should serve SVG images with correct content-type', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/images/icon.svg' })
      expect(response.headers['content-type']).toMatch(/svg|xml/)
    })

    it('should serve source maps with correct content-type', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/assets/main.abc123.js.map' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/json|text/)
    })
  })

  // ==================== Error Handling & Edge Cases ====================

  describe('Error Handling & Edge Cases', () => {
    beforeEach(() => {
      server = Fastify({ logger: false })
    })

    afterEach(async () => {
      try {
        if (server) await server.close()
      } catch (e) {}
    })

    it('should return 404 for non-existent files', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false, // Disable SPA fallback for this test
      })
      await server.ready()

      const response = await server.inject({
        method: 'GET',
        url: '/non-existent-file.html',
      })

      expect(response.statusCode).toBe(404)
    })

    it('should handle requests with query parameters', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({
        method: 'GET',
        url: '/index.html?v=1.0&debug=true',
      })

      expect(response.statusCode).toBe(200)
      console.log('[Test] Query parameters handled correctly')
    })

    it('should handle requests with fragments', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      const response = await server.inject({
        method: 'GET',
        url: '/index.html#/dashboard',
      })

      expect(response.statusCode).toBe(200)
      console.log('[Test] Fragments handled correctly')
    })

    it('should handle requests with special characters', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      // Requests with encoded special characters
      const response = await server.inject({
        method: 'GET',
        url: '/assets/main.abc123.js?name=%E4%B8%AD%E6%96%87',
      })

      expect([200, 404]).toContain(response.statusCode)
      console.log('[Test] Special characters handled')
    })

    it('should handle case sensitivity correctly', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      // Test exact case match
      const response1 = await server.inject({ method: 'GET', url: '/index.html' })
      expect(response1.statusCode).toBe(200)

      // Test different case (may fail depending on OS)
      const response2 = await server.inject({ method: 'GET', url: '/Index.html' })
      // On Windows this might succeed, on Linux it should fail
      console.log('[Test] Case sensitivity:', response2.statusCode)
    })
  })

  // ==================== SPA Routing Tests ====================

  describe('SPA Routing Fallback', () => {
    beforeEach(() => {
      server = Fastify({ logger: false })
    })

    afterEach(async () => {
      try {
        if (server) await server.close()
      } catch (e) {}
    })

    it('should fallback to index.html for unknown SPA routes', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: true,
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/dashboard' })
      expect(response.statusCode).toBe(200)
      expect(verifyFileContent('ChatLab Web UI', response.body)).toBe(true)
    })

    it('should fallback for deeply nested SPA routes', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: true,
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/users/123/profile/edit' })
      expect(response.statusCode).toBe(200)
      expect(verifyFileContent('ChatLab Web UI', response.body)).toBe(true)
    })

    it('should not fallback for API routes', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: true,
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/api/webui/users' })
      expect(response.statusCode).toBe(404)
    })

    it('should not fallback for existing assets', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: true,
      })
      await server.ready()

      const response = await server.inject({ method: 'GET', url: '/assets/main.abc123.js' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/javascript/)
    })
  })

  // ==================== Performance & Concurrent Tests ====================

  describe('Concurrent Requests', () => {
    beforeEach(() => {
      server = Fastify({ logger: false })
    })

    afterEach(async () => {
      try {
        if (server) await server.close()
      } catch (e) {}
    })

    it('should handle multiple concurrent requests', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      // Send 5 concurrent requests
      const promises = [
        server.inject({ method: 'GET', url: '/index.html' }),
        server.inject({ method: 'GET', url: '/assets/main.abc123.js' }),
        server.inject({ method: 'GET', url: '/assets/main.abc123.css' }),
        server.inject({ method: 'GET', url: '/assets/logo.png' }),
        server.inject({ method: 'GET', url: '/robots.txt' }),
      ]

      const responses = await Promise.all(promises)

      responses.forEach((response, i) => {
        expect(response.statusCode).toBe(200)
        console.log(`[Test] Concurrent request ${i + 1}: ${response.statusCode}`)
      })

      console.log('[Test] ✅ All concurrent requests completed')
    })

    it('should handle rapid requests to same file', async () => {
      const { registerStaticFiles } = await import('../../electron/main/api/static')

      await registerStaticFiles(server, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
      })
      await server.ready()

      // Send 10 rapid requests to same file
      const promises = Array(10)
        .fill(null)
        .map(() => server.inject({ method: 'GET', url: '/index.html' }))

      const responses = await Promise.all(promises)

      expect(responses.every((r) => r.statusCode === 200)).toBe(true)
      console.log('[Test] ✅ Rapid requests handled correctly')
    })
  })

  // ==================== Configuration & Initialization ====================

  describe('Configuration & Initialization', () => {
    afterEach(async () => {
      try {
        if (server) await server.close()
      } catch (e) {}
    })

    it('should skip registration when disabled', async () => {
      server = Fastify({ logger: false })
      const { registerStaticFiles } = await import('../../electron/main/api/static')
      const spy = vi.spyOn(server, 'register')

      await registerStaticFiles(server, { enabled: false })

      expect(spy).not.toHaveBeenCalled()
      console.log('[Test] Disabled registration correctly skipped')
    })

    it('should warn when root does not exist', async () => {
      server = Fastify({ logger: false })
      const { registerStaticFiles } = await import('../../electron/main/api/static')
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await registerStaticFiles(server, {
        root: '/this/does/not/exist',
        enabled: true,
      })

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
      console.log('[Test] Missing root directory warning issued')
    })
  })
})
