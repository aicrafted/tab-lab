import { useState, useMemo, useEffect } from 'react'
import { 
  Search, 
  RefreshCw, 
  CloudDownload, 
  Edit3, 
  Trash2, 
  CheckCircle2,
  AlertCircle,
  Globe,
  Plus,
  Save,
  Network
} from 'lucide-react'
import type { ViewProps } from '@/components/views/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DOMAIN_PREFILL, 
  syncRemoteDomains, 
  saveDomainOverride, 
  deleteDomainOverride,
  type PrefilledDomain 
} from '@/lib/ai/domain-prefill'
import { KNOWN_PLATFORMS, DEFAULT_LOCAL_NETWORKS } from '@/lib/core/types'
import { cn } from '@/lib/core/utils'
import { Favicon } from '@/components/Favicon'

export function DomainsSettingsView({ llmSettings, onSaveSettings }: ViewProps) {
  const [search, setSearch] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  
  // Domains table state
  const [editingDomain, setEditingDomain] = useState<string | null>(null)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [editForm, setEditForm] = useState<Partial<PrefilledDomain>>({})
  const [newDomainName, setNewDomainName] = useState('')
  
  // Local Networks state
  const [localNetworksText, setLocalNetworksText] = useState(llmSettings?.localNetworks.join('\n') || '')

  // Local state to force refresh when DOMAIN_PREFILL changes
  const [kbVersion, setKbVersion] = useState(0)

  useEffect(() => {
    const handler = (changes: any, area: string) => {
      if (area === 'local' && (changes.domains_remote || changes.domains_overrides)) {
        setKbVersion(v => v + 1)
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  const filteredDomains = useMemo(() => {
    const q = search.toLowerCase()
    return Object.entries(DOMAIN_PREFILL)
      .filter(([domain, data]) => {
        return domain.includes(q) || data.category.toLowerCase().includes(q) || data.description.toLowerCase().includes(q)
      })
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [search, kbVersion])

  const handleSync = async () => {
    if (!llmSettings?.domains.remoteUrl) return
    setIsSyncing(true)
    setSyncError(null)
    try {
      await syncRemoteDomains(llmSettings.domains.remoteUrl)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSyncing(false)
    }
  }

  const startEdit = (domain: string, data: PrefilledDomain) => {
    setEditingDomain(domain)
    setEditForm({ ...data })
    setIsAddingNew(false)
  }

  const startAdd = () => {
    setEditingDomain('New Domain')
    setEditForm({ category: '', description: '', platform: 'tool' as any })
    setNewDomainName('')
    setIsAddingNew(true)
  }

  const saveEdit = async () => {
    const domain = isAddingNew ? newDomainName.trim().toLowerCase() : editingDomain
    if (!domain) return
    await saveDomainOverride(domain, editForm)
    setEditingDomain(null)
    setIsAddingNew(false)
  }

  const removeOverride = async (domain: string) => {
    await deleteDomainOverride(domain)
  }

  const saveLocalNetworks = () => {
    if (!llmSettings || !onSaveSettings) return
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

  // Stats
  const stats = useMemo(() => {
    const all = Object.values(DOMAIN_PREFILL)
    return {
      total: all.length,
      customCount: all.filter(d => d.source === 'custom').length,
      remoteCount: all.filter(d => d.source === 'remote').length,
      bundledCount: all.filter(d => d.source === 'bundled').length,
    }
  }, [kbVersion])

  return (
    <div className="flex h-full flex-col space-y-6 py-2 pr-1 scrollbar-hide">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Remote Sync Config */}
          <div className="space-y-4 rounded-xl border border-border bg-card/50 p-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CloudDownload className="h-4 w-4 text-primary" />
                Remote Domains Catalog
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Update URL</label>
                <Input 
                  value={llmSettings?.domains.remoteUrl || ''} 
                  onChange={(e) => onSaveSettings?.({
                    ...llmSettings!,
                    domains: { ...llmSettings!.domains, remoteUrl: e.target.value }
                  })}
                  placeholder="https://..."
                  className="h-8 bg-background text-xs"
                />
              </div>
            </div>
            
            <div className="flex items-center justify-between mt-4">
              <div className="space-y-0.5">
                {llmSettings?.domains.lastSyncAt ? (
                  <p className="text-[10px] text-muted-foreground">
                    Synced: {new Date(llmSettings.domains.lastSyncAt).toLocaleDateString()}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">Never synced</p>
                )}
              </div>
              <Button 
                variant="outline" 
                size="sm"
                className="h-8 gap-2 text-xs" 
                onClick={handleSync}
                disabled={isSyncing}
              >
                {isSyncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                Sync Now
              </Button>
            </div>
            {syncError && (
              <p className="mt-2 text-[10px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {syncError}
              </p>
            )}
          </div>

          {/* Local Network Patterns */}
          <div className="space-y-4 rounded-xl border border-border bg-card/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Network className="h-4 w-4 text-primary" />
                Local Network Patterns
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 gap-1.5 text-xs text-primary" onClick={saveLocalNetworks}>
                <Save className="h-3.5 w-3.5" />
                Save Patterns
              </Button>
            </div>
            <textarea
              value={localNetworksText}
              onChange={(e) => setLocalNetworksText(e.target.value)}
              placeholder={DEFAULT_LOCAL_NETWORKS.join('\n')}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[11px] text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring scrollbar-hide"
            />
          </div>
        </div>
      </div>

      {/* 2. Knowledge Explorer Table */}
      <div className="flex flex-col rounded-xl border border-border bg-card/50 overflow-hidden">
        <div className="border-b px-4 py-3 bg-muted/20 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search domains or categories..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 bg-background border-none shadow-none focus-visible:ring-1"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground border">
              <span className="flex items-center gap-1"><Badge variant="outline" className="h-1.5 w-1.5 rounded-full bg-blue-500 p-0 border-0" /> Bundled: {stats.bundledCount}</span>
              <span className="flex items-center gap-1"><Badge variant="outline" className="h-1.5 w-1.5 rounded-full bg-green-500 p-0 border-0" /> Remote: {stats.remoteCount}</span>
              <span className="flex items-center gap-1"><Badge variant="outline" className="h-1.5 w-1.5 rounded-full bg-amber-500 p-0 border-0" /> Custom: {stats.customCount}</span>
            </div>
            <Button size="sm" className="h-9 gap-2" onClick={startAdd}>
              <Plus className="h-4 w-4" />
              Add Custom Domain
            </Button>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[500px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead className="w-[180px] text-[11px] uppercase font-bold">Domain</TableHead>
                <TableHead className="text-[11px] uppercase font-bold">Category</TableHead>
                <TableHead className="text-[11px] uppercase font-bold">Description</TableHead>
                <TableHead className="w-[120px] text-[11px] uppercase font-bold">Platform</TableHead>
                <TableHead className="w-[80px] text-[11px] uppercase font-bold">Source</TableHead>
                <TableHead className="w-[80px] text-right text-[11px] uppercase font-bold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDomains.map(([domain, data]) => (
                <TableRow key={domain} className="hover:bg-muted/30 transition-colors border-border/50">
                  <TableCell className="py-2">
                    <div className="flex items-center gap-2">
                      <Favicon domain={domain} className="h-4 w-4 rounded-sm" />
                      <span className="truncate max-w-[140px] text-sm font-medium" title={domain}>{domain}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-[11px] text-muted-foreground">{data.category}</TableCell>
                  <TableCell className="py-2 text-[11px] text-muted-foreground/85">
                    <span className="line-clamp-2" title={data.description}>{data.description}</span>
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge variant="outline" className="text-[10px] py-0 font-normal border-primary/20 bg-primary/5">
                      {data.platform}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge 
                      className={cn(
                        "text-[9px] px-1.5 py-0 uppercase font-black border-none shadow-none",
                        data.source === 'custom' ? "bg-amber-500/10 text-amber-600" :
                        data.source === 'remote' ? "bg-green-500/10 text-green-600" :
                        "bg-blue-500/10 text-blue-600"
                      )}
                      variant="outline"
                    >
                      {data.source}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => startEdit(domain, data)}>
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      {data.source === 'custom' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => removeOverride(domain)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredDomains.length === 0 && ( search ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-xs italic">
                    No domains found matching "{search}"
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-xs italic">
                    Domains catalog is empty. Try syncing from remote.
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 3. Editor Modal */}
      {editingDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                {isAddingNew ? <Plus className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
              </div>
              <div>
                <h4 className="font-bold text-lg">{isAddingNew ? "Add Custom Domain" : editingDomain}</h4>
                <p className="text-xs text-muted-foreground">Define custom domain metadata</p>
              </div>
            </div>

            <div className="space-y-4">
              {isAddingNew && (
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Domain Name</label>
                  <Input 
                    value={newDomainName} 
                    onChange={(e) => setNewDomainName(e.target.value)}
                    placeholder="e.g. internal.company.com"
                    className="bg-background h-10"
                    autoFocus
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Category</label>
                <Input 
                  value={editForm.category || ''} 
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  placeholder="e.g. Programming, Productivity..."
                  className="bg-background h-10"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Platform Type</label>
                <div className="grid grid-cols-4 gap-1.5 p-1 rounded-lg bg-muted/30 border border-border/50">
                  {KNOWN_PLATFORMS.map(p => (
                    <button
                      key={p}
                      onClick={() => setEditForm({ ...editForm, platform: p })}
                      className={cn(
                        "text-[9px] px-1 py-1.5 rounded-md border transition-all truncate font-medium",
                        editForm.platform === p 
                          ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                          : "bg-transparent hover:bg-background text-muted-foreground border-transparent hover:border-border"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Site Description</label>
                <textarea 
                  value={editForm.description || ''} 
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Tell AI more about this site to help with classification..."
                  rows={4}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring transition-shadow"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-8">
              <Button variant="ghost" onClick={() => setEditingDomain(null)} className="rounded-xl">Cancel</Button>
              <Button onClick={saveEdit} className="gap-2 rounded-xl px-6" disabled={isAddingNew && !newDomainName}>
                <CheckCircle2 className="h-4 w-4" />
                {isAddingNew ? "Add Domain" : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
