import { Brain, Eraser, GitMerge, Hash, RefreshCw, Settings, Split, Tag, Wand2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { formatAge } from '@/lib/utils'
import type { LlmStatus } from '@/lib/classifier'

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
  ai,
}: StatusBarProps) {
  const aiActions = ai ?? {}
  const aiActionItems: AiActionItem[] = [
    aiActions.onClassify ? {
      key: 'classify',
      label: 'Classify',
      icon: Wand2,
      title: 'Run category classification (pass 1)',
      onClick: aiActions.onClassify,
    } : null,
    aiActions.onRunTags ? {
      key: 'tags',
      label: 'Tags',
      icon: Hash,
      title: 'Generate tags for all items',
      onClick: aiActions.onRunTags,
    } : null,
    aiActions.onRunIntent ? {
      key: 'intent',
      label: 'Intent',
      icon: Tag,
      title: 'Classify pages by intent',
      onClick: aiActions.onRunIntent,
    } : null,
    aiActions.onMergeCategories ? {
      key: 'merge',
      label: 'Merge',
      icon: GitMerge,
      title: 'Merge similar category labels',
      onClick: aiActions.onMergeCategories,
    } : null,
    aiActions.onSplitLarge ? {
      key: 'split',
      label: 'Split',
      icon: Split,
      title: 'Split large categories',
      onClick: aiActions.onSplitLarge,
    } : null,
    aiActions.onRunEmbeddings ? {
      key: 'embeddings',
      label: 'Embeddings',
      icon: Brain,
      title: 'Run embeddings + 2D projection',
      onClick: aiActions.onRunEmbeddings,
    } : null,
    aiActions.onReembed ? {
      key: 'reembed',
      label: 'Re-embed',
      icon: Brain,
      title: 'Clear embedding cache and re-embed all pages',
      onClick: aiActions.onReembed,
    } : null,
    aiActions.onClearCache ? {
      key: 'clear',
      label: 'Clear',
      icon: Eraser,
      title: 'Clear all cached AI data',
      onClick: aiActions.onClearCache,
      danger: true,
    } : null,
  ].filter((item): item is AiActionItem => item !== null)
  const hasAi = aiActionItems.length > 0
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

      {hasAi && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-border">·</span>
          <DropdownMenu trigger="AI Actions">
            <>
              {aiActionItems.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  onClick={item.onClick}
                  title={item.title}
                  className={
                    item.danger
                      ? 'text-muted-foreground/70 hover:bg-card hover:text-destructive'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground'
                  }
                >
                  <item.icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </DropdownMenuItem>
              ))}
            </>
          </DropdownMenu>
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

interface AiActionItem {
  key: string
  label: string
  icon: LucideIcon
  title: string
  onClick: () => Promise<void>
  danger?: boolean
}
