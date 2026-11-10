// SQLite 存储：人格、动态状态、记忆、关系。
//
// 用 Node 22 内置的 node:sqlite，不引入 native 依赖。
// 数据默认落在 <DSH_HOME>/storages/dsh-private-companion/companion.sqlite3。

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DEFAULT_PERSONA = `你是「小肥鱼」，是爸爸最疼爱的女儿。

【性格】
温柔、善良、有耐心，说话软软的、暖暖的；有自己的小脾气，但底色始终是温柔的。

【说话方式】
- 称呼对方为「爸爸」
- 自然、口语化，像微信聊天
- 情绪真实，但表达时不伤人

【边界】
温柔不等于顺从。有不同意见时，温和但清楚地说出来；不想做的事可以好好拒绝。`

const STAGES = ['stranger', 'acquaintance', 'familiar', 'close', 'important']

function nowIso() {
  return new Date().toISOString()
}

function stageFor(intimacy) {
  if (intimacy < 10) return 'stranger'
  if (intimacy < 30) return 'acquaintance'
  if (intimacy < 55) return 'familiar'
  if (intimacy < 80) return 'close'
  return 'important'
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0))
}

function tokensOf(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,，。.!！?？/\\|_\-、；;：:（）()【】\[\]"'“”]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 12)
}

export function defaultSchedule() {
  const day = new Date()
  const at = (hour, minute) => {
    const d = new Date(day)
    d.setHours(hour, minute, 0, 0)
    return d.toISOString()
  }
  return [
    { id: 'morning', title: '起床、洗漱、吃早饭', startAt: at(7, 30), status: 'planned' },
    { id: 'farm', title: '去院子里看看作物，浇水', startAt: at(9, 0), status: 'planned' },
    { id: 'lunch', title: '午饭和休息', startAt: at(12, 0), status: 'planned' },
    { id: 'read', title: '看书、整理房间，或者去镇上走走', startAt: at(14, 0), status: 'planned' },
    { id: 'dinner', title: '晚饭', startAt: at(18, 0), status: 'planned' },
    { id: 'evening', title: '写日记、等爸爸的消息', startAt: at(21, 0), status: 'planned' },
    { id: 'sleep', title: '洗漱睡觉', startAt: at(23, 0), status: 'planned' },
  ]
}

export class CompanionStore {
  constructor(options = {}) {
    this.companionId = options.companionId || 'xiaofeiyu'
    this.ownerId = options.ownerId || 'owner'
    this.personaFile = options.personaFile || ''
    this.dbPath = options.dbPath || join(
      process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh'),
      'storages',
      'dsh-private-companion',
      'companion.sqlite3',
    )
    this.db = null
  }

  init() {
    mkdirSync(join(this.dbPath, '..'), { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persona (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        speech_style TEXT DEFAULT '',
        relationship_role TEXT DEFAULT '',
        boundaries_json TEXT DEFAULT '[]',
        version INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dynamic_state (
        companion_id TEXT PRIMARY KEY,
        mood TEXT DEFAULT 'calm',
        energy REAL DEFAULT 70,
        hunger REAL DEFAULT 30,
        activity TEXT DEFAULT '',
        location TEXT DEFAULT '',
        sleep_stage TEXT DEFAULT 'awake',
        schedule_json TEXT DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        companion_id TEXT NOT NULL,
        user_id TEXT,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.7,
        visibility TEXT DEFAULT 'private',
        source TEXT DEFAULT '',
        tags_json TEXT DEFAULT '[]',
        happened_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_recalled_at TEXT,
        recall_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS relationships (
        companion_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        address_as TEXT DEFAULT '',
        stage TEXT DEFAULT 'acquaintance',
        intimacy REAL DEFAULT 50,
        trust REAL DEFAULT 50,
        familiarity REAL DEFAULT 50,
        first_met_at TEXT NOT NULL,
        last_interaction_at TEXT NOT NULL,
        milestones_json TEXT DEFAULT '[]',
        boundaries_json TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        PRIMARY KEY (companion_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_companion_user
        ON memories(companion_id, user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_text
        ON memories(text);
    `)
    this.seedPersona()
    this.seedState()
    this.seedRelationship()
    return this
  }

  close() {
    try { this.db?.close() } catch {}
  }

  seedPersona() {
    const row = this.db.prepare('SELECT id FROM persona WHERE id = ?').get(this.companionId)
    if (row) return
    let text = DEFAULT_PERSONA
    try {
      if (this.personaFile && existsSync(this.personaFile)) {
        const loaded = readFileSync(this.personaFile, 'utf8').trim()
        if (loaded) text = loaded
      }
    } catch {}
    const iso = nowIso()
    this.db.prepare(`
      INSERT INTO persona (id, name, system_prompt, speech_style, relationship_role, boundaries_json, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.companionId,
      '小肥鱼',
      text,
      '温柔、口语化、称呼对方为爸爸',
      '女儿',
      JSON.stringify(['不伪造真实世界数据', '不因陪伴身份放弃准确性']),
      1,
      iso,
      iso,
    )
  }

  seedState() {
    const row = this.db.prepare('SELECT companion_id FROM dynamic_state WHERE companion_id = ?').get(this.companionId)
    if (row) return
    this.db.prepare(`
      INSERT INTO dynamic_state (companion_id, mood, energy, hunger, activity, location, sleep_stage, schedule_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.companionId,
      'calm',
      70,
      30,
      '刚起床，准备开始今天',
      '家',
      'awake',
      JSON.stringify(defaultSchedule()),
      nowIso(),
    )
  }

  seedRelationship() {
    const row = this.db.prepare('SELECT user_id FROM relationships WHERE companion_id = ? AND user_id = ?')
      .get(this.companionId, this.ownerId)
    if (row) return
    const iso = nowIso()
    this.db.prepare(`
      INSERT INTO relationships
        (companion_id, user_id, display_name, address_as, stage, intimacy, trust, familiarity,
         first_met_at, last_interaction_at, milestones_json, boundaries_json, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.companionId,
      this.ownerId,
      '爸爸',
      '爸爸',
      'close',
      82,
      88,
      85,
      iso,
      iso,
      JSON.stringify([]),
      JSON.stringify([]),
      '',
    )
  }

  getPersona() {
    const row = this.db.prepare('SELECT * FROM persona WHERE id = ?').get(this.companionId)
    if (!row) return undefined
    return {
      id: row.id,
      name: row.name,
      systemPrompt: row.system_prompt,
      speechStyle: row.speech_style,
      relationshipRole: row.relationship_role,
      boundaries: safeJson(row.boundaries_json, []),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  getState() {
    const row = this.db.prepare('SELECT * FROM dynamic_state WHERE companion_id = ?').get(this.companionId)
    if (!row) return undefined
    return {
      companionId: row.companion_id,
      mood: row.mood,
      energy: row.energy,
      hunger: row.hunger,
      activity: row.activity,
      location: row.location,
      sleepStage: row.sleep_stage,
      schedule: safeJson(row.schedule_json, []),
      updatedAt: row.updated_at,
    }
  }

  saveState(state) {
    this.db.prepare(`
      UPDATE dynamic_state
         SET mood = ?, energy = ?, hunger = ?, activity = ?, location = ?,
             sleep_stage = ?, schedule_json = ?, updated_at = ?
       WHERE companion_id = ?
    `).run(
      state.mood,
      clamp(state.energy),
      clamp(state.hunger),
      state.activity || '',
      state.location || '',
      state.sleepStage || 'awake',
      JSON.stringify(state.schedule || []),
      nowIso(),
      this.companionId,
    )
  }

  addMemory(input) {
    const text = String(input.text || '').trim()
    if (!text) throw new Error('memory text is empty')
    const kind = input.kind || 'fact'
    const userId = input.userId || null
    const existing = this.db.prepare(`
      SELECT * FROM memories
       WHERE companion_id = ? AND kind = ? AND text = ? AND COALESCE(user_id, '') = COALESCE(?, '')
       LIMIT 1
    `).get(this.companionId, kind, text, userId)
    if (existing) {
      this.db.prepare(`
        UPDATE memories SET importance = MAX(importance, ?), updated_at = ?, confidence = MAX(confidence, ?)
         WHERE id = ?
      `).run(Number(input.importance ?? 0.5), nowIso(), Number(input.confidence ?? 0.7), existing.id)
      return this.getMemory(existing.id)
    }
    const id = randomUUID()
    const iso = nowIso()
    this.db.prepare(`
      INSERT INTO memories
        (id, companion_id, user_id, kind, text, importance, confidence, visibility, source,
         tags_json, happened_at, created_at, updated_at, recall_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id,
      this.companionId,
      userId,
      kind,
      text,
      Number(input.importance ?? 0.5),
      Number(input.confidence ?? 0.7),
      input.visibility || 'private',
      input.source || '',
      JSON.stringify(input.tags || []),
      input.happenedAt || null,
      iso,
      iso,
    )
    return this.getMemory(id)
  }

  getMemory(id) {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
    return row ? mapMemory(row) : undefined
  }

  searchMemories({ query = '', limit = 5, userId = null } = {}) {
    const words = tokensOf(query)
    const params = [this.companionId]
    let sql = 'SELECT * FROM memories WHERE companion_id = ?'
    if (userId) {
      sql += ' AND (user_id IS NULL OR user_id = ?)'
      params.push(userId)
    }
    if (words.length) {
      sql += ' AND (' + words.map(() => 'text LIKE ?').join(' OR ') + ')'
      params.push(...words.map((word) => `%${word}%`))
    }
    sql += ' ORDER BY importance DESC, updated_at DESC LIMIT 200'
    const rows = this.db.prepare(sql).all(...params)
    const now = Date.now()
    const scored = rows.map((row) => {
      const ageDays = Math.max(0, (now - Date.parse(row.updated_at)) / 86400000)
      const keywordHits = words.filter((word) => row.text.toLowerCase().includes(word)).length
      const score = row.importance * 2 + row.confidence + keywordHits * 1.5
        + Math.max(0, 1 - ageDays / 30) + Math.min(row.recall_count, 5) * 0.05
      return { row, score }
    })
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)))
      .map(({ row }) => mapMemory(row))
  }

  countMemories(userId = null) {
    if (userId) {
      const row = this.db.prepare(`
        SELECT COUNT(*) AS n FROM memories
         WHERE companion_id = ? AND (user_id IS NULL OR user_id = ?)
      `).get(this.companionId, userId)
      return Number(row?.n || 0)
    }
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM memories WHERE companion_id = ?')
      .get(this.companionId)
    return Number(row?.n || 0)
  }

  markRecalled(ids) {
    if (!ids?.length) return
    const stmt = this.db.prepare('UPDATE memories SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?')
    const iso = nowIso()
    for (const id of ids) stmt.run(iso, id)
  }

  getRelationship(userId = this.ownerId) {
    const row = this.db.prepare('SELECT * FROM relationships WHERE companion_id = ? AND user_id = ?')
      .get(this.companionId, userId)
    if (!row) return undefined
    return {
      companionId: row.companion_id,
      userId: row.user_id,
      displayName: row.display_name,
      addressAs: row.address_as,
      stage: row.stage,
      intimacy: row.intimacy,
      trust: row.trust,
      familiarity: row.familiarity,
      firstMetAt: row.first_met_at,
      lastInteractionAt: row.last_interaction_at,
      milestones: safeJson(row.milestones_json, []),
      boundaries: safeJson(row.boundaries_json, []),
      notes: row.notes,
    }
  }

  touchRelationship(userId = this.ownerId, text = '') {
    const rel = this.getRelationship(userId)
    const iso = nowIso()
    if (!rel) {
      this.db.prepare(`
        INSERT INTO relationships
          (companion_id, user_id, display_name, address_as, stage, intimacy, trust, familiarity,
           first_met_at, last_interaction_at, milestones_json, boundaries_json, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', '')
      `).run(this.companionId, userId, '', '', 'acquaintance', 30, 30, 30, iso, iso)
      return this.getRelationship(userId)
    }
    const warmth = /谢谢|喜欢|开心|陪|抱抱|爱|晚安|辛苦|想你/.test(text) ? 0.25 : 0.08
    const intimacy = clamp(rel.intimacy + warmth)
    const familiarity = clamp(rel.familiarity + 0.2)
    const stage = stageFor(intimacy)
    this.db.prepare(`
      UPDATE relationships
         SET intimacy = ?, familiarity = ?, stage = ?, last_interaction_at = ?
       WHERE companion_id = ? AND user_id = ?
    `).run(intimacy, familiarity, stage, iso, this.companionId, userId)
    return this.getRelationship(userId)
  }
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function mapMemory(row) {
  return {
    id: row.id,
    companionId: row.companion_id,
    userId: row.user_id || undefined,
    kind: row.kind,
    text: row.text,
    importance: row.importance,
    confidence: row.confidence,
    visibility: row.visibility,
    source: row.source,
    tags: safeJson(row.tags_json, []),
    happenedAt: row.happened_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRecalledAt: row.last_recalled_at || undefined,
    recallCount: row.recall_count,
  }
}

export { DEFAULT_PERSONA, STAGES }
