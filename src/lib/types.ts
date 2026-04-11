export interface BookmarkItem {
  id: string
  url: string
  title: string
  domain: string
  folder: string           // full path e.g. "Dev/Tools/AI"
  dateAdded: number
  // dedup within source
  isDuplicate?: boolean
  // enriched by crosslink
  isOpen?: boolean
  lastVisited?: number     // from chrome.history (lazy, future)
  visitCount?: number      // total visits from chrome.history
  // enriched by LLM
  category?: string
  tags?: string[]          // AI-generated topical tags
  intent?: PageIntent      // how the user uses this page
  clusterId?: number
  processedAt?: number
}

export interface TabItem {
  id: number
  windowId: number
  url: string
  title: string
  domain: string
  favIconUrl?: string
  lastAccessed: number
  // enriched by crosslink
  isBookmarked?: boolean
  bookmarkFolder?: string
  isDuplicate?: boolean    // same URL open in another tab
  duplicateCount?: number  // total tabs sharing this URL (only on canonical row)
  // Chrome tab group
  groupId?: number
  groupName?: string
  groupColor?: string      // Chrome color name
  visitCount?: number      // total visits from chrome.history
  // enriched by LLM
  category?: string
  tags?: string[]          // AI-generated topical tags
  intent?: PageIntent      // how the user uses this page
  clusterId?: number
  processedAt?: number
}

export type PageIntent =
  | 'article'        // blog post, tutorial, news — read once, linear
  | 'reference'      // docs, spec, cheatsheet — consulted repeatedly
  | 'tool'           // SaaS, dashboard, web app — used interactively
  | 'service'        // product page, signup, settings — functional, occasional
  | 'transactional'  // order, booking, tracking — time-limited, discard after
  | 'video'          // YouTube, Vimeo, Loom — primarily video
  | 'social'         // Reddit, HN, Twitter — conversational
  | 'repository'     // GitHub/GitLab repo, npm package — code asset
  | 'other'          // catch-all

export interface CacheEntry {
  category: string
  clusterId?: number
  processedAt: number
  tags?: string[]          // AI-generated tags
  embedding?: number[]     // raw embedding vector from LM Studio
  intent?: PageIntent      // intent classification
}

export interface LlmSettings {
  chatProvider: ChatProvider
  embeddingProvider: EmbeddingProvider
  baseUrl: string          // e.g. "http://localhost:1234/v1"
  apiKey: string           // empty string if not required
  model: string            // lmstudio chat model
  embeddingModel: string   // lmstudio embedding model
  webllmModel: string      // WebLLM model id
}

export type ChatProvider = 'gemini-nano' | 'lmstudio' | 'webllm'
export type EmbeddingProvider = 'lmstudio' | 'transformers'

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  chatProvider: 'lmstudio',
  embeddingProvider: 'lmstudio',
  baseUrl: 'http://localhost:1234/v1',
  apiKey: '',
  model: '',
  embeddingModel: '',
  webllmModel: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
}
