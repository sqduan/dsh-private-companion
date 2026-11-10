# dsh-private-companion

把 AstrBot「我会永远陪着你」的**人格、记忆、关系、角色生活**迁到 DeepSeek Harness 的插件项目。

当前阶段：**可运行 MVP**。已在 DSH web profile 安装并加载，提供人格上下文、SQLite 记忆、关系、生活状态和能力目录。

## 为什么不做全量移植

原插件约 46 万行 Python、141 张表、18 个工作区，包含主动消息、群聊、TTS、生图、识屏、米家、3D 小屋。  
DSH 已经提供 Agent、会话、人格、工具、MCP、渠道和审批，所以这里只做 DSH 没有的“陪伴内核”。

## 本插件负责

- 稳定人格 + 动态状态
- 长期记忆（事实、经历、约定、纪念日）
- 关系卡（阶段、亲密度、信任、边界）
- 角色生活（心情、精力、日程、睡眠）
- 能力集合：发现并委托 DSH 插件 / MCP / 内置工具
- AstrBot 数据迁移

## 不负责

- 主动消息调度、回复闸门、消息分段（优先用现成 DSH 插件）
- QQ / 微信协议（交给渠道插件）
- TTS / 生图 / 表情包的具体实现（作为能力接入）
- 3D 陪伴小屋 UI
- 重新实现 MCP 客户端

## 目录

```
docs/
  REQUIREMENTS.md      需求分析（功能、边界、验收）
src/
  contracts.ts         人格 / 记忆 / 关系 / 能力目录的类型契约
  capability-hub.ts    能力集合：发现、搜索、策略、委托调用
examples/
  capability-packs.json 示例能力包
```

## 能力集合的核心思想

1. **不复制实现**：插件和 MCP 已经有的能力，只登记。
2. **原生工具优先**：DSH 已经暴露给模型的工具，继续直接调用。
3. **Hub 只做桥**：目录摘要、能力包、风险策略、按需展开 schema。
4. **元工具只给非工具能力**：插件服务、MCP resource、HTTP 服务才走 `companion_capability_call`。
5. **最小权限**：只读自动放行；写 / 外部 / 破坏性操作走审批。

## 下一步

1. 确认 MVP 范围（见 `docs/REQUIREMENTS.md` 第 9 节）
2. 建 DSH 插件骨架（`package.json`、`cordis.patch.yml`、`lib/index.js`）
3. 先落 SQLite：人格、记忆、关系、生活状态
4. 接能力目录：DSH 工具 + MCP
5. 最后做 AstrBot 数据导入

## 状态

- [x] 需求分析
- [x] 类型契约
- [x] 能力集合骨架
- [x] DSH 插件入口
- [x] SQLite 存储
- [x] 记忆召回
- [x] 关系与生活状态
- [x] 能力目录实装
- [x] AstrBot 导入


## 安装

```bash
# 本地开发
dsh plugin --profile web add link:/home/cheems/Deepseek/dsh-private-companion
```

安装后重启 DSH，或在插件页停用/启用一次。

## 工具

- `companion_status`
- `companion_memory_write`
- `companion_memory_search`
- `companion_relationship_get`
- `companion_life_state`
- `companion_capability_search`
- `companion_capability_describe`
- `companion_capability_packs`
- `companion_capability_pack_set`

## 测试

```bash
npm test
```

## 导入 AstrBot 回忆

```bash
node scripts/import-astrbot.mjs
```

默认只导入用户原话里较有意义的内容；`--include-replies` 会连助手回复一起导入。


## 绑定范围（推荐 agentPreset）

插件支持三种绑定：

| bindMode | 含义 | 建议 |
|---|---|---|
| `global` | 所有 DSH 会话都注入陪伴上下文 | 兼容模式 |
| `agentPreset` | 只绑定 `session.header.agentPreset` 匹配的 Agent | **推荐** |
| `session` | 每个 session 独立绑定、独立关系卡 | **推荐** |

DSH 的 Agent 是 session-backed 的，`agent.id` 就是 session id。  
陪伴的「她」应该跟着 session 走：每个聊天窗口有自己的关系和记忆；新 session 默认独立，不共享同一段关系。

配置项：

- `bindMode`：`global` / `agentPreset` / `session`（默认 `session`）
- `autoBindSessions`：session 模式下第一次见到会话时自动建立绑定
- `agentPreset`：要匹配的 preset id；留空时退化为全局
- `sessionId`：`session` 模式下要匹配的 session id
- `companionId` / `companionName`
- `ownerId`
- `timeZone`
- `memoryLimit`
- `injectCapabilities`

`companion_status` 会显示当前 session id、agentPreset 和当前绑定配置，方便复制。


### 会话绑定

`bindMode: session` 时，每个 DSH session 可以有独立绑定：

- 第一次见到 session 时，如果 `autoBindSessions: true`，会自动建立绑定
- 配置了 `sessionId` 时，这个 session 使用 `ownerId`，其他 session 使用 `session:<id>`，从而各自有独立关系卡
- 也可以用工具手动管理：

```
companion_session_bind
companion_session_list
companion_session_unbind
```

对 QQ/微信：渠道插件只要把每个好友/群映射到固定的 DSH session，陪伴就会跟着这个 session 走。渠道插件如果能把 peer id 传进来，后续可以在 bind 时写入 `channel` / `peer_id`。
