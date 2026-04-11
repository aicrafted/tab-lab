import { webllmChat } from './webllm-provider'
import type { LlmSettings } from './types'

export interface ChatOptions {
  responseFormat?: 'json'
  disableThinking?: boolean
}

export async function chatComplete(
  systemPrompt: string,
  userMessage: string,
  settings: LlmSettings,
  maxTokens = 40,
  options: ChatOptions = {},
): Promise<string> {
  switch (settings.chatProvider) {
    case 'gemini-nano': {
      if (!window.ai?.languageModel) throw new Error('Gemini Nano unavailable')
      const session = await window.ai.languageModel.create({ systemPrompt })
      try {
        return (await session.prompt(userMessage)).trim()
      } finally {
        session.destroy()
      }
    }
    case 'webllm':
      return webllmChat(systemPrompt, userMessage, settings.webllmModel, maxTokens, options)
    case 'lmstudio':
    default: {
      const res = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: maxTokens,
          temperature: 0.1,
          ...(options.responseFormat === 'json'
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`LM Studio: ${res.status}`)
      const json = (await res.json()) as { choices: { message: { content: string } }[] }
      return json.choices[0]?.message.content?.trim() ?? ''
    }
  }
}
