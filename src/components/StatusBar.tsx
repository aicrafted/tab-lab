import { Brain, Database, Eraser, Hash, RefreshCw, Settings, Tag, Wand2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { formatAge } from '@/lib/core/utils'
import type { LlmAvailability } from '@/lib/ai/classifier'
import type { TaskState } from '@/lib/pipeline/pipeline-orchestrator'

interface StatusBarAiActions {
  onClearCache?: () => Promise<void>
  onRunDomains?: () => Promise<void>
  onRedomains?: () => Promise<void>
  onClassify?: () => Promise<void>
  onReclassify?: () => Promise<void>
  onRunTags?: () => Promise<void>
  onRetag?: () => Promise<void>
  onRunIntent?: () => Promise<void>
  onReintent?: () => Promise<void>
  onRunEmbeddings?: () => Promise<void>
  onReembed?: () => Promise<void>
}

interface StatusBarProps {
  bookmarkCount: number
  tabCount: number
  loading: boolean
  lastUpdated: number | null
  onReload: () => void
  llmAvailability: LlmAvailability
  tasks: TaskState[]
  pipelineRunning: boolean
  lastError?: string
  onStopPipeline?: () => void
  onSettingsClick: () => void
  ai?: StatusBarAiActions
}

export function StatusBar({
  bookmarkCount,
  tabCount,
  loading,
  lastUpdated,
  onReload,
  llmAvailability,
  tasks,
  pipelineRunning,
  lastError,
  onStopPipeline,
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
    aiActions.onRunDomains ? {
      key: 'domains',
      label: 'Domains',
      icon: Database,
      title: 'Save domain knowledge (site descriptions) to cache',
      onClick: aiActions.onRunDomains,
    } : null,
    aiActions.onRedomains ? {
      key: 'redomains',
      label: 'Re-Domains',
      icon: Database,
      title: 'Clear and rebuild domain knowledge cache',
      onClick: aiActions.onRedomains,
    } : null,
    aiActions.onReclassify ? {
      key: 'reclassify',
      label: 'Re-Classify',
      icon: Wand2,
      title: 'Clear only category cache and classify again',
      onClick: aiActions.onReclassify,
    } : null,
    aiActions.onRunTags ? {
      key: 'tags',
      label: 'Tags',
      icon: Hash,
      title: 'Generate tags for all items',
      onClick: aiActions.onRunTags,
    } : null,
    aiActions.onRetag ? {
      key: 'retag',
      label: 'Re-Tags',
      icon: Hash,
      title: 'Clear only tags cache and run tagging again',
      onClick: aiActions.onRetag,
    } : null,
    aiActions.onRunIntent ? {
      key: 'intent',
      label: 'Intent',
      icon: Tag,
      title: 'Classify pages by intent',
      onClick: aiActions.onRunIntent,
    } : null,
    aiActions.onReintent ? {
      key: 'reintent',
      label: 'Re-Intent',
      icon: Tag,
      title: 'Clear only intent cache and classify intent again',
      onClick: aiActions.onReintent,
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
  const activeTasks = tasks
    .filter((task) => task.status === 'running' || task.status === 'pending')
    .sort((a, b) => a.label.localeCompare(b.label))

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

      <span className="ml-auto flex items-center gap-2 text-xs">
        {lastError && (
          <span className="flex items-center gap-1 text-destructive" title={lastError}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
            LLM: error
          </span>
        )}
        {llmAvailability === 'unavailable' && <span className="opacity-40">LLM: unavailable</span>}
        {llmAvailability === 'checking' && <span className="opacity-40">LLM: checking…</span>}
        {llmAvailability === 'after-download' && <span className="text-accent">LLM: downloading…</span>}
        {!pipelineRunning && llmAvailability === 'ready' && <span className="text-primary">LLM: ready</span>}
        {pipelineRunning && activeTasks.length > 0 && (
          <span className="text-accent" title={`${activeTasks[0].done}/${activeTasks[0].total}`}>
            {activeTasks[0].label}: {Math.round(activeTasks[0].percent)}%
          </span>
        )}
        {pipelineRunning && onStopPipeline && (
          <Button variant="ghost" size="sm" onClick={onStopPipeline} className="h-6 px-2 text-[11px]" title="Stop current pipeline">
            Stop
          </Button>
        )}
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
