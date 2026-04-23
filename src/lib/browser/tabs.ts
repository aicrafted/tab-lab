import type { TabItem } from '../core/types'
import { parseDomain } from '../core/utils'

/** Returns all open tabs across all windows. */
export async function getAllTabs(): Promise<TabItem[]> {
  const [chromeTabs, groups] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups?.query({}).catch(() => [] as chrome.tabGroups.TabGroup[]) ?? Promise.resolve([] as chrome.tabGroups.TabGroup[]),
  ])

  const groupMap = new Map<number, { title: string; color: string }>(
    groups.map(g => [g.id, { title: g.title ?? '', color: g.color }]),
  )

  return chromeTabs
    .filter((t): t is chrome.tabs.Tab & { id: number; url: string } =>
      t.id !== undefined && !!t.url
    )
    .map(t => {
      const domain = parseDomain(t.url)
      const inGroup = t.groupId !== -1
      const groupInfo = inGroup ? groupMap.get(t.groupId!) : undefined

      return {
        id: t.id,
        windowId: t.windowId,
        url: t.url,
        title: t.title || t.url,
        domain,
        favIconUrl: t.favIconUrl,
        lastAccessed: t.lastAccessed ?? Date.now(),
        ...(inGroup && groupInfo
          ? { groupId: t.groupId!, groupName: groupInfo.title, groupColor: groupInfo.color }
          : {}),
      }
    })
}
