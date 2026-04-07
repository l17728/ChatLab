// Simple test endpoint
export async function registerTestRoutes(server: any) {
  server.get('/api/webui/test', async () => {
    return { success: true, message: 'Test endpoint works!' }
  })
}
