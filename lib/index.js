// dsh-private-companion：陪伴内核
//
// 只做 DSH 没有的部分：人格上下文、记忆、关系、生活状态、能力目录。
// 主动消息、回复闸门、QQ/微信协议交给现成 DSH 插件。

import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { CompanionStore } from './store.js'
import { buildDynamicContext, refreshState } from './prompt.js'
import { createCapabilityHub } from './capabilities.js'
import { createTools } from './tools.js'

export const name = 'dsh-private-companion'
export const inject = ['systemPrompt']

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PERSONA_FILE = join(HERE, '..', 'assets', 'persona.md')

/** 从宿主 profile / DSH 安装目录找 @deepseek-ai 包；找不到就返回 null。 */
async function loadHostModule(moduleName) {
  try {
    return await import(moduleName)
  } catch {}
  const bases = []
  const home = process.env.DSH_HOME
  if (home && existsSync(join(home, 'profiles'))) {
    for (const profile of readdirSync(join(home, 'profiles'))) {
      bases.push(join(home, 'profiles', profile))
    }
  }
  for (const start of [process.argv[1], process.execPath, process.cwd()]) {
    let dir = start ? dirname(start) : null
    for (let i = 0; dir && i < 8; i++, dir = dirname(dir)) bases.push(dir)
  }
  for (const base of bases) {
    try {
      const resolved = createRequire(join(base, 'noop.js')).resolve(moduleName)
      return await import(pathToFileURL(resolved).href)
    } catch {}
  }
  return null
}

const dshToolsModule = await loadHostModule('@deepseek-ai/dsh-tools')
const defineTool = dshToolsModule?.defineTool ?? ((definition) => definition)

const DEFAULTS = {
  enabled: true,
  companionId: 'xiaofeiyu',
  companionName: '小肥鱼',
  ownerId: 'owner',
  personaFile: '',
  timeZone: 'Asia/Shanghai',
  memoryLimit: 5,
  injectCapabilities: true,
}

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-private-companion',
    validate(value) {
      const config = { ...DEFAULTS }
      if (value === undefined || value === null) return { value: config }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'config must be an object', path: [] }] }
      }
      for (const key of ['enabled', 'injectCapabilities']) {
        if (value[key] !== undefined) {
          if (typeof value[key] !== 'boolean') {
            return { issues: [{ message: `${key} must be boolean`, path: [key] }] }
          }
          config[key] = value[key]
        }
      }
      for (const key of ['companionId', 'companionName', 'ownerId', 'personaFile', 'timeZone']) {
        if (value[key] !== undefined) {
          if (typeof value[key] !== 'string') {
            return { issues: [{ message: `${key} must be string`, path: [key] }] }
          }
          config[key] = value[key]
        }
      }
      if (value.memoryLimit !== undefined) {
        if (typeof value.memoryLimit !== 'number' || !Number.isFinite(value.memoryLimit)) {
          return { issues: [{ message: 'memoryLimit must be number', path: ['memoryLimit'] }] }
        }
        config.memoryLimit = value.memoryLimit
      }
      return { value: config }
    },
  },
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  if (!config.enabled) {
    log(ctx, 'info', '陪伴内核已停用（enabled: false）')
    return
  }

  let store
  try {
    const personaFile = config.personaFile
      || (existsSync(DEFAULT_PERSONA_FILE) ? DEFAULT_PERSONA_FILE : '')
    store = new CompanionStore({
      companionId: config.companionId,
      ownerId: config.ownerId,
      personaFile,
    }).init()
  } catch (error) {
    log(ctx, 'error', `SQLite 初始化失败：${error?.message ?? error}`)
    return
  }

  const hub = createCapabilityHub(ctx, config)
  const lastUserText = new Map()

  // 会话恢复/切换时，用 session.id 区分短期上下文；长期关系仍归 ownerId。
  const sessionIdOf = (context) => {
    try {
      return context?.agent?.session?.header?.id || context?.agent?.session?.id || context?.session?.header?.id || context?.session?.id || 'default'
    } catch {
      return 'default'
    }
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'private-companion:context',
    order: 900,
    interpolate: false,
    text: (context) => {
      try {
        let state = store.getState()
        if (!state) return ''
        state = refreshState(state)
        store.saveState(state)

        let capabilitySummary = ''
        if (config.injectCapabilities) {
          try {
            capabilitySummary = hub.buildCatalogSummary(1800, context.scope || context.agent)
          } catch {}
        }

        return buildDynamicContext({
          store,
          config,
          state,
          userId: config.ownerId,
          lastUserText: lastUserText.get(sessionIdOf(context)) || '',
          capabilitySummary,
        })
      } catch (error) {
        log(ctx, 'warn', `构建上下文失败：${error?.message ?? error}`)
        return ''
      }
    },
  }))

  // 记录用户原话，用于记忆召回；同时轻微推进关系。
  ctx.effect(() => {
    if (typeof ctx.on !== 'function') return () => {}
    const off = ctx.on('session/event', (session, event) => {
      try {
        if (event?.type !== 'user/message') return
        const message = event.data
        if (message?.source?.kind !== 'user') return
        const text = extractText(message.content)
        if (!text) return
        const id = session?.id || 'default'
        lastUserText.set(id, text.slice(0, 2000))
        store.touchRelationship(config.ownerId, text)
        const inferred = inferMemory(text)
        if (inferred) {
          store.addMemory({
            text: inferred.text,
            kind: inferred.kind,
            importance: inferred.importance,
            confidence: 0.7,
            visibility: 'private',
            userId: config.ownerId,
            source: 'auto:user-message',
          })
        }
      } catch (error) {
        log(ctx, 'warn', `处理消息失败：${error?.message ?? error}`)
      }
    })
    return () => off?.()
  })

  // 注册陪伴工具。
  ctx.effect(() => {
    const toolsService = (() => {
      try { return ctx.get?.('tools') } catch { return undefined }
    })()
    if (!toolsService?.register) {
      log(ctx, 'warn', '当前 DSH 没有 tools 服务，陪伴工具未注册')
      return () => {}
    }
    const offs = []
    for (const definition of createTools({ store, hub, config, userId: config.ownerId })) {
      try {
        offs.push(toolsService.register(defineTool(definition)))
      } catch (error) {
        log(ctx, 'warn', `注册工具 ${definition.name} 失败：${error?.message ?? error}`)
      }
    }
    return () => {
      for (const off of offs) {
        try { typeof off === 'function' ? off() : off?.dispose?.() } catch {}
      }
    }
  })

  ctx.effect(() => () => store.close())
  log(ctx, 'info', `陪伴内核已加载：${config.companionName}（${store.dbPath}）`)
}

function resolveConfig(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const config = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    if (raw[key] !== undefined) config[key] = raw[key]
  }
  return config
}

function extractText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
    .trim()
}

/**
 * 轻量自动记忆：只抓明确值得记的句子，避免每句话都入库。
 * 更复杂的抽取留给后续的反思任务。
 */
function inferMemory(text) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length < 4 || clean.length > 240) return undefined
  if (/^(你好|在吗|晚安|早安|哈哈|嗯|哦|好的|谢谢)[。！!～~]*$/.test(clean)) return undefined

  let match = clean.match(/(?:记住|记一下|别忘了|要记得)[：:，,\s]*(.+)/)
  if (match) return { text: match[1].trim(), kind: 'fact', importance: 0.8 }

  match = clean.match(/我叫[：:\s]*([^\s，。,.!！?？]{1,20})/)
  if (match) return { text: `用户的名字是${match[1]}`, kind: 'fact', importance: 0.9 }

  match = clean.match(/我的生日是[：:\s]*([0-9]{1,2}月[0-9]{1,2}日|[0-9]{4}-[0-9]{2}-[0-9]{2})/)
  if (match) return { text: `用户的生日是${match[1]}`, kind: 'anniversary', importance: 1 }

  match = clean.match(/我(?:很)?(?:喜欢|不喜欢|讨厌|害怕)[：:\s]*(.{1,60})/)
  if (match) return { text: clean, kind: 'preference', importance: 0.7 }

  match = clean.match(/(?:我们|咱俩)(?:约好|约定|说好)[：:\s]*(.{1,80})/)
  if (match) return { text: clean, kind: 'promise', importance: 0.9 }

  if (/第一次|头一次|最难忘|最开心/.test(clean) && clean.length <= 120) {
    return { text: clean, kind: 'experience', importance: 0.8 }
  }

  return undefined
}

function log(ctx, level, message) {
  try {
    const logger = typeof ctx.logger === 'function'
      ? ctx.logger('dsh-private-companion')
      : ctx.logger
    const fn = logger?.[level] || logger?.info
    if (typeof fn === 'function') fn.call(logger, message)
  } catch {}
}
