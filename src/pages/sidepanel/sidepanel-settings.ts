import type { ChatProvider } from '@/lib/core/types'
import { deepMerge, type DeepPartial } from '@/lib/core/utils'

export type SidePanelSummaryProvider = 'defined' | ChatProvider

export interface SidePanelSettings {
  sections: {
    summary: boolean
    recentTabsLimit: 0 | 5 | 10 | 20
    duplicates: boolean
    similarTabs: boolean
    relatedBookmarks: boolean
    search: boolean
  }
  summarization: {
    provider: SidePanelSummaryProvider
    systemPrompt: string
  }
}

export const DEFAULT_SUMMARY_SYSTEM_PROMPT = 'You are a concise summarizer. Reply with 3-5 bullet points covering the key information. No preamble.'

export const DEFAULT_SIDEPANEL_SETTINGS: SidePanelSettings = {
  sections: {
    summary: true,
    recentTabsLimit: 10,
    duplicates: true,
    similarTabs: true,
    relatedBookmarks: true,
    search: true,
  },
  summarization: {
    provider: 'defined',
    systemPrompt: DEFAULT_SUMMARY_SYSTEM_PROMPT,
  },
}

export function mergeSidePanelSettings(raw: unknown): SidePanelSettings {
  return deepMerge(DEFAULT_SIDEPANEL_SETTINGS, (raw ?? {}) as DeepPartial<SidePanelSettings>)
}
