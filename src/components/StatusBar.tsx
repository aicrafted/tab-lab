import { Brain, Database, Eraser, Hash, RefreshCw, Settings, Wand2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { formatAge } from '@/lib/core/utils'
import type { LlmAvailability } from '@/lib/ai/classifier'
import type { TaskState } from '@/lib/pipeline/pipeline-orchestrator'

interface StatusBarAiActions {
  onClearCache?: () => Promise<void>
  onRunDomains?: () => Promise<void>
  onClassify?: () => Promise<void>
  onRunLabels?: () => Promise<void>
  onRunEmbeddings?: () => Promise<void>
  onRunFull?: () => Promise<void>
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
    aiActions.onRunFull ? {
      key: 'full',
      label: 'Run full AI pipeline',
      icon: Wand2,
      title: 'Run full processing pipeline (domains -> embeddings -> labels -> classification)',
      onClick: aiActions.onRunFull,
    } : null,
    aiActions.onRunDomains ? {
      key: 'domains',
      label: 'Domains enrichment',
      icon: Database,
      title: 'Fetch and cache domain metadata',
      onClick: aiActions.onRunDomains,
    } : null,
    aiActions.onRunEmbeddings ? {
      key: 'embeddings',
      label: 'Build semantic',
      icon: Brain,
      title: 'Generate embeddings and 2D projection',
      onClick: aiActions.onRunEmbeddings,
    } : null,
    aiActions.onRunLabels ? {
      key: 'labels',
      label: 'Labels inference',
      icon: Hash,
      title: 'Classify pages by tags and intent',
      onClick: aiActions.onRunLabels,
    } : null,
    aiActions.onClassify ? {
      key: 'classify',
      label: 'Classify',
      icon: Wand2,
      title: 'Assign topical categories to all pages',
      onClick: aiActions.onClassify,
    } : null,
    aiActions.onClearCache ? {
      key: 'clear',
      label: 'Clear cache',
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
