import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 게이트웨이 호스트를 탐색하는 개발용 미들웨어 — 폴더 목록(/fs/list)과
// 설치된 Hermes 스킬 목록(/fs/skills)을 제공한다.
// 브라우저는 로컬 파일시스템에 직접 접근할 수 없으므로 서버측에서 노출한다.
// (개발 전용 — 프로덕션은 별도 백엔드 필요)

/** SKILL.md 의 YAML 프론트매터에서 name·description 추출 */
function parseSkillMd(file: string, fallbackName: string): { name: string; description: string } {
  let name = fallbackName
  let description = ''
  try {
    const text = fs.readFileSync(file, 'utf-8').slice(0, 4000)
    const fm = text.startsWith('---') ? text.slice(3, text.indexOf('\n---', 3)) : ''
    const nameM = fm.match(/^name:\s*["']?(.+?)["']?\s*$/m)
    const descM = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m)
    if (nameM) name = nameM[1].trim()
    if (descM) description = descM[1].trim()
  } catch {
    // 읽기 실패 — fallback 이름만 사용
  }
  // Hermes 슬래시 슬러그 규칙과 맞춤 (소문자, [a-z0-9-] 외 → -)
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-')
  return { name: slug, description }
}

function listSkills(root: string): { name: string; description: string }[] {
  const found: { name: string; description: string }[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      found.push(parseSkillMd(path.join(dir, 'SKILL.md'), path.basename(dir)))
      return // 스킬 디렉토리 — 더 내려가지 않음
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1)
    }
  }
  walk(root, 0)
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

function fsBrowserPlugin(): Plugin {
  return {
    name: 'hermes-web-fs-browser',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/fs/')) return next()
        res.setHeader('Content-Type', 'application/json')

        // 디렉토리 목록 (하위 폴더 + 파일)
        if (req.url.startsWith('/fs/list')) {
          const url = new URL(req.url, 'http://localhost')
          const dir = url.searchParams.get('path') || os.homedir()
          try {
            const abs = path.resolve(dir)
            const entries = fs
              .readdirSync(abs, { withFileTypes: true })
              .filter((e) => !e.name.startsWith('.'))
            const byName = (a: { name: string }, b: { name: string }) =>
              a.name.localeCompare(b.name)
            const dirs = entries
              .filter((e) => e.isDirectory())
              .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
              .sort(byName)
            const files = entries
              .filter((e) => e.isFile())
              .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
              .sort(byName)
            const parent = path.dirname(abs)
            res.end(JSON.stringify({
              path: abs,
              parent: parent === abs ? null : parent,
              dirs,
              files,
            }))
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
          }
          return
        }

        // 파일 내용 읽기 (최대 256KB)
        if (req.url.startsWith('/fs/read')) {
          const url = new URL(req.url, 'http://localhost')
          const file = url.searchParams.get('path')
          if (!file) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'path 누락' }))
            return
          }
          try {
            const abs = path.resolve(file)
            const MAX = 256 * 1024
            const stat = fs.statSync(abs)
            if (!stat.isFile()) throw new Error('파일이 아님')
            const fd = fs.openSync(abs, 'r')
            const buf = Buffer.alloc(Math.min(stat.size, MAX))
            fs.readSync(fd, buf, 0, buf.length, 0)
            fs.closeSync(fd)
            res.end(JSON.stringify({
              path: abs,
              content: buf.toString('utf-8'),
              truncated: stat.size > MAX,
            }))
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
          }
          return
        }

        // 설치된 Hermes 스킬 목록
        if (req.url.startsWith('/fs/skills')) {
          try {
            const skills = listSkills(path.join(os.homedir(), '.hermes', 'skills'))
            res.end(JSON.stringify({ skills }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
          }
          return
        }

        next()
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
