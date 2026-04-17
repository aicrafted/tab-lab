import { chatComplete } from './llm'
import { getCached, setCached } from '../core/storage'
import { normalizeCategories, MAP_LABELS_TO_UMBRELLAS_SYSTEM, MAP_LABELS_TO_UMBRELLAS_USER_PREFIX, MAP_LABELS_TO_UMBRELLAS_USER_MIDDLE } from './prompts'
import type { LlmSettings } from '../core/types'
import { aiPipelineLog } from '../core/logger'
import { createLoggerProgress } from '../core/progress'
import { cosineSimilarity, fetchEmbedding, fetchEmbeddingsBatch } from './embedder'

/** 
 * New generation category post-processor.
 * Phase 1: Taxonomy Discovery (Consolidates many labels into few umbrellas)
 * Phase 2: Assignment (Maps labels to umbrellas, maintaining a single-level structure)
 */
export async function refineCategoryLabels(
  rawLabels: string[],
  settings: LlmSettings,
): Promise<Record<string, string>> {
  const labels = [...new Set(rawLabels.map(l => l.trim()).filter(Boolean))]
  if (labels.length === 0) return {}
  if (labels.length === 1) return { [labels[0]]: labels[0] }
  
  const tracker = createLoggerProgress('refineCategoryLabels', labels.length)

  // PHASE 1: Taxonomy Discovery (General/Shared)
  // We ask the LLM to provide a list of high-level umbrella categories.
  aiPipelineLog.info('refine phase 1: taxonomy discovery', { totalLabels: labels.length })
  
  const discoveryResponse = await chatComplete(
    normalizeCategories.system(), 
    normalizeCategories.user(labels), 
    settings, 
    2000, 
    { metricKey: 'post-process-discovery' }
  )
  const umbrellas = normalizeCategories.parseUmbrellas(discoveryResponse)
  
  if (umbrellas.length === 0) {
    aiPipelineLog.warn('taxonomy discovery yielded no results, keeping original labels')
    tracker.done()
    return Object.fromEntries(labels.map(l => [l, l]))
  }

  aiPipelineLog.info('refine phase 1: discovered umbrellas', { count: umbrellas.length, samples: umbrellas.slice(0, 5) })

  // PHASE 2: Single-Level Assignment (New Implementation)
  // Maps original labels to discovered umbrellas.
  // We use a single-level structure: category = umbrella name.
  aiPipelineLog.info('refine phase 2: flat assignment starting')
  const mapping: Record<string, string> = {}
  
  try {
    // 1. Prepare embeddings for fallback
    const allUnique = [...new Set([...umbrellas, ...labels])]
    await fetchEmbeddingsBatch(
      allUnique.map(l => ({ url: `label:${l}`, title: l, domain: '' })),
      settings,
      () => {}
    )

    const umbrellaVectors = await Promise.all(
      umbrellas.map(async (u) => ({ label: u, vec: await fetchEmbedding(u, settings) }))
    )

    // 2. Perform mapping in batches via LLM
    const BATCH_SIZE = 50
    for (let i = 0; i < labels.length; i += BATCH_SIZE) {
      const chunk = labels.slice(i, i + BATCH_SIZE)
      const userMsg = `${MAP_LABELS_TO_UMBRELLAS_USER_PREFIX}${umbrellas.join(', ')}${MAP_LABELS_TO_UMBRELLAS_USER_MIDDLE}${chunk.join(', ')}`
      
      try {
        const response = await chatComplete(
          MAP_LABELS_TO_UMBRELLAS_SYSTEM,
          userMsg,
          settings,
          1000,
          { metricKey: 'post-process-assignment' }
        )

        const batchMap = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim())
        
        for (const label of chunk) {
          const target = batchMap[label]
          // Verify target is one of our umbrellas
          if (target && umbrellas.includes(target)) {
            mapping[label] = target
          } else {
            mapping[label] = await nliMatch(label, umbrellaVectors, settings)
          }
        }
      } catch (err) {
        aiPipelineLog.warn('LLM assignment batch failed, falling back to NLI', { chunk: chunk.slice(0, 3), err })
        for (const label of chunk) {
          mapping[label] = await nliMatch(label, umbrellaVectors, settings)
        }
      }
      tracker.progress(chunk.length)
    }

    tracker.done()
    return mapping
  } catch (err) {
    aiPipelineLog.error('refineCategoryLabels phase 2 critical failure', { err })
    tracker.done({ error: true })
    return Object.fromEntries(labels.map(l => [l, l]))
  }
}

/** Fallback to find best matching umbrella via embedding similarity. */
async function nliMatch(label: string, targets: {label: string, vec: number[]}[], settings: LlmSettings): Promise<string> {
  try {
    const vec = await fetchEmbedding(label, settings)
    let best = label
    let maxScore = -1

    for (const target of targets) {
      const score = cosineSimilarity(vec, target.vec)
      if (score > maxScore) {
        maxScore = score
        best = target.label
      }
    }
    // Consolidate if there's at least some similarity (0.35)
    return maxScore > 0.35 ? best : label
  } catch {
    return label
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
