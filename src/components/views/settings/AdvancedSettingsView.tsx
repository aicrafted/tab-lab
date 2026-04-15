import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DEFAULT_LOCAL_NETWORKS } from '@/lib/types'
import type { ViewProps } from '@/components/views/types'

export function AdvancedSettingsView({ llmSettings, onSaveSettings }: ViewProps) {
  if (!llmSettings || !onSaveSettings) return <div>Settings state missing</div>

  const [localNetworksText, setLocalNetworksText] = useState(llmSettings.localNetworks.join('\n'))

  const handleSave = () => {
    const localNetworks = localNetworksText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const nextLocalNetworks = localNetworks.length > 0 ? localNetworks : [...DEFAULT_LOCAL_NETWORKS]
    
    onSaveSettings({
      ...llmSettings,
      localNetworks: nextLocalNetworks,
    })
  }

  return (
    <div className="max-w-4xl space-y-6 py-4">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Network & Security</h3>
        
        <div className="space-y-4 rounded-lg border border-border bg-card/50 p-6">
          <div className="space-y-2">
            <p className="text-sm font-medium">Local Network Patterns</p>
            <p className="text-xs text-muted-foreground">
              Define which hostnames or IP ranges are considered "local" (one per line). 
              AI processing is often disabled or simplified for local/intranet URLs for privacy.
            </p>
            <textarea
              value={localNetworksText}
              onChange={(e) => setLocalNetworksText(e.target.value)}
              placeholder={DEFAULT_LOCAL_NETWORKS.join('\n')}
              rows={8}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave}>
            Save Advanced Settings
          </Button>
        </div>
      </div>

      <div className="space-y-4 pt-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cache Management</h3>
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
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
