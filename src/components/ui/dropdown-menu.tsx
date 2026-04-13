import * as React from 'react'
import { cn } from '@/lib/utils'

interface DropdownMenuProps {
  trigger: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
  align?: 'left' | 'right'
}

export function DropdownMenu({
  trigger,
  children,
  className,
  contentClassName,
  align = 'left',
}: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const root = rootRef.current
      if (!root) return
      if (!root.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        {trigger}
      </button>
      {open && (
        <div
          className={cn(
            'absolute top-full z-30 mt-1 min-w-44 rounded-md border border-border bg-card p-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            contentClassName,
          )}
          role="menu"
        >
          {React.Children.map(children, (child) => {
            if (!React.isValidElement(child)) return child
            return React.cloneElement(child as React.ReactElement<{ onSelect?: () => void }>, {
              onSelect: () => setOpen(false),
            })
          })}
        </div>
      )}
    </div>
  )
}

interface DropdownMenuItemProps {
  children: React.ReactNode
  onClick: () => void
  onSelect?: () => void
  title?: string
  className?: string
}

export function DropdownMenuItem({
  children,
  onClick,
  onSelect,
  title,
  className,
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      title={title}
      role="menuitem"
      onClick={() => {
        void onClick()
        onSelect?.()
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

