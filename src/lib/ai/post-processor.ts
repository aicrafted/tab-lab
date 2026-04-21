import { chatComplete } from './llm'
import { getCached, setCached } from '../core/storage'
import { consolidateCategories } from './prompts'
import type { LlmSettings } from '../core/types'
import { aiPipelineLog } from '../core/logger'
import { createLoggerProgress } from '../core/progress'

/** 
 * New generation category post-processor.
 * Consolidation Phase: Groups redundant or near-duplicate labels into a single representative version.
 */
export async function refineCategoryLabels(
  labelsWithCounts: { label: string; count: number }[],
  settings: LlmSettings,
  maxCount: number = Infinity,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (labelsWithCounts.length === 0) return {}
  
  // Filter labels based on frequency threshold
  const candidates = labelsWithCounts.filter(l => l.count <= maxCount)
  
  if (candidates.length <= 1) {
    return Object.fromEntries(labelsWithCounts.map(l => [l.label, l.label]))
  }
  
  const tracker = createLoggerProgress('refineCategoryLabels', 1)
  aiPipelineLog.info('refine: consolidating labels', { totalLabels: labelsWithCounts.length, candidates: candidates.length, maxCount })

  try {
    const inputLabels = new Set(labelsWithCounts.map(l => l.label))
    
    // 1. Get clusters of duplicates from LLM (only for candidates)
    const response = await chatComplete(
      consolidateCategories.system(),
      consolidateCategories.user(candidates),
      settings,
      8000, // Very large output allowed for many groups
      { metricKey: 'post-process-consolidation', signal }
    )

    aiPipelineLog.info('refine: consolidation LLM response', { response: response.slice(0, 500) })

    const groups = consolidateCategories.parseResponse(response)
    const mapping: Record<string, string> = {}
    
    // Initialize mapping with identity (every label maps to itself)
    for (const item of labelsWithCounts) {
      mapping[item.label] = item.label
    }

    // 2. Process groups: pick the most frequent label as target
    const countMap = Object.fromEntries(labelsWithCounts.map(l => [l.label, l.count]))

    for (const group of groups) {
      if (!Array.isArray(group)) continue
      
      // Only keep labels that were actually in the input and are distinct in group
      const validGroup = [...new Set(group.filter(l => inputLabels.has(l)))]
      if (validGroup.length < group.length) {
        aiPipelineLog.warn('refine: filtered out hallucinated labels from group', { 
          original: group, 
          filtered: validGroup,
          removed: group.filter(l => !inputLabels.has(l))
        })
      }
      if (validGroup.length < 2) continue
      
      // Find the label in this group with the highest count
      let target = validGroup[0]
      let maxCount = -1
      
      for (const label of validGroup) {
        const count = countMap[label] ?? 0
        if (count > maxCount) {
          maxCount = count
          target = label
        }
      }

      // Map all members of the group to the target
      for (const label of validGroup) {
        if (label in mapping) {
          mapping[label] = target
        }
      }
    }

    tracker.done()
    return mapping
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err
    aiPipelineLog.error('refineCategoryLabels critical failure', { err })
    tracker.done({ error: true })
    return Object.fromEntries(labelsWithCounts.map(l => [l.label, l.label]))
  }
}



/** 
 * Updates storage with new refined categories.
 * Ensures a single-level structure where category and parentCategory are the same (the umbrella).
 */
export async function applyRefinedCategories(
  items: { url: string; originalCategory: string }[],
  mapping: Record<string, string>,
  onUpdate: (updates: { url: string; category: string; parentCategory: string }[]) => void,
): Promise<void> {
  const updates: { url: string; category: string; parentCategory: string }[] = []
  
  for (const item of items) {
    const target = mapping[item.originalCategory] || item.originalCategory
    const entry = await getCached(item.url)
    
    // We update both to the same value to emphasize single-level structure
    // but we keep parentCategory field to maintain the "essence" of the data model.
    await setCached(item.url, {
      ...entry,
      category: target,
      parentCategory: target,
      processedAt: Date.now(),
    })
    
    updates.push({ url: item.url, category: target, parentCategory: target })
  }
  
  if (updates.length > 0) onUpdate(updates)
}
