import { Brain, Eraser, GitMerge, Hash, RefreshCw, Settings, Split, Tag, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatAge } from '@/lib/utils'
import type { LlmStatus } from '@/lib/classifier'
import { SourceFilterToggle } from '@/components/SourceFilter'
import type { SourceFilter } from '@/components/views/types'

interface StatusBarAiActions {
  onClearCache?: () => Promise<void>
  onClassify?: () => Promise<void>
  onRunTags?: () => Promise<void>
  onRunIntent?: () => Promise<void>
  onMergeCategories?: () => Promise<void>
  onSplitLarge?: () => Promise<void>
  onRunEmbeddings?: () => Promise<void>
  onReembed?: () => Promise<void>
}

interface StatusBarProps {
  bookmarkCount: number
  tabCount: number
  loading: boolean
  lastUpdated: number | null
  onReload: () => void
  llmStatus: LlmStatus
  onSettingsClick: () => void
  sourceFilter: SourceFilter
  onSourceFilterChange: (value: SourceFilter) => void
  ai?: StatusBarAiActions
}

export function StatusBar({
  bookmarkCount,
  tabCount,
  loading,
  lastUpdated,
  onReload,
  llmStatus,
  onSettingsClick,
  sourceFilter,
  onSourceFilterChange,
  ai,
}: StatusBarProps) {
  const aiActions = ai ?? {}
  const hasAi = Object.values(aiActions).some(Boolean)
  return (
    <div className="flex items-center gap-4 rounded-md border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">{bookmarkCount}</span> bookmarks
      </span>
      <span className="text-border">·</span>
      <span>
        <span className="font-medium text-foreground">{tabCount}</span> tabs
      </span>

      {loading && (
        <>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1.5 text-accent">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </span>
        </>
      )}

      {lastUpdated && !loading && (
        <>
          <span className="text-border">·</span>
          <span>Updated {formatAge(lastUpdated)}</span>
        </>
      )}

      <span className="text-border">·</span>
      <SourceFilterToggle value={sourceFilter} onChange={onSourceFilterChange} />

      {hasAi && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-border">·</span>
          {aiActions.onClassify && (
            <button
              type="button"
              onClick={() => void aiActions.onClassify?.()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              title="Run category classification (pass 1)"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Classify</span>
            </button>
          )}
          {aiActions.onRunTags && (
            <button
              type="button"
              onClick={() => void aiActions.onRunTags?.()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              title="Generate tags for all items"
            >
              <Hash className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tags</span>
            </button>
          )}
          {aiActions.onRunIntent && (
            <button
              type="button"
              onClick={() => void aiActions.onRunIntent?.()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              title="Classify pages by intent"
            >
              <Tag className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Intent</span>
            </button>
          )}
          {aiActions.onMergeCategories && (
            <button
              type="button"
              onClick={() => void aiActions.onMergeCategories?.()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              title="Merge similar category labels"
            >
              <GitMerge className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Merge</span>
            </button>
          )}
          {aiActions.onSplitLarge && (
            <button
              type="button"
              onClick={() => void aiActions.onSplitLarge?.()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              title="Split large categories"
            >
              <Split className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Split</span>
            </button>
          )}
          {aiActions.onRunEmbeddings && (
            <button
              type="button"
              onClick={() => void aiActions.onRunEmbeddings?.()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              title="Run embeddings + 2D projection"
            >
              <Brain className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Embeddings</span>
            </button>
          )}
          {aiActions.onReembed && (
            <button
              type="button"
              onClick={() => void aiActions.onReembed?.()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              title="Clear embedding cache and re-embed all pages"
            >
              <Brain className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Re-embed</span>
            </button>
          )}
          {aiActions.onClearCache && (
            <button
              type="button"
              onClick={() => void aiActions.onClearCache?.()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground/50 hover:bg-card hover:text-destructive transition-colors"
              title="Clear all cached AI data"
            >
              <Eraser className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
      )}

      <span className="ml-auto text-xs">
        {llmStatus === 'unavailable' && <span className="opacity-40">LLM: unavailable</span>}
        {llmStatus === 'checking' && <span className="opacity-40">LLM: checking…</span>}
        {llmStatus === 'after-download' && <span className="text-accent">LLM: downloading…</span>}
        {llmStatus === 'ready' && <span className="text-primary">LLM: ready</span>}
        {llmStatus === 'classifying' && <span className="text-accent">LLM: classifying…</span>}
        {llmStatus === 'normalizing' && <span className="text-accent">LLM: normalizing…</span>}
      </span>

      <Button
        variant="ghost"
        size="icon"
        onClick={onSettingsClick}
        className="h-7 w-7"
        title="LLM Settings"
      >
        <Settings className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onReload}
        disabled={loading}
        className="h-7 w-7"
        title="Reload"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  )
}
