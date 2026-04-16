import type { PageIntent } from '../core/types'

const STATIC_INTENT_BY_EXTENSION: Record<string, PageIntent> = {
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  odt: 'document',
  csv: 'document',
  txt: 'document',
  rtf: 'document',
  md: 'document',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  avif: 'image',
  tiff: 'image',
  ico: 'image',
  mp4: 'video',
  webm: 'video',
  avi: 'video',
  mov: 'video',
  mkv: 'video',
  m4v: 'video',
  ogv: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  aac: 'audio',
  m4a: 'audio',
  opus: 'audio',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  rar: 'archive',
  '7z': 'archive',
  dmg: 'archive',
  iso: 'archive',
  json: 'data',
  parquet: 'data',
  sql: 'data',
  xml: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'data',
  db: 'data',
  sqlite: 'data',
  js: 'code',
  ts: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  java: 'code',
  cpp: 'code',
  c: 'code',
  css: 'code',
}

export function detectStaticIntent(url: string): PageIntent | undefined {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.toLowerCase()
    const slashIndex = path.lastIndexOf('/')
    const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path
    const dotIndex = fileName.lastIndexOf('.')
    if (dotIndex <= 0 || dotIndex === fileName.length - 1) return undefined
    const extension = fileName.slice(dotIndex + 1)
    return STATIC_INTENT_BY_EXTENSION[extension]
  } catch {
    return undefined
  }
}

export function effectiveIntent(
  item: { staticIntent?: PageIntent; intent?: PageIntent },
): PageIntent | undefined {
  return item.staticIntent ?? item.intent
}
