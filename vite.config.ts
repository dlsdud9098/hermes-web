import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 게이트웨이 호스트의 디렉토리를 탐색하는 개발용 미들웨어.
// 브라우저 네이티브 폴더 피커는 절대경로를 주지 않으므로, 서버측에서 목록을 제공해
// 프론트의 폴더 피커가 절대경로를 얻게 한다. (개발 전용 — 프로덕션은 별도 백엔드 필요)
function fsBrowserPlugin(): Plugin {
  return {
    name: 'hermes-web-fs-browser',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/fs/list')) return next()
        const url = new URL(req.url, 'http://localhost')
        const dir = url.searchParams.get('path') || os.homedir()
        res.setHeader('Content-Type', 'application/json')
        try {
          const abs = path.resolve(dir)
          const dirs = fs
            .readdirSync(abs, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
            .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name))
          const parent = path.dirname(abs)
          res.end(JSON.stringify({
            path: abs,
            parent: parent === abs ? null : parent,
            dirs,
          }))
        } catch (err) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        }
      })
    },
  }
}

// 개발 중 Hermes API 로의 CORS 회피용 프록시.
// VITE_HERMES_TARGET 으로 Hermes 게이트웨이/API 서버 주소 지정 (기본 :8642).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_HERMES_TARGET ?? 'http://localhost:8642'
  return {
    plugins: [react(), fsBrowserPlugin()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          // Hermes API 서버는 미등록 Origin 요청을 403 으로 거부한다.
          // 프록시→게이트웨이는 서버↔서버 호출이므로 Origin 을 제거해 통과시킨다.
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
            })
          },
        },
      },
    },
  }
})
