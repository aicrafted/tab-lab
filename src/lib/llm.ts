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
  const provider = settings.tasks.chat.provider
  switch (provider) {
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
      return webllmChat(systemPrompt, userMessage, settings.tasks.chat.model, maxTokens, options)
    case 'openrouter':
    case 'lmstudio':
    default: {
      const baseUrl = provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : settings.providers.lmstudio.baseUrl
      const apiKey = provider === 'openrouter'
        ? settings.providers.openrouter.apiKey
        : settings.providers.lmstudio.apiKey
      const model = settings.tasks.chat.model

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/aicrafted/tab-lab' } : {}),
        },
        body: JSON.stringify({
          model,
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
