// 陪伴核心工具：状态、记忆、关系、能力目录。
//
// 注意：这些是“管理/查询”工具；真正的聊天、渠道发送、主动调度交给 DSH 现有插件。

const OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

export function createTools({ store, hub, config, userId }) {
  const ownerId = config.ownerId || userId || 'owner'

  return [
    {
      name: 'companion_status',
      description: '查看小肥鱼当前的状态、和你的关系、记忆数量。想了解她现在的状态时使用。',
      parameters: {},
      output: OUTPUT,
      async execute() {
        const state = store.getState()
        const rel = store.getRelationship(ownerId)
        const count = store.countMemories(ownerId)
        return [
          `角色：${store.getPersona()?.name || config.companionName || '小肥鱼'}`,
          `心情：${state?.mood || 'unknown'}`,
          `精力：${Math.round(state?.energy ?? 0)}/100`,
          `睡眠：${state?.sleepStage || 'unknown'}`,
          `现在：${state?.activity || '（未记录）'}`,
          `关系：${rel?.stage || 'unknown'}（称呼：${rel?.addressAs || '未设置'}）`,
          `记忆：${count} 条`,
        ].join('\n')
      },
    },

    {
      name: 'companion_memory_write',
      description: '把一件值得记住的事写进小肥鱼的长期记忆。适合用户明确说“记住”、重要约定、偏好、纪念日。不要每句话都写。',
      parameters: {
        text: { type: 'string', required: true, description: '要记住的内容，用完整的一句话' },
        kind: { type: 'string', description: 'fact / experience / promise / preference / anniversary，默认 fact' },
        importance: { type: 'number', description: '0-1，默认 0.6' },
        visibility: { type: 'string', description: 'private / shared / group，默认 private' },
        happened_at: { type: 'string', description: '事件发生时间，ISO 字符串，可选' },
      },
      output: OUTPUT,
      async execute(args) {
        const memory = store.addMemory({
          text: args?.text,
          kind: args?.kind || 'fact',
          importance: args?.importance ?? 0.6,
          confidence: 0.85,
          visibility: args?.visibility || 'private',
          happenedAt: args?.happened_at,
          userId: ownerId,
          source: 'companion_memory_write',
        })
        return `已记住：${memory.text}`
      },
    },

    {
      name: 'companion_memory_search',
      description: '在小肥鱼的长期记忆里搜索。想回忆某件事、某人的偏好、过去的约定时使用。',
      parameters: {
        query: { type: 'string', description: '搜索关键词；留空则返回最近/最重要的记忆' },
        limit: { type: 'number', description: '最多返回几条，默认 5' },
      },
      output: OUTPUT,
      async execute(args) {
        const items = store.searchMemories({
          query: args?.query || '',
          userId: ownerId,
          limit: args?.limit ?? 5,
        })
        if (!items.length) return '没有找到相关记忆。'
        return items.map((item, index) => `${index + 1}. [${item.kind}] ${item.text}`).join('\n')
      },
    },

    {
      name: 'companion_relationship_get',
      description: '查看小肥鱼和某人的关系卡：阶段、称呼、重要日期。默认查看和爸爸的关系。',
      parameters: {
        user_id: { type: 'string', description: '用户 id，默认 owner' },
      },
      output: OUTPUT,
      async execute(args) {
        const rel = store.getRelationship(args?.user_id || ownerId)
        if (!rel) return '还没有这个人的关系卡。'
        return [
          `用户：${rel.displayName || rel.userId}`,
          `称呼：${rel.addressAs || '未设置'}`,
          `关系：${rel.stage}`,
          `认识于：${rel.firstMetAt}`,
          `最近互动：${rel.lastInteractionAt}`,
          `重要日期：${rel.milestones.map((m) => `${m.title} ${m.date}`).join('；') || '无'}`,
          `边界：${rel.boundaries.join('；') || '无'}`,
        ].join('\n')
      },
    },

    {
      name: 'companion_life_state',
      description: '查看小肥鱼今天的日程和当前生活状态。想知道她今天在做什么时使用。',
      parameters: {},
      output: OUTPUT,
      async execute() {
        const state = store.getState()
        if (!state) return '还没有生活状态。'
        const schedule = (state.schedule || [])
          .map((item) => `- ${item.title}（${item.status}）`)
          .join('\n')
        return [
          `心情：${state.mood}`,
          `精力：${Math.round(state.energy)}/100`,
          `睡眠：${state.sleepStage}`,
          `现在：${state.activity || '（未记录）'}`,
          '今日日程：',
          schedule || '（空）',
        ].join('\n')
      },
    },

    {
      name: 'companion_capability_search',
      description: '在 DSH 已安装的插件、MCP、内置工具里搜索能力。工具太多、不知道用哪个时使用。',
      parameters: {
        query: { type: 'string', required: true, description: '想做什么，例如“星露谷浇水”“搜索网页”' },
        limit: { type: 'number', description: '最多返回几条，默认 8' },
      },
      output: OUTPUT,
      async execute(args, exec) {
        const items = hub.search(args?.query || '', { limit: args?.limit ?? 8, scope: exec?.agent?.scope || exec?.agent })
        if (!items.length) return '没有找到匹配的能力。'
        return items
          .map((item) => `- ${item.id} [${item.risk}] ${item.summary}`)
          .join('\n')
      },
    },

    {
      name: 'companion_capability_describe',
      description: '展开一个能力的完整参数说明。先用 companion_capability_search 找到 id，再查它。',
      parameters: {
        id: { type: 'string', required: true, description: '能力 id，例如 stardew 或 mcp__xxx__yyy' },
      },
      output: OUTPUT,
      async execute(args, exec) {
        const item = hub.describe(args?.id, exec?.agent?.scope || exec?.agent)
        if (!item) return `没有找到能力：${args?.id}`
        return JSON.stringify(item, null, 2)
      },
    },

    {
      name: 'companion_capability_packs',
      description: '查看能力包（core / stardew / web / qq / wechat）以及启用状态。',
      parameters: {},
      output: OUTPUT,
      async execute() {
        const policy = hub.getPolicy()
        return hub.listPacks()
          .map((pack) => {
            const enabled = policy.enabledPacks.includes(pack.id) ? '启用' : '未启用'
            return `- ${pack.id}（${enabled}）：${pack.description}`
          })
          .join('\n')
      },
    },

    {
      name: 'companion_capability_pack_set',
      description: '启用或停用一个能力包。比如玩星露谷前启用 stardew，需要 QQ 时启用 qq。',
      parameters: {
        pack_id: { type: 'string', required: true, description: '能力包 id：core / stardew / web / qq / wechat' },
        enabled: { type: 'boolean', description: 'true 启用，false 停用，默认 true' },
      },
      output: OUTPUT,
      async execute(args) {
        const packId = String(args?.pack_id || '').trim()
        if (!packId) return '缺少 pack_id。'
        if (args?.enabled === false) hub.disablePack(packId)
        else hub.enablePack(packId)
        return `能力包 ${packId} 已${args?.enabled === false ? '停用' : '启用'}。当前：${hub.getPolicy().enabledPacks.join(', ') || '无'}`
      },
    },
  ]
}
