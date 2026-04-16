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
