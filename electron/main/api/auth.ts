/**
 * ChatLab API — Bearer Token authentication hook
 * TEMPORARY: Disabled for testing
 */

import type { FastifyRequest, FastifyReply } from 'fastify'

export async function authHook(_request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // TEMPORARY: Allow all requests during development/testing
  return
}
