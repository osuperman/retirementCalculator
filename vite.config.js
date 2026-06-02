import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleChatRequest } from './server/chatHandler.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: '/retirementCalculator/',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'retirement-chat-api',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const pathname = req.url?.split('?')[0] || ''
            if (
              pathname !== '/api/chat' &&
              pathname !== '/retirementCalculator/api/chat'
            ) {
              next()
              return
            }
            handleChatRequest(req, res, {
              provider: env.LLM_PROVIDER || 'openai',
              openaiApiKey: env.OPENAI_API_KEY,
              openaiModel: env.OPENAI_MODEL || 'gpt-5.4-mini',
            })
          })
        },
      },
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  }
})
