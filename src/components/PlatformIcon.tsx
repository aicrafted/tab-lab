import {
  BookOpen,
  Circle,
  Clapperboard,
  Code2,
  Database,
  FileText,
  Globe,
  MessageCircle,
  Music,
  Package,
  Ticket,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { KnownPlatform } from '@/lib/core/types'
import { cn } from '@/lib/core/utils'

const ICON_BY_PLATFORM: Record<KnownPlatform, LucideIcon> = {
  social: MessageCircle,
  video: Clapperboard,
  code: Code2,
  registry: Package,
  qa: MessageCircle,
  blog: FileText,
  docs: BookOpen,
  shopping: Ticket,
  news: FileText,
  ai: Database,
  tool: Wrench,
  sandbox: Code2,
  cloud: Globe,
  music: Music,
  finance: Ticket,
  ci: Code2,
  games: Ticket,
  education: BookOpen,
  email: MessageCircle,
  reference: BookOpen,
}

function asKnownPlatform(platform: string): KnownPlatform | undefined {
  if (platform in ICON_BY_PLATFORM) return platform as KnownPlatform
  return undefined
}

export function PlatformIcon({
  platform,
  className,
}: {
  platform?: string
  className?: string
}) {
  const normalized = platform ? asKnownPlatform(platform) : undefined
  const Icon = normalized ? ICON_BY_PLATFORM[normalized] : Circle
  return <Icon className={cn('h-3.5 w-3.5 text-muted-foreground/75', className)} />
}

