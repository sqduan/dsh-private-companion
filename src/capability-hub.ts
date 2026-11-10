/**
 * 能力集合（Capability Hub）
 *
 * 设计原则：
 * 1. 不复制插件 / MCP 的实现，只登记和委托。
 * 2. DSH 已经暴露为工具的能力，模型可以直接调用；Hub 负责发现、分组、提示、策略。
 * 3. 没有原生工具形态的能力（插件服务、MCP resource、HTTP 服务）才通过 Hub 调用。
 * 4. 默认最小权限：只读自动放行，写 / 外部 / 破坏性操作走审批。
 */

import type {
  CapabilityDescriptor,
  CapabilityInvocation,
  CapabilityPack,
  CapabilityPolicy,
  CapabilityResult,
  CapabilityRisk,
  CapabilitySource,
} from "./contracts.js";

const RISK_ORDER: Record<CapabilityRisk, number> = {
  read: 0,
  write: 1,
  external: 2,
  destructive: 3,
};

export interface CapabilityProvider {
  readonly source: CapabilitySource;
  readonly owner: string;
  list(): Promise<CapabilityDescriptor[]>;
  invoke(
    capability: CapabilityDescriptor,
    args: Record<string, unknown>,
    context: CapabilityInvocation,
  ): Promise<CapabilityResult>;
}

export interface CapabilitySearchOptions {
  source?: CapabilitySource;
  tags?: string[];
  maxRisk?: CapabilityRisk;
  onlyAvailable?: boolean;
  limit?: number;
}

export interface CapabilityHubOptions {
  policy?: Partial<CapabilityPolicy>;
}

const DEFAULT_POLICY: CapabilityPolicy = {
  autoAllowMaxRisk: "read",
  denied: [],
  requireApproval: [],
  enabledPacks: [],
};

export class CapabilityHub {
  private readonly providers = new Map<string, CapabilityProvider>();
  private readonly descriptors = new Map<string, CapabilityDescriptor>();
  private readonly packs = new Map<string, CapabilityPack>();
  private policy: CapabilityPolicy;

  constructor(options: CapabilityHubOptions = {}) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
  }

  /* ---------------------------------------------------------------- */
  /* 注册与刷新                                                       */
  /* ---------------------------------------------------------------- */

  registerProvider(provider: CapabilityProvider): void {
    this.providers.set(`${provider.source}:${provider.owner}`, provider);
  }

  /**
   * 从所有 provider 拉取能力描述。
   * 某个 provider 失败时只记录 unavailable，不影响其他能力。
   */
  async refresh(): Promise<CapabilityDescriptor[]> {
    this.descriptors.clear();

    const results = await Promise.allSettled(
      [...this.providers.values()].map(async (provider) => {
        try {
          return await provider.list();
        } catch {
          return [];
        }
      }),
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const descriptor of result.value) {
        this.descriptors.set(descriptor.id, descriptor);
      }
    }

    return this.list();
  }

  registerPack(pack: CapabilityPack): void {
    this.packs.set(pack.id, pack);
  }

  listPacks(): CapabilityPack[] {
    return [...this.packs.values()];
  }

  /* ---------------------------------------------------------------- */
  /* 查询                                                             */
  /* ---------------------------------------------------------------- */

  list(options: CapabilitySearchOptions = {}): CapabilityDescriptor[] {
    let items = [...this.descriptors.values()];

    if (options.source) {
      items = items.filter((item) => item.source === options.source);
    }
    if (options.tags?.length) {
      const wanted = new Set(options.tags);
      items = items.filter((item) => item.tags.some((tag) => wanted.has(tag)));
    }
    if (options.maxRisk) {
      items = items.filter(
        (item) => RISK_ORDER[item.risk] <= RISK_ORDER[options.maxRisk!],
      );
    }
    if (options.onlyAvailable !== false) {
      items = items.filter((item) => item.available);
    }

    return items.slice(0, options.limit ?? 100);
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.descriptors.get(id);
  }

  /**
   * 按意图搜索。先做关键词匹配，后续可以替换成 embedding。
   */
  search(query: string, options: CapabilitySearchOptions = {}): CapabilityDescriptor[] {
    const terms = tokenize(query);
    const candidates = this.list({ ...options, limit: 1000 });

    const scored = candidates.map((item) => {
      const haystack = [
        item.id,
        item.name,
        item.summary,
        item.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      let score = 0;
      for (const term of terms) {
        if (!term) continue;
        if (haystack.includes(term)) score += term.length >= 3 ? 3 : 1;
      }
      if (item.risk === "read") score += 0.5;
      return { item, score };
    });

    return scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit ?? 8)
      .map(({ item }) => item);
  }

  /**
   * 生成给模型看的短目录。默认只输出可用、常用能力。
   */
  buildCatalogSummary(maxChars = 2400): string {
    const items = this.list({ onlyAvailable: true, maxRisk: "write" });
    const lines: string[] = ["可用能力（需要完整参数时用 companion_capability_describe）："];

    for (const item of items) {
      const line = `- ${item.id} [${item.risk}] ${item.summary}`;
      if (lines.join("\n").length + line.length > maxChars) break;
      lines.push(line);
    }

    return lines.join("\n");
  }

  /* ---------------------------------------------------------------- */
  /* 策略与调用                                                       */
  /* ---------------------------------------------------------------- */

  getPolicy(): CapabilityPolicy {
    return { ...this.policy, enabledPacks: [...this.policy.enabledPacks] };
  }

  setPolicy(patch: Partial<CapabilityPolicy>): void {
    this.policy = {
      ...this.policy,
      ...patch,
      denied: patch.denied ?? this.policy.denied,
      requireApproval: patch.requireApproval ?? this.policy.requireApproval,
      enabledPacks: patch.enabledPacks ?? this.policy.enabledPacks,
    };
  }

  enablePack(packId: string): void {
    if (!this.packs.has(packId)) {
      throw new Error(`unknown capability pack: ${packId}`);
    }
    if (!this.policy.enabledPacks.includes(packId)) {
      this.policy.enabledPacks.push(packId);
    }
  }

  disablePack(packId: string): void {
    this.policy.enabledPacks = this.policy.enabledPacks.filter((id) => id !== packId);
  }

  /** 返回 null 表示允许；返回字符串表示拒绝原因。 */
  checkPolicy(capability: CapabilityDescriptor): string | null {
    if (!capability.available) {
      return "capability unavailable";
    }
    if (this.policy.denied.includes(capability.id)) {
      return "capability denied by policy";
    }
    if (capability.requiresApproval) {
      return "capability requires approval";
    }
    if (
      RISK_ORDER[capability.risk] > RISK_ORDER[this.policy.autoAllowMaxRisk]
    ) {
      return `risk ${capability.risk} exceeds auto-allow limit`;
    }
    return null;
  }

  /**
   * 调用能力。
   *
   * 注意：这是给“没有原生工具形态”的能力准备的。
   * 原生 DSH 工具应继续由模型直接调用，避免多一层包装。
   */
  async invoke(
    id: string,
    args: Record<string, unknown>,
    context: Omit<CapabilityInvocation, "capabilityId" | "args"> = {},
  ): Promise<CapabilityResult> {
    const capability = this.descriptors.get(id);
    if (!capability) {
      return { ok: false, error: `unknown capability: ${id}` };
    }

    const denial = this.checkPolicy(capability);
    if (denial) {
      return { ok: false, denied: true, error: denial };
    }

    const provider = this.providers.get(
      `${capability.source}:${capability.owner ?? ""}`,
    );
    if (!provider) {
      return {
        ok: false,
        error: `no provider registered for ${capability.source}:${capability.owner ?? ""}`,
      };
    }

    try {
      return await provider.invoke(capability, args, {
        ...context,
        capabilityId: id,
        args,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,，。.!！?？/\\|_\-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
