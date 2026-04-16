import { vi } from 'vitest'

// Mock chrome API
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
    }
  },
  tabs: {
    query: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }
  },
  bookmarks: {
    getTree: vi.fn(),
    create: vi.fn(),
  }
}

vi.stubGlobal('chrome', chromeMock)

// Mock other browser globals if needed
vi.stubGlobal('AbortSignal', global.AbortSignal)
vi.stubGlobal('fetch', vi.fn())
