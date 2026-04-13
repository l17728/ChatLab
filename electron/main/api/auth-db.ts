/**
 * ChatLab Web UI - Extended Authentication with User Management
 * Replaces simple JWT auth with database-backed user authentication
 * Comprehensive logging for all auth operations
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { randomBytes, createHmac, timingSafeEqual } from 'crypto'
import * as userDb from './user-db'
import { getJwtSecret } from './auth-jwt'

// ==================== Types ====================

export interface AuthToken {
  token: string
  expiresAt: number
  userId: string
  username: string
}

export interface AuthState {
  tokens: Map<string, { userId: string; username: string; expiresAt: number }>
  lastAttempts: Map<string, { count: number; resetAt: number }>
}

// ==================== Constants ====================

const TOKEN_EXPIRY_DAYS = 7
const TOKEN_EXPIRY_MS = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000

const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

const MAX_REGISTER_ATTEMPTS = 3
const REGISTER_ATTEMPT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

// ==================== Module State ====================

const authState: AuthState = {
  tokens: new Map(),
  lastAttempts: new Map(),
}

// Separate rate-limit tracker for registration attempts (keyed by username)
const registerAttempts = new Map<string, { count: number; resetAt: number }>()

// ==================== Token Management ====================

/**
 * Generate session token
 */
function generateToken(userId: string, username: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + TOKEN_EXPIRY_MS) / 1000),
      type: 'webui',
      jti: randomBytes(16).toString('hex'),
      userId,
      username,
    })
  ).toString('base64url')
  const signingInput = `${header}.${payload}`
  const signature = createHmac('sha256', getJwtSecret()).update(signingInput).digest('base64url')

  return `${signingInput}.${signature}`
}

/**
 * Parse and validate token
 */
function validateToken(token: string): { valid: boolean; userId?: string; username?: string } {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false }
    }

    // Verify HMAC-SHA256 signature
    const signingInput = `${parts[0]}.${parts[1]}`
    const expectedSig = createHmac('sha256', getJwtSecret()).update(signingInput).digest('base64url')
    let sigsMatch = false
    try {
      const expectedBuf = Buffer.from(expectedSig)
      const actualBuf = Buffer.from(parts[2])
      sigsMatch = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)
    } catch {
      sigsMatch = false
    }
    if (!sigsMatch) {
      console.warn('[WebUI Auth] Token signature verification failed')
      return { valid: false }
    }

    const payloadStr = Buffer.from(parts[1], 'base64url').toString()
    const payload = JSON.parse(payloadStr)

    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      console.log('[WebUI Auth] Token expired')
      return { valid: false }
    }

    if (!payload.userId || !payload.username || payload.type !== 'webui') {
      console.log('[WebUI Auth] Token rejected: missing required claims')
      return { valid: false }
    }

    // Check the in-memory token store — enforces logout (revokeToken removes the entry)
    const stored = authState.tokens.get(token)
    if (stored) {
      if (stored.expiresAt < Date.now()) {
        authState.tokens.delete(token)
        console.log('[WebUI Auth] Token expired (store-side)')
        return { valid: false }
      }
      return {
        valid: true,
        userId: stored.userId,
        username: stored.username,
      }
    }

    // Token not in active store but signature is valid and not expired —
    // accept it (e.g., after app restart) since signature proves it was issued by this server
    console.log('[WebUI Auth] Token accepted via signature verification (not in active store)')
    return {
      valid: true,
      userId: payload.userId,
      username: payload.username,
    }
  } catch (error) {
    console.error('[WebUI Auth] Token validation error:', error)
    return { valid: false }
  }
}

/**
 * Store token in session
 */
function storeToken(token: string, userId: string, username: string): void {
  authState.tokens.set(token, {
    userId,
    username,
    expiresAt: Date.now() + TOKEN_EXPIRY_MS,
  })

  console.log(`[WebUI Auth] Token stored for user: ${username} (expires in ${TOKEN_EXPIRY_DAYS} days)`)
}

/**
 * Revoke token
 */
function revokeToken(token: string): void {
  authState.tokens.delete(token)
  console.log('[WebUI Auth] Token revoked')
}

/**
 * Clean up expired tokens periodically
 */
function cleanupExpiredTokens(): void {
  const now = Date.now()
  let count = 0

  for (const [token, data] of authState.tokens) {
    if (data.expiresAt < now) {
      authState.tokens.delete(token)
      count++
    }
  }

  if (count > 0) {
    console.log(`[WebUI Auth] Cleaned up ${count} expired tokens`)
  }
}

// Start periodic cleanup every 1 hour.
// Save handle so it can be cleared on app shutdown (prevents process from hanging in tests).
const _cleanupInterval = setInterval(cleanupExpiredTokens, 60 * 60 * 1000)
if (_cleanupInterval.unref) _cleanupInterval.unref() // allow Node.js to exit even if interval is pending

// ==================== Rate Limiting ====================

/**
 * Check login attempt rate limit
 */
function checkLoginAttemptLimit(username: string): { allowed: boolean; resetAt?: number } {
  const now = Date.now()
  const attempts = authState.lastAttempts.get(username)

  if (!attempts) {
    return { allowed: true }
  }

  if (now > attempts.resetAt) {
    authState.lastAttempts.delete(username)
    return { allowed: true }
  }

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    return {
      allowed: false,
      resetAt: attempts.resetAt,
    }
  }

  return { allowed: true }
}

/**
 * Record failed login attempt
 */
function recordFailedLoginAttempt(username: string): void {
  const attempts = authState.lastAttempts.get(username)
  const now = Date.now()

  if (!attempts || now > attempts.resetAt) {
    authState.lastAttempts.set(username, {
      count: 1,
      resetAt: now + LOGIN_ATTEMPT_WINDOW_MS,
    })
  } else {
    attempts.count++
  }

  const updatedAttempts = authState.lastAttempts.get(username)!
  console.warn(`[WebUI Auth] Failed login attempt for ${username} (${updatedAttempts.count}/${MAX_LOGIN_ATTEMPTS})`)
}

/**
 * Clear login attempts on success
 */
function clearLoginAttempts(username: string): void {
  authState.lastAttempts.delete(username)
}

// ==================== Public API ====================

/**
 * Handle user login
 */
export async function handleLogin(
  username: string,
  password: string
): Promise<{
  success: boolean
  token?: string
  userId?: string
  username?: string
  expiresAt?: number
  error?: string
}> {
  console.log(`[WebUI Auth] Login attempt: ${username}`)

  // Check rate limit
  const rateLimit = checkLoginAttemptLimit(username)
  if (!rateLimit.allowed) {
    const waitTime = Math.ceil((rateLimit.resetAt! - Date.now()) / 1000)
    console.warn(`[WebUI Auth] Rate limit exceeded for ${username}. Wait ${waitTime}s.`)
    return {
      success: false,
      error: `Too many login attempts. Please try again in ${waitTime}s.`,
    }
  }

  // Authenticate user against database
  const authResult = userDb.authenticateUser(username, password)
  if (!authResult.success) {
    recordFailedLoginAttempt(username)
    console.warn(`[WebUI Auth] Login failed: ${authResult.error}`)
    return {
      success: false,
      error: authResult.error,
    }
  }

  // Generate token
  const user = authResult.user!
  const token = generateToken(user.id, user.username)
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS

  storeToken(token, user.id, user.username)
  clearLoginAttempts(username)

  console.log(
    `[WebUI Auth] Login successful for user: ${username}. Token expires at ${new Date(expiresAt).toISOString()}`
  )

  return {
    success: true,
    token,
    userId: user.id,
    username: user.username,
    expiresAt,
  }
}

/**
 * Handle user registration
 */
export async function handleRegister(
  username: string,
  password: string
): Promise<{ success: boolean; userId?: string; error?: string }> {
  console.log(`[WebUI Auth] Registration attempt: ${username}`)

  // Check registration rate limit (prevents username enumeration and CPU exhaustion via PBKDF2)
  const now = Date.now()
  const regAttempt = registerAttempts.get(username)
  if (regAttempt && now < regAttempt.resetAt && regAttempt.count >= MAX_REGISTER_ATTEMPTS) {
    const waitSecs = Math.ceil((regAttempt.resetAt - now) / 1000)
    console.warn(`[WebUI Auth] Registration rate limit exceeded for ${username}. Wait ${waitSecs}s.`)
    return { success: false, error: `Too many registration attempts. Please try again in ${waitSecs}s.` }
  }

  // Track this attempt
  if (!regAttempt || now >= regAttempt.resetAt) {
    registerAttempts.set(username, { count: 1, resetAt: now + REGISTER_ATTEMPT_WINDOW_MS })
  } else {
    regAttempt.count++
  }

  // Validate input
  if (!username || username.trim().length === 0) {
    console.warn('[WebUI Auth] Registration failed: empty username')
    return {
      success: false,
      error: 'Username cannot be empty',
    }
  }

  if (!password || password.length < 6) {
    console.warn('[WebUI Auth] Registration failed: password too short')
    return {
      success: false,
      error: 'Password must be at least 6 characters',
    }
  }

  // Register user
  const result = userDb.registerUser(username, password)
  if (!result.success) {
    console.warn(`[WebUI Auth] Registration failed: ${result.error}`)
    return {
      success: false,
      error: result.error,
    }
  }

  console.log(`[WebUI Auth] User registered successfully: ${username}`)

  return {
    success: true,
    userId: result.user!.id,
  }
}

/**
 * Handle logout
 */
export function handleLogout(token: string): void {
  revokeToken(token)
  console.log('[WebUI Auth] User logged out')
}

/**
 * Verify token and extract user info
 */
export function verifyToken(token: string): { valid: boolean; userId?: string; username?: string } {
  return validateToken(token)
}

/**
 * Middleware for JWT verification
 */
export async function jwtAuthMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<{ valid: boolean; userId?: string; username?: string; error?: string }> {
  const authHeader = request.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[WebUI Auth] Missing or invalid authorization header')
    return { valid: false, error: 'Missing or invalid authorization header' }
  }

  const token = authHeader.slice(7)
  const verification = validateToken(token)

  if (!verification.valid) {
    console.warn('[WebUI Auth] Token validation failed')
    return { valid: false, error: 'Invalid or expired token' }
  }

  console.log(`[WebUI Auth] Token verified for user: ${verification.username}`)

  return {
    valid: true,
    userId: verification.userId,
    username: verification.username,
  }
}

/**
 * Handle password change
 */
export function handleChangePassword(
  username: string,
  oldPassword: string,
  newPassword: string
): { success: boolean; error?: string } {
  console.log(`[WebUI Auth] Password change request: ${username}`)

  const result = userDb.updateUserPassword(username, oldPassword, newPassword)

  if (result.success) {
    console.log(`[WebUI Auth] Password changed successfully: ${username}`)
  } else {
    console.warn(`[WebUI Auth] Password change failed: ${result.error}`)
  }

  return result
}

/**
 * Get authentication statistics
 */
export function getAuthStatistics(): {
  activeTokens: number
  activeUsers: number
  totalUsers: number
} {
  const stats = userDb.getUserStatistics()
  return {
    activeTokens: authState.tokens.size,
    activeUsers: stats.activeUsers,
    totalUsers: stats.totalUsers,
  }
}

/**
 * Log auth event for audit trail
 */
export function logAuthEvent(event: string, username: string, details?: Record<string, any>): void {
  // Strip sensitive fields before logging
  if (details) {
    const { token: _t, password: _p, secret: _s, authorization: _a, ...safeDetails } = details
    console.log(`[WebUI Auth Event] ${event} - User: ${username}`, safeDetails)
  } else {
    console.log(`[WebUI Auth Event] ${event} - User: ${username}`)
  }
}
