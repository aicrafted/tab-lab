import {
  Archive,
  BookOpen,
  Circle,
  Clapperboard,
  Code2,
  Database,
  File,
  FileText,
  Globe,
  Image as ImageIcon,
  MessageCircle,
  Music,
  Package,
  Ticket,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { PageIntent } from '@/lib/types'
import { cn } from '@/lib/utils'

const ICON_BY_INTENT: Record<PageIntent, LucideIcon> = {
  article: FileText,
  reference: BookOpen,
  tool: Wrench,
  service: Globe,
  transactional: Ticket,
  video: Clapperboard,
  repository: Package,
  document: File,
  image: ImageIcon,
  audio: Music,
  archive: Archive,
  data: Database,
  code: Code2,
  other: Circle,
}

function asPageIntent(intent: string): PageIntent | undefined {
  if (intent in ICON_BY_INTENT) return intent as PageIntent
  return undefined
}

export function IntentIcon({
  intent,
  className,
}: {
  intent?: string
  className?: string
}) {
  const normalized = intent ? asPageIntent(intent) : undefined
  const Icon = normalized ? ICON_BY_INTENT[normalized] : Circle
  return <Icon className={cn('h-3.5 w-3.5 text-muted-foreground/75', className)} />
}
