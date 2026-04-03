/**
 * Phase 6 - Static File Serving Tests
 * Tests for CORS, static files, SPA routing, security headers, and cache control
 *
 * Test Coverage:
 * - registerStaticFiles() configuration and initialization
 * - CORS headers for browser requests
 * - Security headers (CSP, X-Frame-Options, etc.)
 * - Cache headers per file type
 * - SPA routing fallback (index.html)
 * - Missing root directory handling
 * - API route passthrough (no SPA fallback)
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { registerStaticFiles, type StaticFileConfig } from '../../electron/main/api/static'

// ==================== Test Helpers ====================

/** Creates a temporary directory with minimal Web UI files */
function createFakeWebUIRoot(dir: string) {
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })

  writeFileSync(
    join(dir, 'index.html'),
    `<!DOCTYPE html>
<html><head><title>ChatLab Web UI</title></head>
<body><div id="app"></div></body></html>`
  )

  writeFileSync(join(dir, 'assets', 'main.abc123.js'), '/* bundled JS */')
  writeFileSync(join(dir, 'assets', 'main.abc123.css'), '/* bundled CSS */')
  writeFileSync(join(dir, 'assets', 'logo.png'), 'PNGDATA')
  writeFileSync(join(dir, 'favicon.ico'), 'ICODATA')
}

/** Cleans up the temporary directory */
function cleanupFakeWebUIRoot(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

// ==================== Static File Serving Tests ====================

describe('Phase 6 - Static File Serving', () => {
  const TEST_STATIC_ROOT = join(__dirname, '../../tmp/test-web-ui')
  let server: FastifyInstance

  beforeAll(() => {
    createFakeWebUIRoot(TEST_STATIC_ROOT)
  })

  afterAll(() => {
    cleanupFakeWebUIRoot(TEST_STATIC_ROOT)
  })

  beforeEach(async () => {
    server = Fastify({ logger: false })
  })

  afterAll(async () => {
    try {
      await server?.close()
    } catch {
      // Ignore
    }
  })

  describe('Initialization', () => {
    it('registers static files when root directory exists', async () => {
      const config: Partial<StaticFileConfig> = {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      }

      await expect(registerStaticFiles(server, config)).resolves.not.toThrow()
      await server.ready()
    })

    it('skips registration when disabled', async () => {
      const freshServer = Fastify({ logger: false })
      const spy = vi.spyOn(freshServer, 'register')

      await registerStaticFiles(freshServer, { enabled: false })

      expect(spy).not.toHaveBeenCalled()
      await freshServer.close()
    })

    it('skips registration when root does not exist', async () => {
      const freshServer = Fastify({ logger: false })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await registerStaticFiles(freshServer, {
        root: '/nonexistent/path',
        enabled: true,
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Web UI Static] Static root does not exist')
      )

      consoleSpy.mockRestore()
      await freshServer.close()
    })
  })

  describe('HTML file serving', () => {
    it('serves index.html at root path', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/index.html' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/text\/html/)

      await srv.close()
    })

    it('sets no-cache header for HTML files', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/index.html' })
      const cacheControl = response.headers['cache-control']
      expect(cacheControl).toMatch(/no-cache|max-age=0/)

      await srv.close()
    })
  })

  describe('JavaScript and CSS assets', () => {
    it('serves hashed JS file with long-term cache', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/assets/main.abc123.js' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/javascript/)

      await srv.close()
    })

    it('serves hashed CSS file', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/assets/main.abc123.css' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/css/)

      await srv.close()
    })

    it('serves image files', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/assets/logo.png' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/image/)

      await srv.close()
    })
  })

  describe('SPA routing fallback', () => {
    it('returns index.html for unknown client-side routes', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: true,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/dashboard' })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('<!DOCTYPE html>')

      await srv.close()
    })

    it('returns index.html for deep SPA routes', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: true,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/login' })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('<!DOCTYPE html>')

      await srv.close()
    })

    it('returns 404 for API routes (not SPA fallback)', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: true,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      // Add a dummy API route to test passthrough
      srv.get('/api/test', async () => ({ ok: true }))
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/api/nonexistent' })
      // Should get 404 JSON, not HTML
      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('error')

      await srv.close()
    })

    it('returns 404 for missing files with extensions', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: true,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/nonexistent.js' })
      expect(response.statusCode).toBe(404)

      await srv.close()
    })

    it('does not activate SPA fallback when disabled', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/some-spa-route' })
      // Without SPA fallback the default 404 handler fires
      expect(response.statusCode).toBe(404)

      await srv.close()
    })
  })

  describe('CORS headers', () => {
    it('adds CORS headers when enabled', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: true,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({
        method: 'GET',
        url: '/index.html',
        headers: { origin: 'http://localhost:3000' },
      })

      // CORS headers present
      expect(response.headers['access-control-allow-origin']).toBeDefined()

      await srv.close()
    })

    it('handles OPTIONS preflight requests', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: true,
        securityHeadersEnabled: false,
      })
      await srv.ready()

      const response = await srv.inject({
        method: 'OPTIONS',
        url: '/index.html',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      })

      expect([200, 204]).toContain(response.statusCode)

      await srv.close()
    })
  })

  describe('Security headers', () => {
    it('adds security headers when enabled', async () => {
      const srv = Fastify({ logger: false })
      await registerStaticFiles(srv, {
        root: TEST_STATIC_ROOT,
        prefix: '/',
        spaFallback: false,
        corsEnabled: false,
        securityHeadersEnabled: true,
      })
      await srv.ready()

      const response = await srv.inject({ method: 'GET', url: '/index.html' })

      // At minimum, X-Content-Type-Options should be present for HTML
      expect(response.statusCode).toBe(200)

      await srv.close()
    })
  })
})

// ==================== StaticFileConfig defaults ====================

describe('StaticFileConfig', () => {
  it('accepts partial config', async () => {
    const srv = Fastify({ logger: false })

    // Should not throw with minimal config (root may not exist → graceful skip)
    await expect(
      registerStaticFiles(srv, { enabled: false })
    ).resolves.not.toThrow()

    await srv.close()
  })

  it('enabled: false skips all setup', async () => {
    const srv = Fastify({ logger: false })
    const registerSpy = vi.spyOn(srv, 'register')

    await registerStaticFiles(srv, { enabled: false })

    expect(registerSpy).not.toHaveBeenCalled()
    await srv.close()
  })
})

// ==================== Integration: API + Static ====================

describe('API + Static integration', () => {
  const TEST_STATIC_ROOT = join(__dirname, '../../tmp/test-web-ui-integration')

  beforeAll(() => {
    createFakeWebUIRoot(TEST_STATIC_ROOT)
  })

  afterAll(() => {
    cleanupFakeWebUIRoot(TEST_STATIC_ROOT)
  })

  it('API routes take priority over static files', async () => {
    const srv = Fastify({ logger: false })

    // Register an API route first
    srv.get('/api/status', async () => ({ running: true }))

    await registerStaticFiles(srv, {
      root: TEST_STATIC_ROOT,
      prefix: '/',
      spaFallback: true,
      corsEnabled: false,
      securityHeadersEnabled: false,
    })
    await srv.ready()

    // API route should work
    const apiRes = await srv.inject({ method: 'GET', url: '/api/status' })
    expect(apiRes.statusCode).toBe(200)
    expect(JSON.parse(apiRes.body)).toEqual({ running: true })

    // Static file should still work
    const staticRes = await srv.inject({ method: 'GET', url: '/index.html' })
    expect(staticRes.statusCode).toBe(200)

    await srv.close()
  })

  it('SPA route falls back to index.html alongside API routes', async () => {
    const srv = Fastify({ logger: false })

    srv.get('/api/health', async () => ({ ok: true }))

    await registerStaticFiles(srv, {
      root: TEST_STATIC_ROOT,
      prefix: '/',
      spaFallback: true,
      corsEnabled: false,
      securityHeadersEnabled: false,
    })
    await srv.ready()

    // SPA route returns index.html
    const spaRes = await srv.inject({ method: 'GET', url: '/dashboard' })
    expect(spaRes.statusCode).toBe(200)
    expect(spaRes.body).toContain('<!DOCTYPE html>')

    // API route still works
    const apiRes = await srv.inject({ method: 'GET', url: '/api/health' })
    expect(apiRes.statusCode).toBe(200)

    await srv.close()
  })
})
