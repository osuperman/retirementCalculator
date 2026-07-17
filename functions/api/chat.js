// Cloudflare Pages Function: serves POST /api/chat in production.
//
// This is the production counterpart to the Vite dev-server middleware in
// vite.config.js. GitHub Pages (static hosting) cannot run server code, so the
// deployed "Ask AI" chat had no backend to call. Cloudflare Pages runs this
// function on the same origin as the static site, so the browser can keep
// calling `${BASE_URL}api/chat` with no CORS setup and the OpenAI key stays
// server-side (never shipped to the browser).
//
// The OpenAI provider uses the global `fetch` API only, so it runs unchanged on
// the Cloudflare Workers runtime.
import { generateOpenAiRetirementResponse } from '../../server/llmProviders/openai.mjs'

const MAX_BODY_BYTES = 1_000_000

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Only POST is exported, so Cloudflare answers other methods with 405 automatically.
export async function onRequestPost({ request, env }) {
  let body
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) {
      return json({ error: 'Request body is too large.' }, 413)
    }
    body = text ? JSON.parse(text) : {}
  } catch {
    return json({ error: 'Invalid JSON request body.' }, 400)
  }

  if (!body?.question || typeof body.question !== 'string') {
    return json({ error: 'Missing question.' }, 400)
  }

  const provider = env.LLM_PROVIDER || 'openai'
  if (provider !== 'openai') {
    return json({ error: `Provider "${provider}" is not implemented yet.` }, 501)
  }

  if (!env.OPENAI_API_KEY) {
    return json(
      {
        error:
          'OPENAI_API_KEY is not configured on the server. Add it as an encrypted environment variable in the Cloudflare Pages project settings.',
      },
      500,
    )
  }

  try {
    const result = await generateOpenAiRetirementResponse({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || 'gpt-5.4-mini',
      question: body.question,
      messages: Array.isArray(body.messages) ? body.messages : [],
      profile: body.profile,
    })
    return json(result)
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unknown chat error.' },
      500,
    )
  }
}
