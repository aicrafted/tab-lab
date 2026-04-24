import { X } from 'lucide-react'
import type { DeepPartial } from '@/lib/core/utils'
import type { SidePanelSettings } from './sidepanel-settings'
import { IS_FIREFOX } from '@/lib/core/browser-detect'

interface SidePanelSettingsPanelProps {
  settings: SidePanelSettings
  onUpdate: (patch: DeepPartial<SidePanelSettings>) => void
  onClose: () => void
}

export function SidePanelSettingsPanel({ settings, onUpdate, onClose }: SidePanelSettingsPanelProps) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-[#888]">Sections</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-[#555] transition-colors hover:text-[#888]"
          title="Close settings"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-1">
        <SectionToggleRow
          label="Summary"
          value={settings.sections.summary}
          onChange={(value) => onUpdate({ sections: { summary: value } })}
        />
        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-[#888]">Recent Tabs</span>
          <select
            value={settings.sections.recentTabsLimit}
            onChange={(e) => onUpdate({ sections: { recentTabsLimit: Number(e.target.value) as 0 | 5 | 10 | 20 } })}
            className="rounded border border-[#333] bg-[#111] px-1.5 py-0.5 text-xs text-[#ccc] focus:outline-none"
          >
            <option value={0}>hide</option>
            <option value={5}>5 items</option>
            <option value={10}>10 items</option>
            <option value={20}>20 items</option>
          </select>
        </div>
        <SectionToggleRow
          label="Duplicates"
          value={settings.sections.duplicates}
          onChange={(value) => onUpdate({ sections: { duplicates: value } })}
        />
        <SectionToggleRow
          label="Similar Tabs"
          value={settings.sections.similarTabs}
          onChange={(value) => onUpdate({ sections: { similarTabs: value } })}
        />
        <SectionToggleRow
          label="Related Bookmarks"
          value={settings.sections.relatedBookmarks}
          onChange={(value) => onUpdate({ sections: { relatedBookmarks: value } })}
        />
        <SectionToggleRow
          label="Search"
          value={settings.sections.search}
          onChange={(value) => onUpdate({ sections: { search: value } })}
        />
      </div>

      <div className="my-2 border-t border-[#2a2a2a]" />

      <div>
        <h3 className="text-xs font-medium text-[#888]">Summarization</h3>
        <div className="mt-1 flex items-center justify-between py-1">
          <span className="text-xs text-[#888]">Provider</span>
          <select
            value={settings.summarization.provider}
            onChange={(e) => onUpdate({ summarization: { provider: e.target.value as SidePanelSettings['summarization']['provider'] } })}
            className="rounded border border-[#333] bg-[#111] px-1.5 py-0.5 text-xs text-[#ccc] focus:outline-none"
          >
            <option value="defined">Defined in settings</option>
            {!IS_FIREFOX && <option value="gemini-nano">Gemini Nano</option>}
            {!IS_FIREFOX && <option value="browser-ml">Browser ML</option>}
            <option value="lmstudio">LM Studio / Ollama</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>
        <label className="mt-1 block text-xs text-[#888]">
          System prompt
          <textarea
            value={settings.summarization.systemPrompt}
            onChange={(e) => onUpdate({ summarization: { systemPrompt: e.target.value } })}
            rows={4}
            className="mt-1 w-full resize-none rounded border border-[#333] bg-[#111] p-2 text-xs text-[#aaa] focus:border-[#555] focus:outline-none"
          />
        </label>
      </div>
    </div>
  )
}

function SectionToggleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-[#888]">{label}</span>
      <select
        value={value ? 'show' : 'hide'}
        onChange={(e) => onChange(e.target.value === 'show')}
        className="rounded border border-[#333] bg-[#111] px-1.5 py-0.5 text-xs text-[#ccc] focus:outline-none"
      >
        <option value="hide">hide</option>
        <option value="show">show</option>
      </select>
    </div>
  )
}
