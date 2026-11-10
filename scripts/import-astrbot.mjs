#!/usr/bin/env node
// 从 AstrBot 陪伴插件的 memory-search.sqlite3 导入回忆。
//
// 默认只导用户原话（native_human），跳过寒暄和过短内容；助手回复默认不导，
// 因为那更像聊天记录，不是长期记忆。需要全量时加 --include-replies。

import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { CompanionStore } from '../lib/store.js'

const args = parseArgs(process.argv.slice(2))
const source = args.source
  || '/home/cheems/Deepseek/astrbot/data/plugin_data/astrbot_plugin_private_companion/installations/main/runtime/memory-search.sqlite3'

if (!existsSync(source)) {
  console.error('找不到 AstrBot 记忆库：', source)
  process.exit(1)
}

const store = new CompanionStore({}).init()
const db = new DatabaseSync(source)
const rows = db.prepare('SELECT producer, document_json, metadata_json FROM recall_documents').all()
const generic = /^(你好|在吗|晚安|早安|哈哈|嗯|哦|好的|谢谢|收到|可以|好呀|知道啦)[。！!～~]*$/u

let imported = 0
let skipped = 0
const seen = new Set()

for (const row of rows) {
  if (!args.includeReplies && row.producer !== 'native_human') {
    skipped++
    continue
  }
  let doc
  let meta
  try {
    doc = JSON.parse(row.document_json)
    meta = row.metadata_json ? JSON.parse(row.metadata_json) : {}
  } catch {
    skipped++
    continue
  }
  const text = String(doc?.text || '').replace(/\s+/g, ' ').trim()
  if (text.length < (args.minLength || 8) || text.length > 300) {
    skipped++
    continue
  }
  if (generic.test(text) || !isUseful(text)) {
    skipped++
    continue
  }
  if (seen.has(text)) {
    skipped++
    continue
  }
  seen.add(text)

  store.addMemory({
    text,
    kind: kindOf(text),
    importance: text.length >= 30 ? 0.65 : 0.55,
    confidence: 0.65,
    visibility: 'private',
    userId: 'owner',
    source: 'astrbot:memory-search',
    happenedAt: meta?.message_time || meta?.observed_at || undefined,
  })
  imported++
  if (args.limit && imported >= args.limit) break
}

db.close()
store.close()
console.log(`导入完成：${imported} 条，跳过 ${skipped} 条`)
console.log(`目标库：${store.dbPath}`)

function isUseful(text) {
  if (text.length < 12) return false
  if (/^(你|请|帮我|给我|去|看看|试|打开|安装|操作|好[，,])/u.test(text)) return false
  if (/(请你|帮我|你给我|你看看|你试|你去|打开|安装|操作|玩吧|玩一|看看吧|可以啊)/u.test(text)) return false
  if (!/(我|爸爸|妈妈|我们|家)/u.test(text)) return false
  if (/(星露谷|MCP|插件|模组|操作角色|截图|鼠标)/u.test(text) && !/(喜欢|讨厌|记住|约定|害怕|开心|难过|生日)/u.test(text)) return false
  return true
}

function kindOf(text) {
  if (/(生日|纪念日)/u.test(text)) return 'anniversary'
  if (/(约定|约好|说好)/u.test(text)) return 'promise'
  if (/(喜欢|讨厌|害怕|不爱吃|爱吃)/u.test(text)) return 'preference'
  if (/(第一次|最难忘|最开心)/u.test(text)) return 'experience'
  return 'fact'
}

function parseArgs(argv) {
  const out = { source: '', minLength: 8, limit: 0, includeReplies: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--source') out.source = argv[++i]
    else if (arg === '--min-length') out.minLength = Number(argv[++i]) || 8
    else if (arg === '--limit') out.limit = Number(argv[++i]) || 0
    else if (arg === '--include-replies') out.includeReplies = true
  }
  return out
}
