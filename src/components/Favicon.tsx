import { createContext, useContext } from 'react'
import { cn } from '@/lib/core/utils'

const AVATAR_COLORS = [
  'bg-primary/20 text-primary',
  'bg-accent/20 text-yellow-700',
  'bg-blue-900/40 text-blue-300',
  'bg-purple-900/40 text-purple-300',
  'bg-rose-900/40 text-rose-300',
  'bg-teal-900/40 text-teal-300',
  'bg-orange-900/40 text-orange-300',
]

const ICON_RETRY_DELAY_MS = 30_000
const iconFailureCooldownUntil = new Map<string, number>()

function pickColor(domain: string): string {
  let hash = 0
  for (const ch of domain) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function isIconOnCooldown(url: string | undefined): boolean {
  if (!url) return false
  const until = iconFailureCooldownUntil.get(url)
  if (!until) return false
  if (Date.now() >= until) {
    iconFailureCooldownUntil.delete(url)
    return false
  }
  return true
}

function markIconFailure(url: string | undefined): void {
  if (!url) return
  iconFailureCooldownUntil.set(url, Date.now() + ICON_RETRY_DELAY_MS)
}

interface FaviconProps {
  domain: string
  /** Pre-resolved URL - only safe values (data:, https:, or chrome-extension:). */
  src?: string
  className?: string
}

/**
 * Maps domain -> favicon URL from open tabs.
 * Built in App.tsx from TabItem.favIconUrl.
 */
export const DomainIconContext = createContext<ReadonlyMap<string, string>>(new Map())

/**
 * Renders a favicon image with a three-tier fallback:
 * 1. `src` prop (if provided and not in cooldown)
 * 2. Domain icon from `DomainIconContext` (if src is missing/failed, and domain has an icon from an open tab)
 * 3. Deterministic letter avatar
 *
 * Does NOT use chrome://favicon* URLs - those are blocked as img src in MV3.
 * For tabs, pass tab.favIconUrl (Chrome resolves it for you).
 * For bookmarks, leave src undefined -> falls through to domain context -> letter avatar.
 */
export function Favicon({ domain, src, className }: FaviconProps) {
  const domainIcons = useContext(DomainIconContext)
  const domainIcon = domainIcons.get(domain)
  const letter = (domain[0] ?? '?').toUpperCase()
  const canUseSrc = Boolean(src) && !isIconOnCooldown(src)
  const canUseDomainIcon = Boolean(domainIcon) && domainIcon !== src && !isIconOnCooldown(domainIcon)

  if (canUseSrc && src) {
    return (
      <img
        src={src}
        alt=""
        width={16}
        height={16}
        className={cn("h-4 w-4 shrink-0 rounded-sm object-contain", className)}
        onError={() => markIconFailure(src)}
      />
    )
  }

  if (canUseDomainIcon && domainIcon) {
    return (
      <img
        src={domainIcon}
        alt=""
        width={16}
        height={16}
        className={cn("h-4 w-4 shrink-0 rounded-sm object-contain", className)}
        onError={() => markIconFailure(domainIcon)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold leading-none select-none',
        pickColor(domain),
        className
      )}
      aria-hidden
    >
      {letter}
    </div>
  )
}

