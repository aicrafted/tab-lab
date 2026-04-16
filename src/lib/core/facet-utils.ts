export function parseCategoryFacetTokens(values: string[]): {
  parentTokens: Set<string>
  childTokens: Set<string>
} {
  const parentTokens = new Set<string>()
  const childTokens = new Set<string>()
  for (const value of values) {
    if (value.startsWith('parent:')) {
      const parent = value.slice('parent:'.length).trim()
      if (parent) parentTokens.add(parent)
      continue
    }
    if (value.startsWith('child:')) {
      const child = value.slice('child:'.length).trim()
      if (child) childTokens.add(child)
      continue
    }
    const legacyValue = value.trim()
    if (legacyValue) childTokens.add(legacyValue)
  }
  return { parentTokens, childTokens }
}
