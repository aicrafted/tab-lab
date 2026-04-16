import { describe, it, expect, vi, beforeEach } from 'vitest'
import { classifyVectorNli, getCategoryLabelEmbeddings } from '../nli-engine'
import * as embedder from '../embedder'
import type { LlmSettings } from '../../core/types'

// Mock embedder
vi.mock('../embedder', () => ({
  cosineSimilarity: vi.fn(),
  fetchEmbedding: vi.fn(),
}))

describe('nli-engine', () => {
  const mockSettings = {
    providers: {
      browserMl: { embeddingModel: 'test-model' }
    },
    nliCategories: [
      { label: 'Tech', descriptor: 'technology and coding' },
      { label: 'Cooking', descriptor: 'recipes and food' }
    ],
    nliConfidenceThreshold: 0.5
  } as unknown as LlmSettings

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset cache if possible (or just use different model names)
  })

  describe('getCategoryLabelEmbeddings', () => {
    it('should fetch and cache embeddings', async () => {
      vi.mocked(embedder.fetchEmbedding)
        .mockResolvedValueOnce([1, 0])
        .mockResolvedValueOnce([0, 1])

      const result = await getCategoryLabelEmbeddings(mockSettings)
      expect(result.get('Tech')).toEqual([1, 0])
      expect(result.get('Cooking')).toEqual([0, 1])
      expect(embedder.fetchEmbedding).toHaveBeenCalledTimes(2)

      // Test caching
      await getCategoryLabelEmbeddings(mockSettings)
      expect(embedder.fetchEmbedding).toHaveBeenCalledTimes(2) // No new calls
    })
  })

  describe('classifyVectorNli', () => {
    it('should classify item into the most similar category', async () => {
      vi.mocked(embedder.fetchEmbedding)
        .mockResolvedValueOnce([1, 0])
        .mockResolvedValueOnce([0, 1])

      vi.mocked(embedder.cosineSimilarity)
        .mockImplementation((_v1, v2) => {
          if (v2[0] === 1) return 0.9 // Tech
          return 0.1 // Cooking
        })

      const result = await classifyVectorNli([1, 0], mockSettings)
      expect(result?.label).toBe('Tech')
      expect(result?.score).toBe(0.9)
    })

    it('should return null if confidence is below threshold', async () => {
      vi.mocked(embedder.fetchEmbedding).mockResolvedValue([1, 0])
      vi.mocked(embedder.cosineSimilarity).mockReturnValue(0.3) // Below 0.5

      const result = await classifyVectorNli([1, 1], mockSettings)
      expect(result).toBeNull()
    })
  })
})
