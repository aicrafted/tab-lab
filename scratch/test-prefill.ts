import { detectPlatform } from './src/lib/platform-detection'
import { getDomainInfo } from './src/lib/domain-enricher'

async function testPrefill() {
  console.log('--- Testing Plateform Detection ---')
  console.log('google.com:', detectPlatform('google.com'))
  console.log('github.com:', detectPlatform('github.com'))
  console.log('sub.github.com:', detectPlatform('sub.github.com'))
  console.log('unknown-xyz.com:', detectPlatform('unknown-xyz.com'))

  console.log('\n--- Testing Domain Info (Prefill Priority) ---')
  const emptyCache = new Map()
  
  const google = getDomainInfo('google.com', emptyCache)
  console.log('google.com info:', google)
  
  const youtube = getDomainInfo('youtube.com', emptyCache)
  console.log('youtube.com info:', youtube)

  const githubSub = getDomainInfo('my-repo.github.com', emptyCache)
  console.log('my-repo.github.com info:', githubSub)
}

testPrefill().catch(console.error)
