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
  parentCategory?: string
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
  parentCategory?: string
  tags?: string[]          // AI-generated topical tags
  intent?: PageIntent      // how the user uses this page
  staticIntent?: PageIntent // determined by URL extension, never overwritten by AI
  platform?: KnownPlatform // detected from domain, static
  clusterId?: number
  processedAt?: number
}

export const PAGE_INTENTS = [
  'article',       // blog post, tutorial, news — read once, linear
  'reference',     // docs, spec, cheatsheet — consulted repeatedly
  'tool',          // SaaS, dashboard, web app — used interactively
  'service',       // product page, signup, settings — functional, occasional
  'transactional', // order, booking, tracking — time-limited, discard after
  'repository',    // GitHub/GitLab repo, npm package — code asset
  'document',      // static file docs: pdf/doc/xls/csv/txt/md/...
  'image',         // static image files
  'audio',         // static audio files
  'video',         // static video files,YouTube, Vimeo, Loom — primarily video
  'archive',       // archives and disk images
  'data',          // structured data/configs and database files
  'code',          // source code files
] as const

export type PageIntent = typeof PAGE_INTENTS[number]

// Rich descriptors used for NLI intent classification.
// Keys must cover all PageIntent values.
export const INTENT_DESCRIPTORS: Record<PageIntent, string> = {
  article: 'Reddit thread discussion blog post tutorial guide news article essay how-to read story opinion',
  reference: 'documentation API reference docs cheatsheet specification manual MDN readthedocs',
  tool: 'dashboard editor app generator converter calculator online tool SaaS platform',
  service: 'pricing signup login register account settings product landing page',
  transactional: 'order confirmation booking receipt invoice tracking ticket payment',
  repository: 'GitHub GitLab repository source code npm package crates.io releases',
  document: 'PDF document spreadsheet Word Excel presentation file download',
  image: 'image photo picture PNG JPG SVG gallery wallpaper',
  audio: 'audio MP3 podcast sound music track recording',
  video: 'video YouTube watch video stream episode channel playlist Vimeo Twitch',
  archive: 'archive ZIP download release DMG installer package',
  data: 'JSON XML YAML TOML data export database SQL dataset structured',
  code: 'source file script configuration CSS JavaScript TypeScript'
}

export interface BookmarkScopeFilter {
  mode: 'root' | 'folder'
  folderId?: string
  folderPath?: string
}

export const KNOWN_PLATFORMS = [
  'social',
  'video',
  'code',
  'registry',
  'qa',
  'blog',
  'docs',
  'shopping',
  'news',
  'ai',
  'tool',
  'sandbox',
  'cloud',
  'music',
  'finance',
  'ci',
  'games',
  'education',
  'email',
  'reference',
] as const

export type KnownPlatform = typeof KNOWN_PLATFORMS[number]

export interface CacheEntry {
  category: string
  parentCategory?: string
  clusterId?: number
  processedAt: number
  tags?: string[]          // AI-generated tags
  embedding?: number[]     // raw embedding vector from LM Studio
  intent?: PageIntent      // intent classification
  platform?: KnownPlatform // detected platform
}

export type ChatProvider = 'gemini-nano' | 'browser-ml' | 'lmstudio' | 'openrouter'
export type EmbeddingProvider = 'browser-ml' | 'lmstudio' | 'openrouter'
export type ClassificationMethod = 'llm' | 'nli'

export interface NliCategory {
  label: string
  descriptor: string
}

export const DEFAULT_NLI_CATEGORIES: NliCategory[] = [
  { label: 'Development', descriptor: 'code programming software engineering GitHub Stack Overflow npm package library framework debugging API backend frontend' },
  { label: 'Design', descriptor: 'UI UX design Figma prototype wireframe typography color layout visual interface creative' },
  { label: 'AI & ML', descriptor: 'machine learning neural network LLM artificial intelligence deep learning model training dataset transformer' },
  { label: 'Science', descriptor: 'research paper study scientific biology chemistry physics mathematics experiment journal Nature arXiv' },
  { label: 'News', descriptor: 'breaking news article latest update report journalist headline politics world current events' },
  { label: 'Finance', descriptor: 'stock market investment trading portfolio cryptocurrency banking budget personal finance economy' },
  { label: 'Shopping', descriptor: 'buy product price review store checkout cart deal discount Amazon eBay ecommerce' },
  { label: 'Social Media', descriptor: 'feed post profile follow like comment tweet Reddit Twitter Instagram social network' },
  { label: 'Entertainment', descriptor: 'game movie music entertainment fun streaming podcast Spotify Netflix gaming' },
  { label: 'Productivity', descriptor: 'task todo calendar note email meeting schedule workflow Notion Obsidian Jira project management' },
  { label: 'Documentation', descriptor: 'documentation manual guide API reference specification changelog README readthedocs' },
  { label: 'Video', descriptor: 'YouTube video watch streaming episode series channel Vimeo Twitch stream' },
  { label: 'Research', descriptor: 'academic paper abstract methodology findings survey analysis literature review citation' },
  { label: 'Education', descriptor: 'course lesson tutorial learning education Coursera Khan Academy university online class' },
  { label: 'Health', descriptor: 'health medical symptom treatment fitness diet wellness nutrition exercise doctor' },
  { label: 'Other', descriptor: 'miscellaneous general page' },
]

export const DEFAULT_TRANSFORMERS_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

export interface LlmSettings {
  localNetworks: string[]
  nliCategories: NliCategory[]
  nliConfidenceThreshold: number
  knowledge: {
    remoteUrl: string
    lastSyncAt: number
  }
  providers: {
    browserMl: {
      chatModel: string
      embeddingModel: string
      temperature: number
    }
    lmstudio: {
      baseUrl: string
      apiKey: string
      chatModel: string
      embeddingModel: string
      temperature: number
    }
    openrouter: {
      apiKey: string
      chatModel: string
      embeddingModel: string
      temperature: number
    }
    geminiNano: {
      temperature: number
    }
  }
  tasks: {
    chat: { provider: ChatProvider }
    embedding: { 
      provider: EmbeddingProvider
      includeTitle: boolean
      includeDomain: boolean
      includePath: boolean
      includeDomainCategory: boolean
      includeDomainDescription: boolean
      includeDomainPlatform: boolean
      includeCategory: boolean
      includeLocalLabel: boolean
    }
    classification: { method: ClassificationMethod }
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toChatProvider(value: unknown, fallback: ChatProvider): ChatProvider {
  if (value === 'gemini-nano' || value === 'browser-ml' || value === 'webllm' || value === 'lmstudio' || value === 'openrouter') {
    if (value === 'webllm') return 'browser-ml'
    return value
  }
  return fallback
}

function toEmbeddingProvider(value: unknown, fallback: EmbeddingProvider): EmbeddingProvider {
  if (value === 'transformers' || value === 'browser-ml' || value === 'lmstudio' || value === 'openrouter') {
    if (value === 'transformers') return 'browser-ml'
    return value
  }
  return fallback
}

function toClassificationMethod(value: unknown, fallback: ClassificationMethod): ClassificationMethod {
  if (value === 'llm' || value === 'nli') return value
  return fallback
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  return out.length > 0 ? out : null
}

export const DEFAULT_LOCAL_NETWORKS = [
  'localhost',
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::1',
  'fc00::/7',
  '*.local',
  '*.lan',
] as const

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  localNetworks: [...DEFAULT_LOCAL_NETWORKS],
  providers: {
    browserMl: {
      chatModel: '',
      embeddingModel: DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
      temperature: 0.1,
    },
    lmstudio: {
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      chatModel: '',
      embeddingModel: '',
      temperature: 0.1,
    },
    openrouter: {
      apiKey: '',
      chatModel: '',
      embeddingModel: '',
      temperature: 0.1,
    },
    geminiNano: {
      temperature: 0.1,
    },
  },
  nliCategories: [...DEFAULT_NLI_CATEGORIES],
  nliConfidenceThreshold: 0.25,
  knowledge: {
    remoteUrl: 'https://raw.githubusercontent.com/aicrafted/tab-lab/refs/heads/main/public/data/domains.json',
    lastSyncAt: 0,
  },
  tasks: {
    chat: { provider: 'lmstudio' },
    embedding: { 
      provider: 'lmstudio',
      includeTitle: true,
      includeDomain: true,
      includePath: true,
      includeDomainCategory: true,
      includeDomainDescription: true,
      includeDomainPlatform: true,
      includeCategory: true,
      includeLocalLabel: true,
    },
    classification: { method: 'llm' },
  },
}

export function migrateLlmSettings(raw: unknown): LlmSettings {
  if (raw && typeof raw === 'object' && 'providers' in raw) {
    const obj = asObject(raw)
    const providers = asObject(obj.providers)
    
    // Providers
    const browserMl = asObject(providers.browserMl)
    const lmstudio = asObject(providers.lmstudio)
    const openrouter = asObject(providers.openrouter)
    
    // Migration of classificationMethod: pull from browserMl if it exists there (legacy)
    const legacyMethod = toClassificationMethod(browserMl.classificationMethod ?? lmstudio.classificationMethod ?? openrouter.classificationMethod, 'llm')
    
    // Tasks
    const tasks = asObject(obj.tasks)
    const chat = asObject(tasks.chat)
    const embedding = asObject(tasks.embedding)
    const classification = asObject(tasks.classification)
    
    const localNetworks = toStringArray(obj.localNetworks) ?? [...DEFAULT_LOCAL_NETWORKS]

    return {
      localNetworks,
      providers: {
        browserMl: {
          chatModel: asString(browserMl.chatModel, ''),
          embeddingModel: asString(browserMl.embeddingModel, DEFAULT_TRANSFORMERS_EMBEDDING_MODEL),
          temperature: typeof browserMl.temperature === 'number' ? browserMl.temperature : 0.1,
        },
        lmstudio: {
          baseUrl: asString(lmstudio.baseUrl, DEFAULT_LLM_SETTINGS.providers.lmstudio.baseUrl),
          apiKey: asString(lmstudio.apiKey, ''),
          chatModel: asString(lmstudio.chatModel, ''),
          embeddingModel: asString(lmstudio.embeddingModel, ''),
          temperature: typeof lmstudio.temperature === 'number' ? lmstudio.temperature : 0.1,
        },
        openrouter: {
          apiKey: asString(openrouter.apiKey, ''),
          chatModel: asString(openrouter.chatModel, ''),
          embeddingModel: asString(openrouter.embeddingModel, ''),
          temperature: typeof openrouter.temperature === 'number' ? openrouter.temperature : 0.1,
        },
        geminiNano: {
          temperature: typeof (providers.geminiNano as any)?.temperature === 'number' ? (providers.geminiNano as any).temperature : 0.1,
        },
      },
      tasks: {
        chat: {
          provider: toChatProvider(chat.provider, DEFAULT_LLM_SETTINGS.tasks.chat.provider),
        },
        embedding: {
          provider: toEmbeddingProvider(embedding.provider, DEFAULT_LLM_SETTINGS.tasks.embedding.provider),
          includeTitle: typeof embedding.includeTitle === 'boolean' ? embedding.includeTitle : true,
          includeDomain: typeof embedding.includeDomain === 'boolean' ? embedding.includeDomain : true,
          includePath: typeof embedding.includePath === 'boolean' ? embedding.includePath : true,
          includeDomainCategory: typeof (embedding as any).includeDomainCategory === 'boolean' ? (embedding as any).includeDomainCategory : (typeof (embedding as any).includeDomainLabel === 'boolean' ? (embedding as any).includeDomainLabel : true),
          includeDomainDescription: typeof (embedding as any).includeDomainDescription === 'boolean' ? (embedding as any).includeDomainDescription : (typeof (embedding as any).includeDomainLabel === 'boolean' ? (embedding as any).includeDomainLabel : true),
          includeDomainPlatform: typeof (embedding as any).includeDomainPlatform === 'boolean' ? (embedding as any).includeDomainPlatform : true,
          includeCategory: typeof embedding.includeCategory === 'boolean' ? embedding.includeCategory : true,
          includeLocalLabel: typeof embedding.includeLocalLabel === 'boolean' ? embedding.includeLocalLabel : true,
        },
        classification: {
          method: toClassificationMethod(classification.method, legacyMethod),
        },
      },
      nliCategories: (obj.nliCategories as NliCategory[]) ?? [...DEFAULT_NLI_CATEGORIES],
      nliConfidenceThreshold: typeof obj.nliConfidenceThreshold === 'number' ? obj.nliConfidenceThreshold : 0.25,
      knowledge: {
        remoteUrl: asString(asObject(obj.knowledge).remoteUrl, DEFAULT_LLM_SETTINGS.knowledge.remoteUrl),
        lastSyncAt: typeof asObject(obj.knowledge).lastSyncAt === 'number' ? (asObject(obj.knowledge).lastSyncAt as number) : 0,
      },
    }
  }

  // Legacy fallback for even older structures
  const old = asObject(raw) as any
  const tasks = asObject(old.tasks)
  const chat = asObject(tasks.chat)
  const embedding = asObject(tasks.embedding)
  
  return {
    ...DEFAULT_LLM_SETTINGS,
    providers: {
      ...DEFAULT_LLM_SETTINGS.providers,
      browserMl: {
        ...DEFAULT_LLM_SETTINGS.providers.browserMl,
        chatModel: asString(chat.model, ''),
        embeddingModel: asString(embedding.model, DEFAULT_TRANSFORMERS_EMBEDDING_MODEL),
      },
      lmstudio: {
        ...DEFAULT_LLM_SETTINGS.providers.lmstudio,
        chatModel: asString(chat.model, ''),
        embeddingModel: asString(embedding.model, ''),
      },
      openrouter: {
        ...DEFAULT_LLM_SETTINGS.providers.openrouter,
        chatModel: asString(chat.model, ''),
        embeddingModel: asString(embedding.model, ''),
      },
    },
    tasks: {
      chat: {
        provider: toChatProvider(chat.provider || old.chatProvider, 'lmstudio'),
      },
      embedding: {
        provider: toEmbeddingProvider(embedding.provider || old.embeddingProvider, 'lmstudio'),
        includeTitle: true,
        includeDomain: true,
        includePath: true,
        includeDomainCategory: true,
        includeDomainDescription: true,
        includeDomainPlatform: true,
        includeCategory: true,
        includeLocalLabel: true,
      },
      classification: {
        method: toClassificationMethod(old.classificationMethod, 'llm'),
      },
    },
  }
}
