import { kMeans, mergeSmallClusters, MIN_CLUSTER_SIZE } from '../ai/cluster'
import { classifyByClusters, SPLIT_THRESHOLD } from '../ai/classifier'
import type { DomainInfo } from '../ai/domain-enricher'
import { aiPipelineLog } from '../core/logger'
import { detectPlatform } from '../core/platform-detection'
import type { KnownPlatform, LlmSettings } from '../core/types'
import { normalizeUrlForCache } from '../core/url-utils'
import type { PipelineCallbacks, TaskHandle } from './types'

export class ClusteringStrategy {
  constructor(
    private readonly callbacks: PipelineCallbacks,
    private readonly isRunActive: (runId: number) => boolean,
  ) {}

  async runTwoPassClustering(
    runId: number,
    items: { url: string; title: string; domain: string; embedding: number[] }[],
    settings: LlmSettings,
    task: TaskHandle,
    domainMap: Map<string, DomainInfo>,
    signal?: AbortSignal,
  ): Promise<void> {
    const useNli = settings.tasks.classification.method === 'nli'
    // Pass 1: Global clustering (L1 - Parent categories)
    const uniquePlatformCount = new Set(
      items.map((item) => detectPlatform(item.domain, domainMap)).filter((platform): platform is KnownPlatform => platform !== undefined),
    ).size
    const itemsByNormalizedUrl = new Map(items.map((item) => [normalizeUrlForCache(item.url), item]))
    const k1 = Math.max(3, Math.min(150, Math.max(Math.ceil(items.length / 8), uniquePlatformCount)))

    aiPipelineLog.info('two-pass clustering P1 start', { total: items.length, k1 })
    const vectorItems = items.map(({ url, embedding }) => ({ url, embedding }))
    const rawClustersP1 = kMeans(vectorItems, k1)
    const clustersP1 = mergeSmallClusters(rawClustersP1, vectorItems, MIN_CLUSTER_SIZE)

    const parentNames = await classifyByClusters(items, clustersP1, settings, (updates) => {
      if (!this.isRunActive(runId)) return
      task.progress(updates.length / 2) // Pass 1 is 50% of the work
      this.callbacks.onCategoryUpdate(updates)
      this.callbacks.onClusterUpdate(updates.map((u) => ({ url: u.url, clusterId: u.clusterId })))
    }, domainMap, signal)

    this.callbacks.onClusterNames(parentNames)

    if (useNli) {
      task.progress(items.length / 2)
      aiPipelineLog.info('two-pass clustering P2 skipped for NLI mode')
      return
    }

    // Pass 2: Refinement of large clusters (L2 - Child categories)
    aiPipelineLog.info('two-pass clustering P2 starting refinement')

    for (const cluster of clustersP1) {
      if (!this.isRunActive(runId)) break

      const shouldRefine = cluster.members.length >= SPLIT_THRESHOLD
      if (!shouldRefine) {
        // Small clusters don't get Pass 2, so we mark them as complete
        task.progress(cluster.members.length / 2)
        continue
      }

      const parentCategory = parentNames.get(cluster.clusterId) || 'Other'
      const clusterItems = cluster.members
        .map((url) => itemsByNormalizedUrl.get(normalizeUrlForCache(url)))
        .filter((it): it is typeof items[0] => Boolean(it))

      if (clusterItems.length < MIN_CLUSTER_SIZE * 2) {
        task.progress(cluster.members.length / 2)
        continue
      }

      const k2 = Math.min(10, Math.ceil(clusterItems.length / 4))
      const vectorItems2 = clusterItems.map(({ url, embedding }) => ({ url, embedding }))
      const rawClustersP2 = kMeans(vectorItems2, k2)
      const subClusters = mergeSmallClusters(rawClustersP2, vectorItems2, MIN_CLUSTER_SIZE)

      if (subClusters.length <= 1) {
        task.progress(cluster.members.length / 2)
        continue
      }

      aiPipelineLog.info('two-pass clustering refinement cluster', {
        parent: parentCategory,
        clusterId: cluster.clusterId,
        size: clusterItems.length,
        subClusters: subClusters.length,
      })

      const subNames = await classifyByClusters(
        clusterItems,
        subClusters.map((sc) => ({ ...sc, clusterId: sc.clusterId + (cluster.clusterId + 1) * 1000 })),
        settings,
        (updates) => {
          if (!this.isRunActive(runId)) return
          task.progress(updates.length / 2) // Pass 2 is the other 50%
          this.callbacks.onCategoryUpdate(updates)
          this.callbacks.onClusterUpdate(updates.map((u) => ({ url: u.url, clusterId: u.clusterId })))
        },
        domainMap,
        signal,
        parentCategory,
      )

      this.callbacks.onClusterNames(subNames)
    }

    aiPipelineLog.info('two-pass clustering done')
  }
}
