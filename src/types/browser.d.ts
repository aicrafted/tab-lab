// Firefox extension global — mirrors `chrome` but adds Firefox-only APIs
declare const browser: typeof chrome & {
  sidebarAction?: {
    open(): Promise<void>
    close(): Promise<void>
    toggle(): Promise<void>
  }
}

