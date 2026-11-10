// 能力集合：把 DSH 已经注册的工具（插件 / MCP / 内置）编成目录。
//
// 原则：
// - 不复制工具实现，只索引、分组、说明、风险分级。
// - DSH 原生工具继续由模型直接调用；这里只提供发现和按需展开。
// - 没有原生工具形态的能力，后续再通过 provider.invoke 接。

const RISK_ORDER = { read: 0, write: 1, external: 2, destructive: 3 }

const DEFAULT_PACKS = [
  {
    id: 'core',
    name: '陪伴核心',
    description: '记忆、关系、当前状态',
    capabilities: [
      'companion_status',
      'companion_memory_search',
      'companion_memory_write',
      'companion_life_state',
    ],
    promptHint: '涉及回忆、关系、当前状态时优先用这些工具。',
    defaultEnabled: true,
  },
  {
    id: 'stardew',
    name: '星露谷',
    description: '星露谷游戏操作（通过已装的 MCP / 插件）',
    capabilities: [],
    match: ['stardew', 'blind_whale', 'get_state', 'travel_to', 'water_crops'],
    promptHint: '玩星露谷先看状态，再行动；不要凭空编造坐标。',
    defaultEnabled: false,
  },
  {
    id: 'web',
    name: '联网与搜索',
    description: '网页搜索、抓取、资讯',
    capabilities: [],
    match: ['search', 'fetch', 'browser', 'http'],
    promptHint: '需要最新信息时使用，引用来源。',
    defaultEnabled: true,
  },
  {
    id: 'qq',
    name: 'QQ 通道',
    description: '通过 DSH QQ 插件收发消息',
    capabilities: [],
    match: ['qq', 'onebot', 'napcat'],
    promptHint: '发消息、查历史时使用；不要直接操作协议。',
    defaultEnabled: false,
  },
  {
    id: 'wechat',
    name: '微信通道',
    description: '通过 DSH 微信插件收发消息',
    capabilities: [],
    match: ['wechat', 'weixin', 'ilink'],
    promptHint: '微信发送、登录状态查询时使用。',
    defaultEnabled: false,
  },
]

export function createCapabilityHub(ctx, config = {}) {
  const packs = normalizePacks(config.capabilityPacks)
  const policy = {
    autoAllowMaxRisk: config.autoAllowMaxRisk || 'read',
    enabledPacks: packs.filter((pack) => pack.defaultEnabled).map((pack) => pack.id),
  }
  const cache = new Map()
  const cacheMs = 5000

  function toolsService() {
    try {
      const tools = ctx.get?.('tools')
      return tools?.definitions ? tools : undefined
    } catch {
      return undefined
    }
  }

  function list(scope) {
    const key = scope || 'global'
    const now = Date.now()
    const cached = cache.get(key)
    if (cached && now - cached.at < cacheMs) return cached.items
    const tools = toolsService()
    if (!tools) return []
    let definitions = []
    try {
      definitions = tools.definitions(scope)
    } catch {
      try { definitions = tools.definitions() } catch { return [] }
    }
    const items = []
    for (const tool of definitions) {
      const name = String(tool?.name || '')
      if (!name) continue
      if (name.startsWith('companion_')) continue // 自己的管理工具不重复登记
      const source = name.startsWith('mcp__') ? 'mcp' : 'plugin'
      const owner = source === 'mcp' ? mcpOwner(name) : 'dsh'
      items.push({
        id: name,
        source,
        owner,
        toolName: name,
        name,
        summary: String(tool.description || '').replace(/\s+/g, ' ').slice(0, 180),
        inputSchema: tool.parameters,
        risk: inferRisk(name),
        requiresApproval: inferRisk(name) !== 'read',
        tags: inferTags(name),
        available: true,
        costHint: 'low',
      })
    }
    cache.set(key, { at: now, items })
    return items
  }

  function get(id, scope) {
    return list(scope).find((item) => item.id === id)
  }

  function search(query, options = {}) {
    const terms = tokenize(query)
    let items = list(options.scope)
    if (options.maxRisk) {
      items = items.filter((item) => RISK_ORDER[item.risk] <= RISK_ORDER[options.maxRisk])
    }
    const scored = items.map((item) => {
      const haystack = `${item.id} ${item.name} ${item.summary} ${item.tags.join(' ')}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (haystack.includes(term)) score += term.length >= 3 ? 3 : 1
      }
      if (item.risk === 'read') score += 0.3
      return { item, score }
    })
    return scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(Number(options.limit) || 8, 20)))
      .map(({ item }) => item)
  }

  function buildCatalogSummary(maxChars = 1800, scope) {
    const items = enabledItems(scope).filter((item) => item.risk !== 'destructive').slice(0, 50)
    if (!items.length) return ''
    const lines = ['可用能力（[read] 只读，[write] 写入，[external] 外部发送；完整参数用 companion_capability_describe）：']
    for (const item of items) {
      const line = `- ${item.id} [${item.risk}]：${item.summary}`
      if (lines.join('\n').length + line.length > maxChars) break
      lines.push(line)
    }
    return lines.join('\n')
  }

  function packIdsFor(capabilityId, scope) {
    const item = get(capabilityId, scope)
    if (!item) return []
    const matched = []
    for (const pack of packs) {
      if (pack.capabilities.includes(capabilityId)) {
        matched.push(pack.id)
        continue
      }
      if (pack.match?.some((word) => capabilityId.toLowerCase().includes(word))) {
        matched.push(pack.id)
      }
    }
    return matched
  }

  function enabledItems(scope) {
    const enabled = new Set(policy.enabledPacks)
    return list(scope).filter((item) => {
      const packsForItem = packIdsFor(item.id, scope)
      return packsForItem.length === 0 || packsForItem.some((id) => enabled.has(id))
    })
  }

  function describe(id, scope) {
    const item = get(id, scope)
    if (!item) return undefined
    return {
      ...item,
      packs: packIdsFor(id, scope),
      schema: item.inputSchema,
    }
  }

  function checkPolicy(item) {
    if (!item.available) return '能力当前不可用'
    if (RISK_ORDER[item.risk] > RISK_ORDER[policy.autoAllowMaxRisk]) {
      return `风险等级 ${item.risk} 超过自动放行上限；请让用户确认，或直接调用原生工具`
    }
    return null
  }

  return {
    list,
    get,
    search,
    describe,
    buildCatalogSummary,
    packIdsFor,
    enabledItems,
    checkPolicy,
    getPolicy: () => ({ ...policy, enabledPacks: [...policy.enabledPacks] }),
    setPolicy: (patch = {}) => Object.assign(policy, patch),
    listPacks: () => packs.map((pack) => ({ ...pack })),
  }
}

function normalizePacks(input) {
  const source = Array.isArray(input) && input.length ? input : DEFAULT_PACKS
  return source.map((pack) => ({
    id: String(pack.id),
    name: String(pack.name || pack.id),
    description: String(pack.description || ''),
    capabilities: Array.isArray(pack.capabilities) ? pack.capabilities.map(String) : [],
    match: Array.isArray(pack.match) ? pack.match.map(String) : [],
    promptHint: String(pack.promptHint || ''),
    defaultEnabled: Boolean(pack.defaultEnabled),
  }))
}

function inferRisk(name) {
  const lower = name.toLowerCase()
  if (/delete|remove|destroy|drop|truncate|kill|uninstall|plugin_manager|install|enable|disable/.test(lower)) return 'destructive'
  if (/send|post|publish|email|message|reply|upload/.test(lower)) return 'external'
  if (/write|edit|create|update|save|patch|move|copy|mkdir|install|execute|shell|bash|run|water|plant|till|harvest|fish|fight|mine|buy|sell|craft|sleep/.test(lower)) return 'write'
  return 'read'
}

function inferTags(name) {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6)
}

function mcpOwner(name) {
  const parts = name.split('__')
  return parts[1] || 'mcp'
}

function tokenize(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[\s,，。.!！?？/\\|_\-、；;：:（）()【】\[\]"'“”]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}
