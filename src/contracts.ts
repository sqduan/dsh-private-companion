/**
 * dsh-private-companion 核心契约
 *
 * 这些类型是需求的可执行版本：
 * - 人格、记忆、关系、生活状态
 * - 能力目录（插件 / MCP / 内置工具）
 *
 * 不包含主动消息、渠道协议、回复闸门——这些交给现成 DSH 插件。
 */

export type CompanionId = string;
export type UserId = string;
export type IsoDateTime = string;

/* ------------------------------------------------------------------ */
/* 人格                                                                */
/* ------------------------------------------------------------------ */

export interface PersonaProfile {
  id: CompanionId;
  name: string;
  /** 稳定人格正文：身份、性格、价值观、底线 */
  systemPrompt: string;
  /** 说话风格、口癖、称呼等 */
  speechStyle?: string;
  /** 与用户的关系定位，例如“女儿”“朋友”“伴侣” */
  relationshipRole?: string;
  /** 不能做的事 / 安全边界 */
  boundaries: string[];
  /** 版本号，便于回滚 */
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type Mood =
  | "happy"
  | "calm"
  | "tired"
  | "sad"
  | "excited"
  | "shy"
  | "annoyed"
  | "neutral";

export interface DynamicState {
  companionId: CompanionId;
  mood: Mood;
  /** 0-100 */
  energy: number;
  /** 0-100 */
  hunger: number;
  /** 当前在做什么，例如“在农场浇水” */
  activity?: string;
  /** 虚拟地点 */
  location?: string;
  /** awake / sleepy / napping / asleep */
  sleepStage: "awake" | "sleepy" | "napping" | "asleep";
  /** 今日日程 */
  schedule: LifeEvent[];
  updatedAt: IsoDateTime;
}

export interface LifeEvent {
  id: string;
  title: string;
  startAt: IsoDateTime;
  endAt?: IsoDateTime;
  status: "planned" | "active" | "done" | "cancelled";
  note?: string;
}

/* ------------------------------------------------------------------ */
/* 记忆                                                                */
/* ------------------------------------------------------------------ */

export type MemoryKind =
  | "fact"
  | "experience"
  | "promise"
  | "preference"
  | "anniversary";

export type MemoryVisibility = "private" | "shared" | "group";

export interface MemoryRecord {
  id: string;
  companionId: CompanionId;
  userId?: UserId;
  kind: MemoryKind;
  /** 规范化后的记忆正文 */
  text: string;
  /** 0-1，越大越重要 */
  importance: number;
  /** 0-1，抽取置信度 */
  confidence: number;
  visibility: MemoryVisibility;
  /** 来源：哪条消息 / 哪次反思 */
  source?: string;
  /** 语义向量，可选 */
  embedding?: number[];
  tags: string[];
  /** 纪念日等结构化日期 */
  happenedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastRecalledAt?: IsoDateTime;
  recallCount: number;
}

export interface MemoryCandidate {
  kind: MemoryKind;
  text: string;
  importance: number;
  confidence: number;
  visibility: MemoryVisibility;
  happenedAt?: IsoDateTime;
  tags?: string[];
}

/* ------------------------------------------------------------------ */
/* 关系                                                                */
/* ------------------------------------------------------------------ */

export type RelationshipStage =
  | "stranger"
  | "acquaintance"
  | "familiar"
  | "close"
  | "important";

export interface RelationshipState {
  companionId: CompanionId;
  userId: UserId;
  displayName?: string;
  /** 角色对他的称呼 */
  addressAs?: string;
  stage: RelationshipStage;
  /** 0-100，内部使用，不直接展示 */
  intimacy: number;
  /** 0-100 */
  trust: number;
  /** 0-100 */
  familiarity: number;
  firstMetAt: IsoDateTime;
  lastInteractionAt: IsoDateTime;
  /** 重要日期：生日、纪念日、约定 */
  milestones: Milestone[];
  /** 禁忌 / 边界 */
  boundaries: string[];
  notes?: string;
}

export interface Milestone {
  id: string;
  title: string;
  date: IsoDateTime;
  recurring: boolean;
  sourceMemoryId?: string;
}

/* ------------------------------------------------------------------ */
/* 能力目录                                                            */
/* ------------------------------------------------------------------ */

export type CapabilitySource =
  | "builtin"
  | "plugin"
  | "mcp"
  | "skill"
  | "service";

export type CapabilityRisk = "read" | "write" | "external" | "destructive";

export interface CapabilityDescriptor {
  /** 全局唯一，例如 "stardew.get_state" / "mcp:memory.search" */
  id: string;
  source: CapabilitySource;
  /** 插件 id 或 MCP server 名 */
  owner?: string;
  /** 原始工具名 */
  toolName?: string;
  name: string;
  summary: string;
  inputSchema?: Record<string, unknown>;
  risk: CapabilityRisk;
  requiresApproval: boolean;
  tags: string[];
  available: boolean;
  /** 成本提示，不是精确计费 */
  costHint?: "low" | "medium" | "high";
}

export interface CapabilityPack {
  id: string;
  name: string;
  description: string;
  /** 包内能力 id；为空表示动态匹配 */
  capabilities: string[];
  /** 给模型的简短使用说明 */
  promptHint?: string;
  defaultEnabled: boolean;
}

export interface CapabilityPolicy {
  /** 允许自动调用的最高风险 */
  autoAllowMaxRisk: CapabilityRisk;
  /** 明确禁止的能力 id */
  denied: string[];
  /** 需要审批的能力 id */
  requireApproval: string[];
  /** 每个会话启用的能力包 */
  enabledPacks: string[];
}

export interface CapabilityInvocation {
  capabilityId: string;
  args: Record<string, unknown>;
  /** 哪个用户 / 会话发起的 */
  userId?: UserId;
  sessionId?: string;
  /** 调用理由，便于审计 */
  reason?: string;
}

export interface CapabilityResult {
  ok: boolean;
  /** 文本结果，直接回给模型 */
  text?: string;
  /** 结构化结果 */
  data?: unknown;
  error?: string;
  /** 是否被策略拦截 */
  denied?: boolean;
}

/* ------------------------------------------------------------------ */
/* 提示词组装                                                          */
/* ------------------------------------------------------------------ */

export interface PromptBundle {
  /** 稳定前缀，应尽量不变以保护 prompt cache */
  stable: string;
  /** 动态后缀：时间、状态、记忆、关系、能力提示 */
  dynamic: string;
  /** 估算 token，便于预算控制 */
  estimatedTokens?: number;
}

/* ------------------------------------------------------------------ */
/* 存储                                                                */
/* ------------------------------------------------------------------ */

export interface CompanionStore {
  getPersona(id: CompanionId): Promise<PersonaProfile | undefined>;
  savePersona(persona: PersonaProfile): Promise<void>;

  getDynamicState(id: CompanionId): Promise<DynamicState | undefined>;
  saveDynamicState(state: DynamicState): Promise<void>;

  addMemories(memories: MemoryRecord[]): Promise<void>;
  searchMemories(query: {
    companionId: CompanionId;
    userId?: UserId;
    text: string;
    limit: number;
  }): Promise<MemoryRecord[]>;

  getRelationship(
    companionId: CompanionId,
    userId: UserId,
  ): Promise<RelationshipState | undefined>;
  saveRelationship(state: RelationshipState): Promise<void>;

  getLifeState(
    companionId: CompanionId,
    date: string,
  ): Promise<DynamicState | undefined>;
  saveLifeState(state: DynamicState): Promise<void>;
}
