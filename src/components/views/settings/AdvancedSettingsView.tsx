import { Button } from '@/components/ui/button'
import type { ViewProps } from '@/components/views/types'

export function AdvancedSettingsView({ llmSettings, onSaveSettings }: ViewProps) {
  if (!llmSettings || !onSaveSettings) return <div>Settings state missing</div>

  return (
    <div className="max-w-4xl space-y-6 py-4">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cache Management</h3>
        <div className="rounded-lg border border-destructive/20 bg-card/50 p-6">
          <p className="text-sm font-medium text-destructive">Danger Zone</p>
          <p className="text-xs text-muted-foreground mb-4">
            Clearing the cache will remove all AI-generated categories, tags, and embeddings. 
            This cannot be undone.
          </p>
          <Button variant="destructive" size="sm" onClick={() => alert('Use AI Actions -> Clear instead')}>
            Clear AI Cache
          </Button>
        </div>
      </div>
    </div>
  )
}
