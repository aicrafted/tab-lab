import { useState } from 'react'
import { cn } from '@/lib/utils'

// Palette-safe colors for letter avatars (avoids external requests entirely)
const AVATAR_COLORS = [
  'bg-primary/20 text-primary',
  'bg-accent/20 text-yellow-700',
  'bg-blue-900/40 text-blue-300',
  'bg-purple-900/40 text-purple-300',
  'bg-rose-900/40 text-rose-300',
  'bg-teal-900/40 text-teal-300',
  'bg-orange-900/40 text-orange-300',
]

function pickColor(domain: string): string {
  let hash = 0
  for (const ch of domain) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

interface FaviconProps {
  domain: string
  /** Pre-resolved URL — only safe values (data:, https:, or chrome-extension:). */
  src?: string
}

/**
 * Renders a favicon image when a safe src is available,
 * or a deterministic letter avatar as fallback.
 *
 * Does NOT use chrome://favicon* URLs — those are blocked as img src in MV3.
 * For tabs, pass tab.favIconUrl (Chrome resolves it for you).
 * For bookmarks, leave src undefined → letter avatar.
 */
export function Favicon({ domain, src }: FaviconProps) {
  const [failed, setFailed] = useState(false)
  const letter = (domain[0] ?? '?').toUpperCase()

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={16}
        height={16}
        className="h-4 w-4 shrink-0 rounded-sm object-contain"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold leading-none select-none',
        pickColor(domain),
      )}
      aria-hidden
    >
      {letter}
    </div>
  )
}
