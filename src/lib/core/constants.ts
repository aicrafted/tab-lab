import type { ViewId } from '@/components/views/types'

/**
 * Branded types for item sources.
 */
export const ITEM_SOURCE = {
  TAB: 'tab' as const,
  BOOKMARK: 'bm' as const,
}

export type ItemSource = typeof ITEM_SOURCE[keyof typeof ITEM_SOURCE]

/**
 * Re-export for convenience if needed elsewhere
 */
export const SOURCES = [ITEM_SOURCE.TAB, ITEM_SOURCE.BOOKMARK] as const

/**
 * Build configuration profiles.
 */
export const BUILD = {
  dev: {
    loglevel: 'debug' as const,
    'console-api': true,
    views: {
      hide: [] as ViewId[],
    }
  },
  prod: {
    loglevel: 'warn' as const,
    'console-api': false,
    views: {
      hide: [       
        'triage',
        'tag-constellation', 'domain-graph', 'reading-queue',         
        'focus-rings', 'shadow-map', 'magazine',
        'settings-knowledge', 'settings-advanced'
      ] as ViewId[],
    }
  }
} as const

/**
 * ACTIVE BUILD MODE.
 * Automatically derived from Vite's build mode:
 *   bun run dev   → development → 'dev'
 *   bun run build → production  → 'prod'
 *   bun run build:dev → development → 'dev'
 */
export const BUILD_MODE: keyof typeof BUILD = import.meta.env.MODE === 'production' ? 'prod' : 'dev'

/**
 * Active configuration based on BUILD_MODE.
 */
export const ACTIVE_BUILD = BUILD[BUILD_MODE]

/** Helper for quick checks */
export const IS_DEV = BUILD_MODE === 'dev'
