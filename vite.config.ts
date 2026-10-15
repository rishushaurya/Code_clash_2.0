import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Serves the API during `npm run dev` through the same router Vercel runs (api/router.ts),
 * so the whole app, AI included, runs on localhost without the Vercel CLI.
 */
function devApi(): Plugin {
  return {
    name: 'pratibimb-dev-api',
    configureServer(server) {
      // Tests run without the real keys, so they never reach live services.
      if (!process.env.VITEST) for (const [k, v] of Object.entries(loadEnv('development', process.cwd(), ''))) process.env[k] ??= v
      // Without Supabase there is no cron: the dev server runs the twin's minute tick itself.
      const tick = setInterval(async () => {
        try {
          const db = await server.ssrLoadModule('/api/_lib/db.ts')
          if (!db.localMode()) return
          const { route } = await server.ssrLoadModule('/api/router.ts')
          await route(new Request('http://localhost/api/tick', { method: 'POST', headers: { authorization: `Bearer ${db.cronSecret()}` } }))
        } catch (e) {
          server.config.logger.warn(`[tick] ${String(e)}`)
        }
      }, 60_000)
      if (process.env.VITEST) clearInterval(tick)
      server.httpServer?.once('close', () => clearInterval(tick))
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const { route } = await server.ssrLoadModule('/api/router.ts')
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const headers = Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : []))
          const response: Response = await route(
            new Request(`http://localhost${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }),
          )
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          server.config.logger.error(`[api] ${req.url}: ${String(e)}`)
          res.statusCode = 500
          res.end('{"error":"Internal error"}')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { host: true },
})
