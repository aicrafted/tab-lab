// Minimal ambient types for Chrome built-in Prompt API (window.ai.languageModel)
// Spec: https://github.com/webmachinelearning/prompt-api

interface AILanguageModelCapabilities {
  available: 'readily' | 'after-download' | 'no'
}

interface AILanguageModelSession {
  prompt(input: string): Promise<string>
  destroy(): void
}

interface AILanguageModelFactory {
  capabilities(): Promise<AILanguageModelCapabilities>
  create(options?: { systemPrompt?: string; temperature?: number; topK?: number }): Promise<AILanguageModelSession>
}

interface AI {
  languageModel: AILanguageModelFactory
}

interface Window {
  ai?: AI
}
