import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 중 Hermes API 로의 CORS 회피용 프록시.
// VITE_HERMES_TARGET 으로 Hermes 게이트웨이/API 서버 주소 지정 (기본 :8642).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_HERMES_TARGET ?? 'http://localhost:8642'
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
