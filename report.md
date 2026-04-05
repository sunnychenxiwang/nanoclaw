# NanoClaw 项目分析报告

## 目录

1. [项目概述](#1-项目概述)
2. [设计哲学](#2-设计哲学)
3. [项目结构](#3-项目结构)
4. [核心架构](#4-核心架构)
5. [代码逻辑分析](#5-代码逻辑分析)
6. [功能使用](#6-功能使用)
7. [安全模型](#7-安全模型)
8. [扩展机制](#8-扩展机制)
9. [总结与评价](#9-总结与评价)

---

## 1. 项目概述

**NanoClaw** 是一个轻量级的个人 AI 助手系统，允许用户通过多种消息渠道（WhatsApp、Telegram、Discord、Slack、Gmail）与 Claude AI 进行交互。项目的核心特点是：

- **容器隔离**：AI Agent 运行在独立的 Linux 容器中，实现 OS 级别的安全隔离
- **多渠道支持**：通过 Skills 系统按需添加消息渠道
- **单进程架构**：整个系统由一个 Node.js 进程驱动，简洁易懂
- **AI 原生设计**：安装、调试、监控都通过 Claude Code 完成

### 1.1 项目定位

NanoClaw 是 OpenClaw 项目的轻量替代方案。OpenClaw 拥有近 50 万行代码、53 个配置文件、70+ 依赖，而 NanoClaw 追求"小到足以理解"——一个进程、少量源文件、无微服务架构。

### 1.2 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js 20+ / TypeScript |
| 数据库 | SQLite (better-sqlite3) |
| 容器运行时 | Docker / Apple Container |
| AI SDK | Claude Agent SDK |
| 消息渠道 | Baileys (WhatsApp), Grammy (Telegram), Discord.js, Slack Bolt |
| 凭证管理 | OneCLI Agent Vault |

---

## 2. 设计哲学

### 2.1 核心原则

#### 小到足以理解 (Small Enough to Understand)

```
一个进程 + 少量源文件 + 无微服务 = 可理解的代码库
```

项目架构极其简洁：
- 单一 Node.js 进程处理所有逻辑
- 无消息队列、无服务网格、无复杂抽象层
- 核心代码集中在 `src/` 目录下的约 30 个文件中

#### 安全通过隔离实现 (Security Through Isolation)

与传统应用层权限系统不同，NanoClaw 采用 **OS 级容器隔离**：

```
┌─────────────────────────────────────────────────────────┐
│                      Host System                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │           NanoClaw Orchestrator                  │    │
│  │              (Node.js Process)                   │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                                │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Container Runtime                   │    │
│  │         (Docker / Apple Container)              │    │
│  │  ┌─────────────┐  ┌─────────────┐               │    │
│  │  │ Container A │  │ Container B │  ...          │    │
│  │  │  (Group 1)  │  │  (Group 2)  │               │    │
│  │  │  - Claude   │  │  - Claude   │               │    │
│  │  │  - Browser  │  │  - Browser  │               │    │
│  │  │  - Bash     │  │  - Bash     │               │    │
│  │  └─────────────┘  └─────────────┘               │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

Agent 只能看到显式挂载的目录，Bash 命令在容器内执行而非宿主机。

#### 为个人用户构建 (Built for the Individual User)

这不是一个通用框架，而是"定制化软件"：
- 用户 Fork 仓库后通过 Skills 添加所需功能
- 最终得到的是"只做你需要的事"的干净代码
- 没有配置膨胀 —— 想要不同行为就改代码

#### AI 原生 (AI-Native)

| 传统方式 | NanoClaw 方式 |
|---------|--------------|
| 安装向导 | Claude Code 引导设置 |
| 监控仪表板 | 问 Claude 发生了什么 |
| 调试工具 | 描述问题让 Claude 修复 |
| 日志分析 UI | 让 Claude 读日志 |

#### Skills 优于 Features (Skills Over Features)

贡献者不直接添加功能到核心代码库，而是提交 **Skills**（技能）。用户运行 `/add-telegram` 等 Skills 来定制他们的 Fork。

### 2.2 设计决策

```
Channels --> SQLite --> Polling Loop --> Container (Claude Agent SDK) --> Response
```

- **SQLite 而非 PostgreSQL**：单用户场景足够，零配置
- **文件轮询而非消息队列**：简单可靠，无需额外基础设施
- **CLAUDE.md 而非数据库配置**：自然语言的记忆系统
- **容器而非应用层权限**：真正的 OS 级隔离

---

## 3. 项目结构

```
nanoclaw/
├── src/                          # 核心源代码
│   ├── index.ts                  # 主入口 - 编排器
│   ├── config.ts                 # 配置常量
│   ├── router.ts                 # 消息格式化与路由
│   ├── db.ts                     # SQLite 数据库操作
│   ├── container-runner.ts       # 容器生命周期管理
│   ├── container-runtime.ts      # 容器运行时抽象
│   ├── group-queue.ts            # 分组消息队列
│   ├── group-folder.ts           # 分组目录解析
│   ├── ipc.ts                    # IPC 消息处理
│   ├── task-scheduler.ts         # 定时任务调度
│   ├── remote-control.ts         # 远程控制功能
│   ├── sender-allowlist.ts       # 发送者白名单
│   ├── mount-security.ts         # 挂载安全验证
│   ├── logger.ts                 # 日志系统
│   ├── timezone.ts               # 时区处理
│   ├── types.ts                  # TypeScript 类型定义
│   └── channels/                 # 渠道抽象
│       ├── index.ts              # 渠道加载入口
│       └── registry.ts           # 渠道注册中心
│
├── container/                    # 容器相关
│   ├── Dockerfile                # 容器镜像定义
│   ├── build.sh                  # 构建脚本
│   ├── agent-runner/             # Agent 运行器
│   │   └── src/index.ts          # 容器内 Agent 主程序
│   └── skills/                   # 容器内技能
│       ├── agent-browser/        # 浏览器自动化
│       ├── capabilities/         # 能力查询
│       ├── status/               # 状态命令
│       └── slack-formatting/     # Slack 格式化
│
├── groups/                       # 分组目录
│   ├── main/                     # 主控制组
│   │   └── CLAUDE.md             # 主组记忆
│   └── global/                   # 全局共享记忆
│       └── CLAUDE.md             # 全局 CLAUDE.md
│
├── .claude/                      # Claude Code 配置
│   ├── settings.json             # Claude 设置
│   └── skills/                   # 技能定义
│       ├── setup/                # 安装技能
│       ├── add-whatsapp/         # WhatsApp 技能
│       ├── add-telegram/         # Telegram 技能
│       ├── add-slack/            # Slack 技能
│       ├── add-discord/          # Discord 技能
│       ├── customize/            # 定制化技能
│       └── ...                   # 更多技能
│
├── setup/                        # 安装程序
│   └── index.ts                  # 分步安装逻辑
│
├── store/                        # 数据存储
│   └── messages.db               # SQLite 数据库
│
├── data/                         # 运行时数据
│   ├── ipc/                      # IPC 消息目录
│   └── sessions/                 # 会话数据
│
├── docs/                         # 文档
├── assets/                       # 静态资源
├── launchd/                      # macOS 服务配置
│
├── package.json                  # 项目配置
├── tsconfig.json                 # TypeScript 配置
└── CLAUDE.md                     # 项目级 Claude 指令
```

### 3.1 核心文件职责

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 编排器：状态管理、消息循环、Agent 调用 |
| `src/channels/registry.ts` | 渠道注册中心（启动时自注册） |
| `src/ipc.ts` | IPC 监听器与任务处理 |
| `src/router.ts` | 消息格式化与出站路由 |
| `src/config.ts` | 触发模式、路径、间隔配置 |
| `src/container-runner.ts` | 生成 Agent 容器并处理挂载 |
| `src/task-scheduler.ts` | 运行定时任务 |
| `src/db.ts` | SQLite 操作封装 |
| `container/agent-runner/src/index.ts` | 容器内 Agent 主程序 |

---

## 4. 核心架构

### 4.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NanoClaw Architecture                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   WhatsApp   │  │   Telegram   │  │    Slack     │  │   Discord    │    │
│  │   Channel    │  │   Channel    │  │   Channel    │  │   Channel    │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │            │
│         └─────────────────┴─────────────────┴─────────────────┘            │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Channel Registry                               │  │
│  │                    (Self-registration at startup)                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     SQLite Database                                   │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │  │
│  │  │  messages   │ │   groups    │ │   tasks     │ │  sessions   │    │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Message Loop (index.ts)                          │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │  │
│  │  │  Poll Messages  │→ │  Format Prompt  │→ │  Dispatch Queue │      │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Group Queue (group-queue.ts)                     │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │  │
│  │  │ Group A │  │ Group B │  │ Group C │  │ Group D │  │   ...   │   │  │
│  │  │ Queue   │  │ Queue   │  │ Queue   │  │ Queue   │  │         │   │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                   Container Runner (container-runner.ts)              │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │  Build Volume Mounts → Spawn Container → Stream Output       │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Container (Docker/Apple)                         │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    Agent Runner                                │  │  │
│  │  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │  │  │
│  │  │  │ Claude Agent   │  │  MCP Server    │  │  Browser       │  │  │  │
│  │  │  │ SDK            │  │  (nanoclaw)    │  │  Automation    │  │  │  │
│  │  │  └────────────────┘  └────────────────┘  └────────────────┘  │  │  │
│  │  │                                                                │  │  │
│  │  │  Mounts: /workspace/group, /workspace/ipc, /workspace/extra   │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     OneCLI Gateway (Credentials)                      │  │
│  │  ┌───────────────────────────────────────────────────────────────┐   │  │
│  │  │  API Key Injection → Rate Limiting → Access Policies          │   │  │
│  │  └───────────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 数据流

```
用户消息 ──▶ Channel ──▶ SQLite ──▶ Message Loop ──▶ Group Queue
                                                          │
                                                          ▼
                                              Container Runner
                                                          │
                                                          ▼
                                              Claude Agent SDK
                                                          │
                                                          ▼
                                              Streaming Output
                                                          │
                                                          ▼
                                              Channel.sendMessage()
                                                          │
                                                          ▼
                                                   用户收到回复
```

### 4.3 状态机

每个会话组有以下状态：

1. **消息积累**：消息存储在 SQLite，等待触发词
2. **触发检测**：检测到 `@Andy` 触发词
3. **容器启动**：如果没有活动容器则启动新容器
4. **消息管道**：将格式化的消息发送到容器 stdin
5. **Agent 处理**：Claude Agent SDK 处理消息
6. **流式输出**：解析输出标记并发送回复
7. **空闲等待**：等待后续消息或超时关闭

---

## 5. 代码逻辑分析

### 5.1 主入口 (src/index.ts)

核心编排逻辑：

```typescript
// 状态管理
let lastTimestamp = '';                    // 最后处理的消息时间戳
let sessions: Record<string, string> = {}; // 组文件夹 → 会话ID 映射
let registeredGroups: Record<string, RegisteredGroup> = {}; // 注册的组
let lastAgentTimestamp: Record<string, string> = {}; // 每组最后 Agent 处理时间

// 核心循环
async function startMessageLoop(): Promise<void> {
  while (true) {
    // 1. 获取新消息
    const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);
    
    // 2. 按组去重
    const messagesByGroup = new Map<string, NewMessage[]>();
    
    // 3. 检查触发词
    if (needsTrigger && !hasTrigger) continue;
    
    // 4. 格式化消息
    const formatted = formatMessages(messagesToSend, TIMEZONE);
    
    // 5. 发送到队列
    if (queue.sendMessage(chatJid, formatted)) {
      // 已有活动容器，管道发送
    } else {
      // 需要启动新容器
      queue.enqueueMessageCheck(chatJid);
    }
  }
}
```

关键设计点：
- **消息光标恢复**：崩溃后从最后一条 bot 消息恢复
- **非触发消息积累**：非主组需要触发词，但会积累上下文
- **容器复用**：活动容器可通过 stdin 接收后续消息

### 5.2 容器运行器 (src/container-runner.ts)

容器生命周期管理：

```typescript
export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  // 1. 构建卷挂载
  const mounts = buildVolumeMounts(group, input.isMain);
  
  // 2. 生成容器参数
  const containerArgs = await buildContainerArgs(mounts, containerName);
  
  // 3. 启动容器进程
  const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  
  // 4. 写入输入并关闭 stdin
  container.stdin.write(JSON.stringify(input));
  container.stdin.end();
  
  // 5. 流式解析输出
  container.stdout.on('data', (data) => {
    // 解析 OUTPUT_START_MARKER / OUTPUT_END_MARKER 对
    // 调用 onOutput 回调
  });
}
```

挂载策略：

| 组类型 | 挂载内容 |
|--------|----------|
| Main 组 | 项目根目录(只读) + store(读写) + 组目录(读写) |
| 普通组 | 组目录(读写) + global(只读) |
| 所有组 | IPC 目录 + .claude/ 配置 + agent-runner 源码 |

### 5.3 渠道注册 (src/channels/registry.ts)

自注册模式：

```typescript
const registry = new Map<string, ChannelFactory>();

export function registerChannel(name: string, factory: ChannelFactory): void {
  registry.set(name, factory);
}

// 使用示例 (在渠道模块中)
registerChannel('whatsapp', (opts) => {
  if (!credentials) return null; // 无凭证则跳过
  return new WhatsAppChannel(opts);
});
```

启动时通过 barrel import 自动加载所有渠道：

```typescript
import './channels/index.js'; // 触发所有渠道的自注册
```

### 5.4 数据库层 (src/db.ts)

SQLite 表结构：

```sql
-- 聊天元数据
CREATE TABLE chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT,
  channel TEXT,
  is_group INTEGER DEFAULT 0
);

-- 消息存储
CREATE TABLE messages (
  id TEXT,
  chat_jid TEXT,
  sender TEXT,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT,
  is_from_me INTEGER,
  is_bot_message INTEGER DEFAULT 0,
  reply_to_message_id TEXT,
  PRIMARY KEY (id, chat_jid)
);

-- 注册的组
CREATE TABLE registered_groups (
  jid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL UNIQUE,
  trigger_pattern TEXT NOT NULL,
  container_config TEXT,
  requires_trigger INTEGER DEFAULT 1,
  is_main INTEGER DEFAULT 0
);

-- 定时任务
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL, -- cron/interval/once
  schedule_value TEXT NOT NULL,
  next_run TEXT,
  status TEXT DEFAULT 'active'
);

-- 会话管理
CREATE TABLE sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);

-- 路由状态
CREATE TABLE router_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 5.5 IPC 系统

IPC 用于容器内 Agent 与宿主机通信：

```typescript
// IPC 目录结构
data/ipc/
├── {group-folder}/
│   ├── messages/     # 出站消息
│   │   └── {uuid}.json
│   ├── tasks/        # 任务操作
│   │   └── {uuid}.json
│   └── input/        # 入站消息（容器读取）
│       ├── {uuid}.json
│       └── _close    # 关闭信号
└── errors/           # 错误文件
```

IPC 消息类型：

```typescript
type IpcMessage =
  | { type: 'message'; chatJid: string; text: string }
  | { type: 'schedule_task'; prompt: string; schedule_type: string; ... }
  | { type: 'pause_task'; taskId: string }
  | { type: 'register_group'; jid: string; name: string; ... }
  | { type: 'refresh_groups' };
```

### 5.6 容器内 Agent Runner (container/agent-runner/src/index.ts)

```typescript
async function main(): Promise<void> {
  // 1. 读取 stdin 输入
  const containerInput = JSON.parse(await readStdin());
  
  // 2. 准备 SDK 环境
  const sdkEnv = { ...process.env }; // 凭证由 OneCLI 注入
  
  // 3. 查询循环
  while (true) {
    // 运行 Claude Agent SDK 查询
    const queryResult = await runQuery(prompt, sessionId, ...);
    
    // 等待新消息或关闭信号
    const nextMessage = await waitForIpcMessage();
    if (nextMessage === null) break;
    
    prompt = nextMessage;
  }
}
```

消息流处理：

```typescript
class MessageStream {
  // 推送式异步迭代器，保持 isSingleUserTurn=false
  // 允许 Agent Teams 子代理完整运行
  push(text: string): void { ... }
  end(): void { ... }
  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> { ... }
}
```

---

## 6. 功能使用

### 6.1 基本使用

用户通过触发词与助手交互（默认 `@Andy`）：

```
@Andy send an overview of the sales pipeline every weekday morning at 9am
@Andy review the git history for the past week each Friday
@Andy every Monday at 8am, compile AI news from Hacker News
```

### 6.2 主渠道管理

从主渠道（自聊）可以管理所有组和任务：

```
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the Family Chat group
```

### 6.3 定时任务

支持三种调度类型：

| 类型 | 格式 | 示例 |
|------|------|------|
| Cron | 标准 cron 表达式 | `0 9 * * 1-5` (工作日 9 点) |
| Interval | 毫秒数 | `3600000` (每小时) |
| Once | ISO 时间戳 | `2024-12-25T09:00:00Z` |

### 6.4 定制化

无配置文件，直接修改代码：

```
"Change the trigger word to @Bob"
"Remember to make responses shorter"
"Add a custom greeting when I say good morning"
```

或运行 `/customize` 进行引导式定制。

### 6.5 Skills 系统

四种技能类型：

#### 1. Feature Skills (分支型)

添加功能，代码在 `skill/*` 分支：

```
/add-whatsapp  → 合并 skill/whatsapp 分支
/add-telegram  → 合并 skill/telegram 分支
/add-slack     → 合并 skill/slack 分支
```

#### 2. Utility Skills (带代码文件)

独立工具，代码在技能目录：

```
/claw → 安装 Python CLI 工具
```

#### 3. Operational Skills (纯指令)

工作流指南，无代码变更：

```
/setup              → 安装配置
/debug              → 故障排查
/customize          → 定制化引导
/update-nanoclaw    → 拉取上游更新
```

#### 4. Container Skills (容器内)

影响容器内 Agent 行为：

```
container/skills/agent-browser/  → 浏览器自动化
container/skills/capabilities/   → /capabilities 命令
container/skills/status/         → /status 命令
```

---

## 7. 安全模型

### 7.1 多层安全架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Security Layers                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 1: Container Isolation                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  - Agent runs in Linux container (Docker/Apple)     │    │
│  │  - OS-level filesystem isolation                    │    │
│  │  - Network namespacing                              │    │
│  │  - User namespace (runs as non-root inside)         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Layer 2: Mount Allowlist                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  - External allowlist at ~/.config/nanoclaw/        │    │
│  │  - Never mounted into containers                    │    │
│  │  - Blocked patterns for sensitive paths             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Layer 3: Credential Proxy (OneCLI)                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  - API keys never enter containers                  │    │
│  │  - Credentials injected at request time             │    │
│  │  - Per-agent rate limits and access policies        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Layer 4: Sender Allowlist                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  - Control who can trigger the agent                │    │
│  │  - Per-group sender restrictions                    │    │
│  │  - Drop mode: discard unauthorized messages         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Layer 5: IPC Authorization                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  - Per-group IPC namespace                          │    │
│  │  - Non-main groups can only affect themselves       │    │
│  │  - Main group verification for admin operations     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 挂载安全

```typescript
// 挂载白名单验证
export function validateAdditionalMounts(
  mounts: AdditionalMount[],
  groupName: string,
  isMain: boolean,
): VolumeMount[] {
  const allowlist = loadMountAllowlist();
  
  // 1. 检查是否在允许的根目录下
  // 2. 检查是否匹配阻止模式
  // 3. 非主组强制只读（如果配置）
  // 4. 返回验证后的挂载列表
}
```

白名单配置示例：

```json
{
  "allowedRoots": [
    { "path": "~/projects", "allowReadWrite": true },
    { "path": "~/documents", "allowReadWrite": false }
  ],
  "blockedPatterns": [
    ".ssh",
    ".gnupg",
    ".env",
    "credentials.json"
  ],
  "nonMainReadOnly": true
}
```

### 7.3 凭证安全

OneCLI Agent Vault 工作流程：

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Container  │     │   OneCLI     │     │  API Server  │
│   (Agent)    │     │   Gateway    │     │              │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ HTTPS Request      │                    │
       │ (no API key)       │                    │
       │───────────────────▶│                    │
       │                    │                    │
       │                    │ Inject API Key     │
       │                    │───────────────────▶│
       │                    │                    │
       │                    │◀───────────────────│
       │                    │    Response        │
       │◀───────────────────│                    │
       │    Response        │                    │
       │                    │                    │
```

关键点：
- 容器内无真实凭证
- OneCLI 拦截 HTTPS 请求并注入认证
- 支持速率限制和访问策略
- OAuth token 自动刷新

### 7.4 IPC 授权

```typescript
// 消息发送授权
if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
  await deps.sendMessage(data.chatJid, data.text);
} else {
  logger.warn('Unauthorized IPC message attempt blocked');
}

// 任务操作授权
const task = getTaskById(data.taskId);
if (task && (isMain || task.group_folder === sourceGroup)) {
  // 允许操作
} else {
  logger.warn('Unauthorized task operation attempt');
}
```

---

## 8. 扩展机制

### 8.1 添加新渠道

1. 创建 `skill/<channel-name>` 分支
2. 实现渠道代码：

```typescript
// src/channels/mychannel.ts
import { Channel, ChannelOpts } from '../types.js';
import { registerChannel } from './registry.js';

class MyChannel implements Channel {
  name = 'mychannel';
  
  constructor(private opts: ChannelOpts) {}
  
  async connect(): Promise<void> {
    // 连接逻辑
  }
  
  async sendMessage(jid: string, text: string): Promise<void> {
    // 发送逻辑
  }
  
  ownsJid(jid: string): boolean {
    return jid.startsWith('my:');
  }
  
  isConnected(): boolean {
    return this.connected;
  }
  
  async disconnect(): Promise<void> {
    // 断开逻辑
  }
}

registerChannel('mychannel', (opts: ChannelOpts) => {
  if (!process.env.MYCHANNEL_TOKEN) return null;
  return new MyChannel(opts);
});
```

3. 创建 SKILL.md：

```markdown
---
name: add-mychannel
description: Add MyChannel as a messaging channel.
---

# MyChannel Setup

1. Merge the skill branch:
   ```bash
   git fetch origin skill/mychannel
   git merge origin/skill/mychannel
   ```

2. Create a bot token at https://mychannel.com/bots

3. Add to .env:
   ```
   MYCHANNEL_TOKEN=your_token_here
   ```

4. Build and restart:
   ```bash
   npm install && npm run build
   ```
```

### 8.2 添加容器内技能

在 `container/skills/` 创建：

```markdown
---
name: my-tool
description: Description of what this skill does.
allowed-tools:
  - Bash
  - Read
  - Write
---

# My Tool

Instructions for the container agent...

## Usage

...
```

### 8.3 添加 MCP 工具

容器内 MCP 服务器位于 `container/agent-runner/src/ipc-mcp-stdio.ts`：

```typescript
// 添加新工具
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // 现有工具...
    {
      name: 'my_new_tool',
      description: 'Description',
      inputSchema: { type: 'object', properties: { ... } },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'my_new_tool') {
    // 工具逻辑
  }
});
```

---

## 9. 总结与评价

### 9.1 优点

| 方面 | 评价 |
|------|------|
| **架构简洁** | 单进程、少量文件、无微服务，易于理解和维护 |
| **安全设计** | 容器隔离 + 多层安全，远超应用层权限系统 |
| **可扩展性** | Skills 系统允许按需定制，避免功能膨胀 |
| **AI 原生** | 充分利用 Claude Code 能力，减少传统 UI 开发 |
| **个人友好** | 专为个人用户设计，非企业平台 |
| **凭证管理** | OneCLI 提供专业的密钥管理方案 |

### 9.2 权衡与限制

| 方面 | 说明 |
|------|------|
| **单用户设计** | 不支持多租户，不适合团队/企业场景 |
| **配置方式** | 无配置文件，定制需改代码（这也是设计意图） |
| **Skills 学习曲线** | 需要理解 Skills 分支系统才能贡献 |
| **容器依赖** | 必须运行 Docker 或 Apple Container |
| **消息延迟** | 轮询模式引入约 2 秒延迟 |

### 9.3 适用场景

**推荐使用：**
- 个人 AI 助手需求
- 技术用户愿意定制代码
- 需要安全隔离的 Agent 执行
- 多渠道消息整合

**不推荐使用：**
- 企业级多租户需求
- 非技术用户期望开箱即用
- 需要低延迟实时响应

### 9.4 与 OpenClaw 对比

| 特性 | NanoClaw | OpenClaw |
|------|----------|----------|
| 代码量 | ~30 核心文件 | ~50 万行 |
| 进程数 | 1 | 4-5 |
| 配置文件 | 几乎无 | 53 个 |
| 依赖数 | 3 个核心 | 70+ |
| 隔离级别 | OS 级容器 | 应用层权限 |
| 可理解性 | 高 | 低 |
| 功能完整度 | 核心 + Skills | 全功能内置 |

### 9.5 设计启示

1. **少即是多**：通过减少复杂性获得安全性和可维护性
2. **隔离优于权限**：真正的 OS 隔离比复杂的权限系统更安全
3. **按需定制**：Skills 系统让每个用户获得"刚刚好"的功能
4. **AI 原生**：利用 AI 能力简化传统软件工程
5. **个人优先**：专注个人用户需求，避免过度工程

---

## 附录

### A. 关键配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `ASSISTANT_NAME` | `Andy` | 助手名称，影响触发词 |
| `POLL_INTERVAL` | `2000` | 消息轮询间隔（毫秒） |
| `CONTAINER_TIMEOUT` | `1800000` | 容器超时（30分钟） |
| `MAX_MESSAGES_PER_PROMPT` | `10` | 每次提示最大消息数 |
| `MAX_CONCURRENT_CONTAINERS` | `5` | 最大并发容器数 |
| `ONECLI_URL` | `http://localhost:10254` | OneCLI 网关地址 |
| `TZ` | 自动检测 | 时区 |

### B. 目录权限矩阵

| 目录 | Main 组 | 普通组 |
|------|---------|--------|
| `/workspace/project` | 只读 | ❌ |
| `/workspace/project/store` | 读写 | ❌ |
| `/workspace/group` | 读写 | 读写 |
| `/workspace/global` | 只读 | 只读 |
| `/workspace/ipc` | 读写 | 读写 |
| `/workspace/extra/*` | 配置决定 | 配置决定 |

### C. 命令速查

```bash
# 开发
npm run dev          # 启动开发服务器
npm run build        # 编译 TypeScript
npm run test         # 运行测试

# 服务管理
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist     # macOS 启动
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist   # macOS 停止
systemctl --user start nanoclaw    # Linux 启动
systemctl --user stop nanoclaw     # Linux 停止

# 容器
./container/build.sh              # 重建容器镜像
docker builder prune -f           # 清理构建缓存

# 调试
tail -f logs/nanoclaw.log         # 查看日志
tail -f logs/nanoclaw.error.log   # 查看错误日志
```

---

*报告生成时间: 2024-04-04*
*项目版本: v1.2.47*
