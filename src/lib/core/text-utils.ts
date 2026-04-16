/**
 * Cleans page titles to improve embedding quality by removing noise.
 */
export function cleanTitle(title: string, domain?: string): string {
  if (!title) return ''
  
  let cleaned = title.trim()

  // 1. Remove common redundant suffixes/prefixes often found in titles
  // Remove site name if it appears after a separator
  const separators = [' | ', ' — ', ' – ', ' — ', ' - ', ' » ', ' « ', ' • ', ' · ']
  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      const parts = cleaned.split(sep).map(p => p.trim())
      
      // Heuristic: usually the first part is the content, subsequent parts are branding/category
      // Unless the first part is very short and the second is long (e.g. "Blog | My Very Long Article Title")
      if (parts[0].length < 5 && parts[1] && parts[1].length > parts[0].length) {
        cleaned = parts[1]
      } else {
        cleaned = parts[0]
      }
      break
    }
  }

  // 2. Remove domain name if still present (e.g. "My Page - site.com")
  if (domain) {
    const domainClean = domain.replace(/^www\./i, '').toLowerCase()
    const domainParts = domainClean.split('.')
    const mainName = domainParts[0]

    // Remove direct matches of domain or its main part if it looks like a suffix
    const suffixRegex = new RegExp(`[\\s\\-\\|\\—]+(${domainClean}|${mainName})$`, 'i')
    cleaned = cleaned.replace(suffixRegex, '').trim()
  }

  // 3. Remove Emojis and special decorative symbols from start/end
  // Specifically targeting decorative non-alphanumeric symbols.
  // We use categories: Symbol (S), Emoji, etc., but exclude Numbers (N) and Letters (L)
  const stripStartRegex = /^[\p{S}\p{Emoji}\s\u2300-\u23FF\u2B00-\u2BFF\u2190-\u21FF\u2000-\u206F]+/gu
  const stripEndRegex = /[\p{S}\p{Emoji}\s\u2300-\u23FF\u2B00-\u2BFF\u2190-\u21FF\u2000-\u206F!?;.,]+$/gu
  
  cleaned = cleaned.replace(stripStartRegex, '')
  cleaned = cleaned.replace(stripEndRegex, '')

  // 4. Remove redundant parenthetical info if it repeats title content
  // e.g. "1littlecoder (1littlecoder)" -> "1littlecoder"
  cleaned = cleaned.replace(/\(([^)]+)\)/g, (match, group) => {
    const g = group.trim().toLowerCase()
    const rest = cleaned.replace(match, '').toLowerCase()
    if (rest.includes(g)) return ''
    return match
  })

  // 5. Final trim and fallback
  cleaned = cleaned.trim()
  
  // If cleaning resulted in an empty string or tiny string, fallback to original
  if (cleaned.length < 2) return title.trim()

  return cleaned
}
