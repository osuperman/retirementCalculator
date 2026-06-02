const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answerMarkdown: {
      type: 'string',
      description:
        'A concise, helpful answer in Markdown. Must contain at least one complete explanatory sentence.',
    },
    caveats: {
      type: 'array',
      items: { type: 'string' },
      description: 'Important limitations or assumptions.',
    },
    suggestions: {
      type: 'array',
      description:
        'Optional proposed input changes the user may apply after reviewing.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string' },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                field: { type: 'string' },
                value: { type: ['number', 'boolean', 'string'] },
                currentValue: { type: ['number', 'boolean', 'string', 'null'] },
                note: { type: 'string' },
              },
              required: ['field', 'value', 'currentValue', 'note'],
            },
          },
          confidence: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
          },
        },
        required: ['title', 'rationale', 'changes', 'confidence'],
      },
    },
  },
  required: ['answerMarkdown', 'caveats', 'suggestions'],
}

const SYSTEM_PROMPT = `
You are a retirement-planning analysis assistant embedded in a retirement planner.
You have CPA-level familiarity with retirement-account rules, tax sequencing, Roth conversions, RMDs, COLA, inflation, and projection logic.

Use only the supplied profile, inputs, summary, projection rows, and prior chat messages. Do not assume facts not present in the context.
Give practical feedback, explain why the current model behaves as it does, and call out when a conclusion is sensitive to assumptions.
Always put the main user-facing answer in answerMarkdown. It must never be empty.

You are not a fiduciary, CPA, attorney, or tax preparer for the user. Do not provide guarantees. Recommend professional review for irreversible tax, legal, or investment decisions.

When suggesting plan changes:
- Propose changes only to fields that exist in the supplied inputs.
- Prefer small, testable scenario changes.
- Explain the tradeoff and what metric to inspect after applying.
- Put suggested input changes only in the suggestions array, never inside answerMarkdown.
- Never silently apply changes.
- Do not suggest exposing API keys in browser code.
`.trim()

function extractText(data) {
  if (typeof data.output_text === 'string') return data.output_text
  const parts = []
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') parts.push(content.text)
    }
  }
  return parts.join('\n')
}

function sanitizeAnswerMarkdown(value) {
  const text = typeof value === 'string' ? value : ''
  return text
    .replace(/\n\s*-:\s*\[?\s*\{[\s\S]*$/u, '')
    .replace(/\n\s*\[\s*\{[\s\S]*$/u, '')
    .replace(/\n\s*\{[\s\S]*$/u, '')
    .trim()
}

function fallbackAnswerFromParsed(parsed, rawText) {
  if (Array.isArray(parsed?.suggestions) && parsed.suggestions.length > 0) {
    return parsed.suggestions
      .map((suggestion) => {
        const title = suggestion?.title || 'Suggested scenario change'
        const rationale = suggestion?.rationale || ''
        return rationale ? `**${title}**\n\n${rationale}` : `**${title}**`
      })
      .join('\n\n')
  }

  if (Array.isArray(parsed?.caveats) && parsed.caveats.length > 0) {
    return parsed.caveats.map((caveat) => `- ${caveat}`).join('\n')
  }

  return sanitizeAnswerMarkdown(rawText)
}

function normalizeStructuredOutput(rawText) {
  try {
    const parsed = JSON.parse(rawText)
    const answer =
      sanitizeAnswerMarkdown(parsed.answerMarkdown) ||
      fallbackAnswerFromParsed(parsed, rawText)
    return {
      answerMarkdown:
        answer ||
        'The assistant returned a structured response without readable answer text. Please try the question again.',
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    }
  } catch {
    const answer = sanitizeAnswerMarkdown(rawText)
    return {
      answerMarkdown:
        answer ||
        'The assistant returned an empty response. Please try the question again.',
      caveats: [],
      suggestions: [],
    }
  }
}

export async function generateOpenAiRetirementResponse({
  apiKey,
  model,
  question,
  messages,
  profile,
}) {
  const recentMessages = messages.slice(-8)
  const userContext = {
    question,
    priorMessages: recentMessages,
    profile,
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: 'medium' },
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify(userContext),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'retirement_chat_response',
          schema: RESPONSE_SCHEMA,
          strict: true,
        },
      },
      max_output_tokens: 2200,
    }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      data?.error?.message ||
      `OpenAI request failed with status ${response.status}.`
    throw new Error(message)
  }

  return normalizeStructuredOutput(extractText(data))
}
