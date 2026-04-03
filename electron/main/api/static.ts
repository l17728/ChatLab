/**
 * ChatLab Web UI - Static File Serving
 * Serves Web UI components as static files from API server
 *
 * Features:
 * - SPA routing (index.html fallback)
 * - CORS headers configuration
 * - Security headers (CSP, X-Frame-Options, etc.)
 * - Cache headers for static assets
 * - Error handling and logging
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCors from '@fastify/cors'
import { join, extname } from 'path'
import { existsSync } from 'fs'

// ==================== Configuration ====================

export interface StaticFileConfig {
  enabled: boolean
  root: string // Path to static files
  prefix: string // URL prefix (e.g., '/web-ui' or '/')
  spaFallback: boolean // Enable SPA routing fallback
  corsEnabled: boolean
  securityHeadersEnabled: boolean
}

const DEFAULT_CONFIG: StaticFileConfig = {
  enabled: true,
  root: join(__dirname, '../../out/web-ui'),
  prefix: '/',
  spaFallback: true,
  corsEnabled: true,
  securityHeadersEnabled: true,
}

// ==================== Security Headers ====================

/**
 * Set security headers for static files
 */
function setSecurityHeaders(reply: FastifyReply) {
  // Content Security Policy - allows Vue components and inline styles
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none';"
  )

  // Prevent clickjacking
  reply.header('X-Frame-Options', 'DENY')

  // Prevent MIME type sniffing
  reply.header('X-Content-Type-Options', 'nosniff')

  // Enable browser XSS protection
  reply.header('X-XSS-Protection', '1; mode=block')

  // Referrer policy
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Permissions policy
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')

  console.log('[Web UI Static] Security headers applied')
}

// ==================== CORS Configuration ====================

/**
 * Configure CORS for Web UI static files
 */
async function configureCors(server: FastifyInstance, config: StaticFileConfig) {
  if (!config.corsEnabled) {
    console.log('[Web UI Static] CORS disabled')
    return
  }

  await server.register(fastifyCors, {
    origin: true, // Allow any origin for now (restrictive in production)
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  console.log('[Web UI Static] CORS configured')
}

// ==================== Cache Headers ====================

/**
 * Set appropriate cache headers based on file type
 */
function setCacheHeaders(reply: FastifyReply, filepath: string) {
  const ext = extname(filepath).toLowerCase()

  // Cache busting for JS/CSS (hash in filename)
  if (ext === '.js' || ext === '.css') {
    if (filepath.includes('.') && /\.[a-f0-9]+\.(js|css)$/.test(filepath)) {
      // Hashed files (long-term cache)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      console.log('[Web UI Static] Cache: Long-term for hashed asset:', filepath)
    } else {
      // Non-hashed files (short-term cache)
      reply.header('Cache-Control', 'public, max-age=3600, must-revalidate')
      console.log('[Web UI Static] Cache: Short-term for non-hashed asset:', filepath)
    }
  }
  // Images
  else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
    reply.header('Cache-Control', 'public, max-age=86400, immutable')
    console.log('[Web UI Static] Cache: Day-long for image:', filepath)
  }
  // HTML (never cache)
  else if (ext === '.html') {
    reply.header('Cache-Control', 'public, max-age=0, must-revalidate, no-cache')
    console.log('[Web UI Static] Cache: No cache for HTML:', filepath)
  }
  // Fonts
  else if (['.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    console.log('[Web UI Static] Cache: Long-term for font:', filepath)
  }
  // Default
  else {
    reply.header('Cache-Control', 'public, max-age=3600')
  }
}

// ==================== SPA Routing ====================

/**
 * Handle SPA routing - fallback to index.html for client-side routing
 */
function handleSpaRouting(server: FastifyInstance, config: StaticFileConfig) {
  if (!config.spaFallback) {
    console.log('[Web UI Static] SPA fallback disabled')
    return
  }

  // Hook to intercept 404 responses and serve index.html for SPA routing
  server.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestPath = request.url

    // Log 404 attempt
    console.log('[Web UI Static] 404 Not Found:', requestPath)

    // Check if this looks like an API request (skip SPA fallback)
    if (requestPath.startsWith('/api') || requestPath.startsWith('/ws')) {
      reply.code(404).send({ error: 'Not Found' })
      console.log('[Web UI Static] API route not found:', requestPath)
      return
    }

    // Check if it's a file request (has extension)
    if (extname(requestPath)) {
      reply.code(404).send({ error: 'File Not Found' })
      console.log('[Web UI Static] File not found:', requestPath)
      return
    }

    // For SPA routes without extension, serve index.html
    const indexPath = join(config.root, 'index.html')

    if (!existsSync(indexPath)) {
      console.error('[Web UI Static] index.html not found at:', indexPath)
      reply.code(404).send({ error: 'Web UI not available' })
      return
    }

    console.log('[Web UI Static] SPA fallback: Serving index.html for route:', requestPath)
    reply.sendFile('index.html', config.root)
  })
}

// ==================== Registration ====================

/**
 * Register static file serving with Fastify
 */
export async function registerStaticFiles(
  server: FastifyInstance,
  config: Partial<StaticFileConfig> = {}
) {
  const finalConfig: StaticFileConfig = { ...DEFAULT_CONFIG, ...config }

  if (!finalConfig.enabled) {
    console.log('[Web UI Static] Static file serving disabled')
    return
  }

  console.log('╔════════════════════════════════════════════════════════╗')
  console.log('║        ChatLab Web UI - Static File Serving            ║')
  console.log('╚════════════════════════════════════════════════════════╝')

  // Verify static files exist
  if (!existsSync(finalConfig.root)) {
    console.warn('[Web UI Static] Static root does not exist:', finalConfig.root)
    console.warn('[Web UI Static] Skipping static file serving')
    console.warn('[Web UI Static] To enable Web UI, run: npm run build')
    return
  }

  console.log('[Web UI Static] Configuration:')
  console.log(`  • Root: ${finalConfig.root}`)
  console.log(`  • Prefix: ${finalConfig.prefix}`)
  console.log(`  • SPA Fallback: ${finalConfig.spaFallback}`)
  console.log(`  • CORS: ${finalConfig.corsEnabled}`)
  console.log(`  • Security Headers: ${finalConfig.securityHeadersEnabled}`)

  try {
    // Configure CORS first
    await configureCors(server, finalConfig)

    // Register static file serving plugin
    await server.register(fastifyStatic, {
      root: finalConfig.root,
      prefix: finalConfig.prefix,
      constraints: {}, // Allow all paths
    })

    console.log('[Web UI Static] Static plugin registered')

    // Add hook to set security headers on all responses
    if (finalConfig.securityHeadersEnabled) {
      server.addHook('onSend', async (_request, reply) => {
        // Only apply to static file responses
        const contentType = reply.getHeader('content-type')
        if (
          contentType &&
          (typeof contentType === 'string' || Array.isArray(contentType))
        ) {
          const typeStr = Array.isArray(contentType) ? contentType[0] : contentType
          if (
            typeStr.includes('text/html') ||
            typeStr.includes('application/javascript') ||
            typeStr.includes('text/css') ||
            typeStr.includes('image')
          ) {
            setSecurityHeaders(reply)
          }
        }
      })

      console.log('[Web UI Static] Security headers hook registered')
    }

    // Add hook to set cache headers
    server.addHook('onSend', async (request, reply) => {
      const filepath = request.url
      setCacheHeaders(reply, filepath)
    })

    console.log('[Web UI Static] Cache headers hook registered')

    // Handle SPA routing
    handleSpaRouting(server, finalConfig)

    console.log('[Web UI Static] Initialization complete')
    console.log(
      `[Web UI Static] Web UI available at: http://127.0.0.1:${process.env.API_PORT || 9871}/\n`
    )
  } catch (err) {
    console.error('[Web UI Static] Error registering static files:', err)
    throw err
  }
}

// ==================== Exports ====================

export { StaticFileConfig }
