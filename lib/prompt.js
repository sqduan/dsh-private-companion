// 动态上下文：时间、角色状态、关系、相关记忆、能力摘要。
//
// 只注入“背景”，不重复人格正文；稳定人格仍由 dsh-persona-dafeiyu 或插件配置负责。

const STAGE_TEXT = {
  stranger: '刚认识',
  acquaintance: '认识',
  familiar: '熟悉',
  close: '亲近',
  important: '很重要的人',
}

export function refreshState(state, now = new Date()) {
  const hour = now.getHours()
  let sleepStage = 'awake'
  let energy = 65
  let mood = 'calm'
  let activity = state.activity || ''

  if (hour >= 23 || hour < 7) {
    sleepStage = 'asleep'
    energy = 18
    mood = 'tired'
    activity = '在睡觉'
  } else if (hour < 9) {
    sleepStage = 'awake'
    energy = 55
    mood = 'calm'
    activity = '刚起床，还有点困'
  } else if (hour < 12) {
    energy = 78
    mood = 'happy'
    activity = '上午在忙自己的事'
  } else if (hour < 14) {
    energy = 62
    mood = 'calm'
    activity = '吃午饭、休息'
  } else if (hour < 18) {
    energy = 70
    mood = 'happy'
    activity = '下午在院子里或镇上'
  } else if (hour < 22) {
    energy = 48
    mood = 'calm'
    activity = '傍晚了，慢慢安静下来'
  } else {
    energy = 32
    mood = 'tired'
    activity = '准备洗漱睡觉'
  }

  if (state.sleepStage === 'napping' && hour >= 13 && hour < 15) {
    sleepStage = 'napping'
    energy = 45
    mood = 'tired'
    activity = '在午休'
  }

  return { ...state, sleepStage, energy, mood, activity, updatedAt: now.toISOString() }
}

export function buildDynamicContext({
  store,
  config,
  state,
  userId,
  lastUserText,
  capabilitySummary,
}) {
  const now = new Date()
  const persona = store.getPersona()
  const rel = store.getRelationship(userId) || store.touchRelationship(userId, '')
  const memories = store.searchMemories({
    query: lastUserText || '',
    userId,
    limit: config.memoryLimit || 5,
  })
  if (memories.length) store.markRecalled(memories.map((item) => item.id))

  const timeText = formatTime(now, config.timeZone || 'Asia/Shanghai')
  const relationText = [
    `关系：${STAGE_TEXT[rel.stage] || rel.stage}`,
    rel.addressAs ? `你称呼对方为「${rel.addressAs}」` : '',
    `认识于 ${formatDate(rel.firstMetAt, config.timeZone)}`,
  ].filter(Boolean).join('；')

  const statusText = [
    `心情：${state.mood}`,
    `精力：${Math.round(state.energy)}/100`,
    `睡眠：${state.sleepStage}`,
    state.activity ? `现在：${state.activity}` : '',
  ].filter(Boolean).join('；')

  const lines = [
    '## 当前陪伴状态',
    '',
    '这些只是你此刻的背景，不要逐条复述，也不要机械地报告数值。',
    '',
    `时间：${timeText}`,
    `角色：${persona?.name || config.companionName || '小肥鱼'}`,
    statusText,
    relationText,
  ]

  if (memories.length) {
    lines.push('', '你记得这些（只在自然相关时提起）：')
    for (const memory of memories) {
      lines.push(`- ${memory.text}`)
    }
  }

  if (capabilitySummary) {
    lines.push('', '## 可用能力', capabilitySummary)
  }

  return lines.join('\n')
}

export function formatTime(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

export function formatDate(value, timeZone) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value))
  } catch {
    return String(value).slice(0, 10)
  }
}
