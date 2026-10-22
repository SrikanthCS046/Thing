import type { ChatCitation, ChatSseEvent } from '../types'
import { API_V1, getAccessToken } from './client'

type ChatResponse = {
  conversationId: string
  citations: ChatCitation[]
  memory: {
    hasSummary: boolean
    recentTurns: number
  }
  answer: string
}

export async function streamChat(
  workspaceId: string,
  body: { message: string; conversationId?: string },
  onEvent: (event: ChatSseEvent) => void,
  signal?: AbortSignal,
) {
  const token = getAccessToken()

  let res: Response

  try {
    res = await fetch(`${API_V1}/workspaces/${workspaceId}/chat`, {
      method: 'POST',
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'x-correlation-id': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    throw new Error(
      `Unable to connect to backend: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const raw = await res.text()

  if (!res.ok) {
    let message = `Chat failed (${res.status})`

    try {
      const errorBody = JSON.parse(raw) as {
        message?: string | string[]
        error?: string
      }

      if (Array.isArray(errorBody.message)) {
        message = errorBody.message.join('. ')
      } else if (typeof errorBody.message === 'string') {
        message = errorBody.message
      } else if (typeof errorBody.error === 'string') {
        message = errorBody.error
      } else if (raw) {
        message = raw
      }
    } catch {
      if (raw) {
        message = raw
      }
    }

    throw new Error(message)
  }

  if (!raw) {
    throw new Error('Backend returned an empty chat response')
  }

  let data: ChatResponse

  try {
    data = JSON.parse(raw) as ChatResponse
  } catch (error) {
    throw new Error('Backend returned invalid JSON for chat response')
  }

  onEvent({
    type: 'meta',
    conversationId: data.conversationId,
    citations: data.citations,
    memory: data.memory,
  })

  const answer = data.answer || ''
  const chunkSize = 80

  for (let i = 0; i < answer.length; i += chunkSize) {
    onEvent({
      type: 'token',
      content: answer.slice(i, i + chunkSize),
    })

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 10)
    })
  }

  onEvent({ type: 'done' })
}
