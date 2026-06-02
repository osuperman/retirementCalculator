import { generateOpenAiRetirementResponse } from './llmProviders/openai.mjs'

const MAX_BODY_BYTES = 1_000_000

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON request body.'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

export async function handleChatRequest(req, res, config) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Only POST is supported.' })
    return
  }

  try {
    const body = await readJsonBody(req)
    if (!body?.question || typeof body.question !== 'string') {
      sendJson(res, 400, { error: 'Missing question.' })
      return
    }

    if (config.provider !== 'openai') {
      sendJson(res, 501, {
        error: `Provider "${config.provider}" is not implemented yet.`,
      })
      return
    }

    if (!config.openaiApiKey) {
      sendJson(res, 500, {
        error:
          'OPENAI_API_KEY is not configured. Add it to .env.local or point VITE_CHAT_API_URL at a backend that has a key.',
      })
      return
    }

    const result = await generateOpenAiRetirementResponse({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      question: body.question,
      messages: Array.isArray(body.messages) ? body.messages : [],
      profile: body.profile,
    })

    sendJson(res, 200, result)
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unknown chat error.',
    })
  }
}
