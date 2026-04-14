export interface BookmarkItem {
  id: string
  url: string
  title: string
  domain: string
  folderId?: string
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
  staticIntent?: PageIntent // determined by URL extension, never overwritten by AI
  platform?: KnownPlatform // detected from domain, static
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
  staticIntent?: PageIntent // determined by URL extension, never overwritten by AI
  platform?: KnownPlatform // detected from domain, static
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
  | 'document'       // static file docs: pdf/doc/xls/csv/txt/md/...
  | 'image'          // static image files
  | 'audio'          // static audio files
  | 'archive'        // archives and disk images
  | 'data'           // structured data and database files
  | 'code'           // source/config files
  | 'other'          // catch-all

export type KnownPlatform =
  | 'social'
  | 'video'
  | 'code'
  | 'registry'
  | 'qa'
  | 'blog'
  | 'docs'
  | 'shopping'
  | 'news'
  | 'ai'
  | 'tool'
  | 'sandbox'
  | 'cloud'
  | 'music'
  | 'finance'
  | 'ci'
  | 'games'
  | 'education'
  | 'email'
  | 'reference'

export interface CacheEntry {
  category: string
  clusterId?: number
  processedAt: number
  tags?: string[]          // AI-generated tags
  embedding?: number[]     // raw embedding vector from LM Studio
  intent?: PageIntent      // intent classification
}

export type ChatProvider = 'gemini-nano' | 'webllm' | 'lmstudio' | 'openrouter'
export type EmbeddingProvider = 'transformers' | 'lmstudio' | 'openrouter'
export type ClassificationMethod = 'llm' | 'nli'
export const DEFAULT_TRANSFORMERS_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
export interface BookmarkScopeFilter {
  mode: 'root' | 'folder'
  folderId?: string
  folderPath?: string
}

export interface LlmSettings {
  providers: {
    lmstudio: { baseUrl: string; apiKey: string }
    openrouter: { apiKey: string }
  }
  tasks: {
    chat: {
      provider: ChatProvider
      model: string
    }
    embedding: {
      provider: EmbeddingProvider
      model: string
    }
    classification: {
      method: ClassificationMethod
    }
  }
}

interface LegacyLlmSettings {
  chatProvider?: string
  embeddingProvider?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  embeddingModel?: string
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toChatProvider(value: unknown, fallback: ChatProvider): ChatProvider {
  if (value === 'gemini-nano' || value === 'webllm' || value === 'lmstudio' || value === 'openrouter') {
    return value
  }
  return fallback
}

function toEmbeddingProvider(value: unknown, fallback: EmbeddingProvider): EmbeddingProvider {
  if (value === 'transformers' || value === 'lmstudio' || value === 'openrouter') {
    return value
  }
  return fallback
}

function toClassificationMethod(value: unknown, fallback: ClassificationMethod): ClassificationMethod {
  if (value === 'llm' || value === 'nli') return value
  return fallback
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  providers: {
    lmstudio: { baseUrl: 'http://localhost:1234/v1', apiKey: '' },
    openrouter: { apiKey: '' },
  },
  tasks: {
    chat: { provider: 'lmstudio', model: '' },
    embedding: { provider: 'lmstudio', model: '' },
    classification: { method: 'llm' },
  },
}

export function migrateLlmSettings(raw: unknown): LlmSettings {
  if (raw && typeof raw === 'object' && 'tasks' in raw) {
    const obj = asObject(raw)
    const providers = asObject(obj.providers)
    const lmstudio = asObject(providers.lmstudio)
    const openrouter = asObject(providers.openrouter)
    const tasks = asObject(obj.tasks)
    const chat = asObject(tasks.chat)
    const embedding = asObject(tasks.embedding)
    const classification = asObject(tasks.classification)

    return {
      providers: {
        lmstudio: {
          baseUrl: asString(lmstudio.baseUrl, DEFAULT_LLM_SETTINGS.providers.lmstudio.baseUrl),
          apiKey: asString(lmstudio.apiKey, ''),
        },
        openrouter: {
          apiKey: asString(openrouter.apiKey, ''),
        },
      },
      tasks: {
        chat: {
          provider: toChatProvider(chat.provider, DEFAULT_LLM_SETTINGS.tasks.chat.provider),
          model: asString(chat.model, ''),
        },
        embedding: {
          provider: toEmbeddingProvider(embedding.provider, DEFAULT_LLM_SETTINGS.tasks.embedding.provider),
          model: asString(embedding.model, ''),
        },
        classification: {
          method: toClassificationMethod(classification.method, DEFAULT_LLM_SETTINGS.tasks.classification.method),
        },
      },
    }
  }

  const old = asObject(raw) as LegacyLlmSettings
  return {
    providers: {
      lmstudio: {
        baseUrl: old.baseUrl ?? DEFAULT_LLM_SETTINGS.providers.lmstudio.baseUrl,
        apiKey: old.apiKey ?? '',
      },
      openrouter: { apiKey: '' },
    },
    tasks: {
      chat: {
        provider: toChatProvider(old.chatProvider, DEFAULT_LLM_SETTINGS.tasks.chat.provider),
        model: old.model ?? '',
      },
      embedding: {
        provider: toEmbeddingProvider(old.embeddingProvider, DEFAULT_LLM_SETTINGS.tasks.embedding.provider),
        model: old.embeddingModel ?? '',
      },
      classification: { method: 'llm' },
    },
  }
}
