// 最小验收：不启动 DSH，用假 ctx 检查提示词、工具、SQLite 和能力目录。
// 运行：node test/verify.mjs

import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { apply } from '../lib/index.js'

const home = '/tmp/dsh-private-companion-verify'
rmSync(home, { recursive: true, force: true })
process.env.DSH_HOME = home

const sections = []
const tools = []
const events = []
const cleanups = []

const toolsService = {
  register(definition) {
    tools.push(definition)
    return () => {}
  },
  definitions() {
    return [
      { name: 'stardew_get_state', description: '看星露谷状态', parameters: {} },
      { name: 'mcp__blind_whale__water_crops', description: '给作物浇水', parameters: {} },
      { name: 'web_search', description: '搜索网页', parameters: {} },
    ]
  },
}

const ctx = {
  logger() {
    return { info() {}, warn() {}, error() {} }
  },
  systemPrompt: {
    section(definition) {
      sections.push(definition)
      return () => {}
    },
  },
  get(name) {
    return name === 'tools' ? toolsService : undefined
  },
  on(name, handler) {
    events.push({ name, handler })
    return () => {}
  },
  effect(fn) {
    const cleanup = fn()
    cleanups.push(cleanup)
    return () => {}
  },
}

apply(ctx, {
  enabled: true,
  companionId: 'xiaofeiyu',
  companionName: '小肥鱼',
  ownerId: 'owner',
  timeZone: 'Asia/Shanghai',
  memoryLimit: 5,
  injectCapabilities: true,
})

assert.equal(sections.length, 1)
assert.equal(tools.length, 12)
assert.ok(tools.some((tool) => tool.name === 'companion_status'))
assert.ok(tools.some((tool) => tool.name === 'companion_memory_write'))
assert.ok(tools.some((tool) => tool.name === 'companion_capability_pack_set'))
assert.ok(tools.some((tool) => tool.name === 'companion_session_bind'))
assert.ok(events.some((event) => event.name === 'session/event'))

const text = sections[0].text({
  agent: { session: { header: { id: 'test-session' } } },
  scope: undefined,
})
assert.match(text, /当前陪伴状态/)
assert.match(text, /小肥鱼/)

const status = tools.find((tool) => tool.name === 'companion_status')
const statusText = await status.execute({})
assert.match(statusText, /记忆：0 条/)

const write = tools.find((tool) => tool.name === 'companion_memory_write')
await write.execute({ text: '爸爸喜欢晚上喝热牛奶', kind: 'preference' })
const search = tools.find((tool) => tool.name === 'companion_memory_search')
const searchText = await search.execute({ query: '牛奶', limit: 3 })
assert.match(searchText, /热牛奶/)

const capability = tools.find((tool) => tool.name === 'companion_capability_search')
const capabilityText = await capability.execute({ query: '浇水' })
assert.match(capabilityText, /water_crops/)

console.log('verify ok:', {
  sections: sections.length,
  tools: tools.length,
  events: events.length,
  contextChars: text.length,
})
