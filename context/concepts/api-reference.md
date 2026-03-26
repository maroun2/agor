# Agor API Reference

> **FeathersJS REST + WebSocket API** — Complete reference for all endpoints, events, types, and authentication.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Base URL & Transport](#base-url--transport)
4. [Services & REST Endpoints](#services--rest-endpoints)
   - [Sessions](#sessions)
   - [Tasks](#tasks)
   - [Messages](#messages)
   - [Worktrees](#worktrees)
   - [Repos](#repos)
   - [Boards](#boards)
   - [Board Objects](#board-objects)
   - [Board Comments](#board-comments)
   - [Users](#users)
   - [MCP Servers](#mcp-servers)
   - [Session MCP Servers](#session-mcp-servers)
   - [Gateway](#gateway)
   - [Gateway Channels](#gateway-channels)
   - [Thread Session Map](#thread-session-map)
   - [Terminals](#terminals)
   - [Config](#config)
   - [Context](#context)
   - [Files](#files)
   - [Leaderboard](#leaderboard)
   - [Health](#health)
   - [OpenCode](#opencode)
5. [WebSocket Events](#websocket-events)
6. [Data Models](#data-models)
7. [Enumerations](#enumerations)
8. [ID System](#id-system)
9. [Error Handling](#error-handling)
10. [RBAC & Permissions](#rbac--permissions)
11. [Rate Limiting](#rate-limiting)

---

## Overview

Agor's daemon is a **FeathersJS** application exposing:

- **REST** — Standard HTTP verbs on resource paths
- **WebSocket** — Socket.IO real-time events for streaming, collaboration, and live state
- **Swagger/OpenAPI** — Docs available at `GET /swagger`

All authenticated endpoints require a JWT `Authorization: Bearer <token>` header unless otherwise noted.

---

## Authentication

### POST /authentication

Create a session (obtain tokens).

**Strategies:**

| Strategy | Fields |
|----------|--------|
| `local` | `email`, `password` |
| `jwt` | `accessToken` |
| `anonymous` | _(no fields required — default)_ |

**Response:**

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { /* User object */ }
}
```

Token lifetimes:
- `accessToken` — 7 days, issuer: `"agor"`
- `refreshToken` — 30 days

---

### POST /authentication/refresh

Exchange a refresh token for a new token pair.

**Body:** `{ "refreshToken": "eyJ..." }`

**Response:** `{ "accessToken": "...", "refreshToken": "..." }`

---

## Base URL & Transport

```
REST:      http://localhost:3030
WebSocket: ws://localhost:3030
Swagger:   http://localhost:3030/swagger
```

Port is configurable via `~/.agor/config.yaml` or `PORT` env var.

---

## Services & REST Endpoints

### Sessions

**Path:** `/sessions`

Agentic tool conversation containers. A Session is the top-level unit for a Claude Code / Codex / Gemini / OpenCode run.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions` | List sessions |
| `GET` | `/sessions/:id` | Get single session |
| `POST` | `/sessions` | Create session |
| `PATCH` | `/sessions/:id` | Update session |
| `DELETE` | `/sessions/:id` | Delete session |

**Custom Methods:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions/:id/fork` | Fork session at a task |
| `POST` | `/sessions/:id/spawn` | Spawn child session |
| `GET` | `/sessions/:id/genealogy` | Get fork/spawn tree |

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `status` | `SessionStatus` | Filter by status |
| `agentic_tool` | `AgenticToolName` | Filter by tool |
| `board_id` | `BoardID` | Filter by board |
| `worktree_id` | `WorktreeID` | Filter by worktree |
| `include_last_message` | `boolean` | Attach most recent message |
| `last_message_truncation_length` | `number` | Truncate last message content |
| `$limit` | `number` | Page size |
| `$skip` | `number` | Offset |
| `$sort` | `object` | Sort by field |

**WebSocket events:** `created`, `patched`, `removed`

---

### Tasks

**Path:** `/tasks`

Granular work units within a session — each user prompt creates a task.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tasks` | List tasks |
| `GET` | `/tasks/:id` | Get task |
| `POST` | `/tasks` | Create task |
| `PATCH` | `/tasks/:id` | Update task |
| `DELETE` | `/tasks/:id` | Delete task |

**Custom Methods:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tasks/:id/complete` | Mark task completed |
| `POST` | `/tasks/:id/fail` | Mark task failed |

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `session_id` | `SessionID` | Filter by session |
| `status` | `TaskStatus` | Filter by status |
| `$limit` | `number` | Page size |
| `$skip` | `number` | Offset |

**WebSocket events:** `created`, `patched`, `removed`

---

### Messages

**Path:** `/messages`

Individual conversation turns — user, assistant, system, tool results, permission requests.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/messages` | List messages |
| `GET` | `/messages/:id` | Get message |
| `POST` | `/messages` | Create message(s) |

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `session_id` | `SessionID` | Filter by session |
| `task_id` | `TaskID` | Filter by task |
| `type` | `MessageType` | Filter by type |
| `$limit` | `number` | Page size |
| `$skip` | `number` | Offset |
| `$sort` | `object` | Sort (`{ index: 1 }`) |

**WebSocket events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `streaming:start` | `{ session_id, task_id }` | Begin streaming response |
| `streaming:chunk` | `{ session_id, task_id, chunk }` | Incremental text |
| `streaming:end` | `{ session_id, task_id, message }` | Complete message |
| `streaming:error` | `{ session_id, task_id, error }` | Streaming failure |
| `thinking:start` | `{ session_id, task_id }` | Extended thinking started |
| `thinking:chunk` | `{ session_id, task_id, chunk }` | Thinking token |
| `thinking:end` | `{ session_id, task_id }` | Thinking complete |
| `queued` | `{ session_id, queue_position }` | Message queued |
| `permission_resolved` | `{ session_id, task_id, status }` | Permission approved/denied |
| `input_resolved` | `{ session_id, task_id, answers }` | User answered question |

---

### Worktrees

**Path:** `/worktrees`

Git worktrees — the primary unit on Agor boards. Each worktree is an isolated git checkout with its own environment.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/worktrees` | List worktrees |
| `GET` | `/worktrees/:id` | Get worktree |
| `POST` | `/worktrees` | Create worktree |
| `PATCH` | `/worktrees/:id` | Update worktree |
| `DELETE` | `/worktrees/:id` | Delete worktree |

**Lifecycle Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/worktrees/:id/start` | Start environment |
| `POST` | `/worktrees/:id/stop` | Stop environment |
| `POST` | `/worktrees/:id/restart` | Restart environment |
| `POST` | `/worktrees/:id/nuke` | Destructive clean (removes environment data) |
| `GET` | `/worktrees/:id/health` | Check environment health |
| `POST` | `/worktrees/:id/archive-or-delete` | Archive or permanently delete |
| `POST` | `/worktrees/:id/unarchive` | Restore archived worktree |

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `board_id` | `BoardID` | Filter by board |
| `ref` | `string` | Filter by git ref |
| `repo_id` | `RepoID` | Filter by repo |
| `archived` | `boolean` | Include archived |

**WebSocket events:** `created`, `patched`, `removed`

---

### Repos

**Path:** `/repos`

Git repository registrations — remote clones or local path mounts.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos` | List repos |
| `GET` | `/repos/:id` | Get repo |
| `POST` | `/repos` | Register repo (clone or local) |
| `PATCH` | `/repos/:id` | Update repo |

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `mode` | `"remote" \| "local"` | Filter by type |
| `slug` | `string` | Filter by slug |

**POST body for remote clone:**

```json
{
  "repo_type": "remote",
  "remote_url": "https://github.com/org/repo",
  "slug": "org/repo"
}
```

**POST body for local mount:**

```json
{
  "repo_type": "local",
  "local_path": "/absolute/path/to/repo",
  "slug": "my-local-repo"
}
```

---

### Boards

**Path:** `/boards`

Organizational containers — hold worktrees, sessions, zones, annotations.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/boards` | List boards |
| `GET` | `/boards/:id` | Get board |
| `POST` | `/boards` | Create board |
| `PATCH` | `/boards/:id` | Update board |
| `DELETE` | `/boards/:id` | Delete board |

**Custom Methods:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/boards/:id/clone` | Duplicate board |
| `GET` | `/boards/:id/blob` | Export board as binary blob |
| `POST` | `/boards/from-blob` | Import board from blob |
| `GET` | `/boards/:id/yaml` | Export board as YAML |
| `POST` | `/boards/from-yaml` | Import board from YAML |

**WebSocket events:** `created`, `patched`, `removed`

---

### Board Objects

**Path:** `/board-objects`

Canvas annotations: text labels, zones, markdown notes.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/board-objects` | List objects |
| `GET` | `/board-objects/:id` | Get object |
| `POST` | `/board-objects` | Create object |
| `PATCH` | `/board-objects/:id` | Update object |
| `DELETE` | `/board-objects/:id` | Delete object |

**Object Types:**

| Type | Fields |
|------|--------|
| `text` | `content`, `position`, `style` |
| `zone` | `label`, `bounds`, `trigger` (optional) |
| `markdown` | `content`, `position`, `dimensions` |

**Zone Trigger config** (`trigger` field on zone objects):

```json
{
  "template": "Handlebars template for auto-prompt",
  "behavior": "always_new | show_picker",
  "preferred_agent": "claude-code | codex | gemini | opencode"
}
```

**WebSocket events:** `created`, `patched`, `removed`

---

### Board Comments

**Path:** `/board-comments`

Threaded human collaboration — comments with reactions, attachments, spatial pins.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/board-comments` | List comments |
| `GET` | `/board-comments/:id` | Get comment |
| `POST` | `/board-comments` | Create comment |
| `PATCH` | `/board-comments/:id` | Update comment |
| `DELETE` | `/board-comments/:id` | Delete comment |

**Custom Methods:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/board-comments/:id/toggle-reaction` | Add/remove emoji reaction |
| `POST` | `/board-comments/:id/reply` | Create reply (2-level threading) |

**Attachment types:** `session`, `task`, `message`, `worktree`, `zone`, `spatial_pin`

**Notes:**
- Only root comments (no `parent_id`) can be resolved
- Reactions support multiple users per emoji with attribution
- `$limit`/`$skip` for pagination

**WebSocket events:** `created`, `patched`, `removed`

---

### Users

**Path:** `/users`

User accounts with roles, credentials, and preferences.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/users` | List users |
| `GET` | `/users/:id` | Get user |
| `POST` | `/users` | Create user |
| `PATCH` | `/users/:id` | Update user |

**Roles:** `owner` > `admin` > `member` > `viewer`

**Preferences object:**

```json
{
  "audio": { "enabled": true, "volume": 0.8 },
  "onboarding": { "completed": false },
  "event_stream": { "enabled": true }
}
```

**Notes:**
- API keys and env vars are stored encrypted — only _status_ (set/not set) is returned, never plaintext
- `unix_username` is immutable after creation
- `force_password_change` triggers UI prompt on next login

---

### MCP Servers

**Path:** `/mcp-servers`

Model Context Protocol server configurations.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/mcp-servers` | List MCP servers |
| `GET` | `/mcp-servers/:id` | Get MCP server |
| `POST` | `/mcp-servers` | Create MCP server |
| `PATCH` | `/mcp-servers/:id` | Update MCP server |
| `DELETE` | `/mcp-servers/:id` | Delete MCP server |

**Transport types:** `http`, `sse`, `stdio`

**Auth types:** `none`, `bearer`, `jwt`, `oauth` (2.0 and 2.1)

**OAuth Flow Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp-servers/oauth-start` | Initiate OAuth browser flow |
| `POST` | `/mcp-servers/oauth-complete` | Complete OAuth with auth code |
| `GET` | `/mcp-servers/oauth-callback` | OAuth redirect receiver |
| `POST` | `/mcp-servers/oauth-notify` | Webhook notification handler |
| `POST` | `/mcp-servers/oauth-disconnect` | Revoke OAuth tokens |

**Utility Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp-servers/test-jwt` | Test JWT auth config |
| `POST` | `/mcp-servers/test-oauth` | Test OAuth-authenticated server |
| `POST` | `/mcp-servers/discover` | Discover server capabilities (tools, resources, prompts) |

**Tool permissions per server:**

```json
{
  "tool_permissions": {
    "read_file": "allow",
    "write_file": "ask",
    "execute": "deny"
  }
}
```

**WebSocket events:** `created`, `patched`, `removed`

---

### Session MCP Servers

**Path:** `/session-mcp-servers`

Many-to-many join: which MCP servers are active for a session.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/session-mcp-servers` | List associations |
| `POST` | `/session-mcp-servers` | Add MCP server to session |
| `DELETE` | `/session-mcp-servers/:id` | Remove MCP server from session |

**WebSocket events:** `created`, `removed`

---

### Gateway

**Path:** `/gateway`

Routes messages between external messaging platforms (Slack, Discord, etc.) and Agor sessions.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/gateway` | Inbound: platform message → session |
| `PATCH` | `/gateway` | Routing update |

**Supported platforms:** Slack, Discord, WhatsApp, Telegram

---

### Gateway Channels

**Path:** `/gateway-channels`

Persistent messaging platform integration configurations.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/gateway-channels` | List channels |
| `GET` | `/gateway-channels/:id` | Get channel |
| `POST` | `/gateway-channels` | Create channel |
| `PATCH` | `/gateway-channels/:id` | Update channel |
| `DELETE` | `/gateway-channels/:id` | Delete channel |

**Channel types:** `slack`, `discord`, `whatsapp`, `telegram`

Each channel has:
- `target_worktree_id` — which worktree sessions are created in
- `agentic_config` — default agent settings for sessions spawned via this channel
- `channel_key` — platform-specific identifier (Slack channel ID, Discord channel ID, etc.)

---

### Thread Session Map

**Path:** `/thread-session-map`

1:1 mapping from platform thread → Agor session (for persistent conversations).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/thread-session-map` | List mappings |
| `POST` | `/thread-session-map` | Create mapping |

**Fields:** `channel_id`, `thread_id`, `session_id`, `status` (`active | archived | paused`)

---

### Terminals

**Path:** `/terminals`

Real-time terminal I/O via WebSocket. Supports PTY sessions in worktree environments.

---

### Config

**Path:** `/config`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/config` | Get daemon configuration |
| `POST` | `/config/resolve-api-key` | Resolve API key by identity |

Returns RBAC mode, feature flags, registered agent tools, daemon version.

---

### Context

**Path:** `/context`

Access context files from within a worktree.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/context` | List context files |
| `GET` | `/context/:path` | Get specific context file content |

---

### Files

**Path:** `/file`, `/files`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/file/:worktree/:path` | Retrieve file content |
| `POST` | `/sessions/:id/upload` | Upload file(s) to session |

---

### Leaderboard

**Path:** `/leaderboard`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/leaderboard` | Session/task statistics and rankings |

---

### Health

**Path:** `/health`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Daemon health check |

Returns `{ "status": "ok", "version": "..." }`

---

### OpenCode

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/opencode/health` | OpenCode provider health |
| `GET` | `/opencode/models` | List available OpenCode models |

---

## WebSocket Events

### Connecting

```js
import { io } from "socket.io-client"

const socket = io("http://localhost:3030", {
  auth: { strategy: "jwt", accessToken: "<token>" }
})
```

### Event Reference

#### Messages (real-time streaming)

```
streaming:start     { session_id, task_id }
streaming:chunk     { session_id, task_id, chunk: string }
streaming:end       { session_id, task_id, message: Message }
streaming:error     { session_id, task_id, error: string }
thinking:start      { session_id, task_id }
thinking:chunk      { session_id, task_id, chunk: string }
thinking:end        { session_id, task_id }
queued              { session_id, queue_position: number }
permission_resolved { session_id, task_id, request_id, status }
input_resolved      { session_id, task_id, request_id, answers }
```

#### Standard CRUD events (all services)

```
<service> created   { data: Entity }
<service> patched   { data: Entity }
<service> removed   { data: { id } }
```

Services broadcasting CRUD events: `sessions`, `tasks`, `messages`, `boards`, `board-objects`, `board-comments`, `worktrees`, `mcp-servers`, `session-mcp-servers`

---

## Data Models

### Session

```typescript
{
  session_id: SessionID           // UUIDv7
  status: SessionStatus
  agentic_tool: AgenticToolName
  worktree_id: WorktreeID         // required FK
  board_id?: BoardID
  name?: string
  created_at: string
  updated_at: string

  // Genealogy
  parent_session_id?: SessionID
  parent_fork_task_id?: TaskID
  parent_fork_message_index?: number
  children: SessionID[]
  spawn_config?: SpawnConfig

  // State
  git_state?: { branch, commit, diff_summary }
  model_config?: DefaultModelConfig
  permission_config?: PermissionConfig

  // Context window (from latest task)
  context_window_tokens?: number
  context_window_max?: number

  // Scheduler
  scheduled_run_metadata?: ScheduledRunMetadata

  // Runtime
  unix_username?: string          // immutable, set at creation
}
```

---

### Task

```typescript
{
  task_id: TaskID                 // UUIDv7
  session_id: SessionID
  status: TaskStatus
  created_at: string
  updated_at: string

  // Message range
  first_message_index?: number
  last_message_index?: number

  // Git snapshot
  git_state?: { branch, commit }

  // SDK response
  raw_sdk_response?: unknown
  normalized_sdk_response?: NormalizedSDKResponse

  // Token usage
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number

  // Context window
  context_window_tokens?: number
  context_window_max?: number
}
```

---

### Message

```typescript
{
  message_id: MessageID           // UUIDv7
  session_id: SessionID
  task_id?: TaskID
  index: number                   // ordering within session
  type: MessageType
  role: MessageRole
  content: string | ContentBlock[]
  created_at: string

  // Tool use
  tool_uses?: ToolUse[]
  parent_tool_use_id?: string

  // Queueing
  status?: "queued"
  queue_position?: number
}
```

**Message types:**

| Type | Description |
|------|-------------|
| `user` | Human input |
| `assistant` | Agent response |
| `system` | System context |
| `file-history-snapshot` | File tree state at task boundary |
| `permission_request` | Tool approval request — content is `PermissionRequestContent` |
| `input_request` | `AskUserQuestion` tool — content is `InputRequestContent` |

---

### Worktree

```typescript
{
  worktree_id: WorktreeID         // UUIDv7
  repo_id: RepoID
  name: string
  ref: string                     // git branch/tag/commit
  ref_type: "branch" | "tag" | "commit"
  path: string                    // absolute filesystem path
  board_id?: BoardID
  archived: boolean
  created_at: string

  // Work context
  issue_url?: string
  pr_url?: string
  notes?: string

  // Environment
  environment_instance?: EnvironmentInstance
  schedule_config?: ScheduleConfig

  // RBAC
  others_can: "none" | "view" | "prompt" | "all"
}
```

---

### Board

```typescript
{
  board_id: BoardID               // UUIDv7
  name: string
  slug: string
  description?: string
  created_at: string

  // Canvas data
  objects: BoardObject[]          // zones, text, markdown
  custom_context?: string         // Handlebars template for board-level context
}
```

---

### User

```typescript
{
  user_id: UserID                 // UUIDv7
  email: string
  role: UserRole
  created_at: string

  // Credentials (status only — never plaintext)
  has_api_key: boolean
  has_env_vars: boolean

  // Unix integration
  unix_username?: string          // immutable

  // Account state
  force_password_change: boolean
  last_login_at?: string

  // Preferences
  preferences?: UserPreferences
  default_agentic_config?: DefaultAgenticConfig
}
```

---

### MCP Server

```typescript
{
  mcp_server_id: MCPServerID      // UUIDv7
  name: string
  description?: string
  transport: "http" | "sse" | "stdio"
  scope: "global" | "session"

  // HTTP/SSE
  url?: string

  // stdio
  command?: string
  args?: string[]
  env?: Record<string, string>

  // Auth
  auth: MCPAuth

  // Permissions
  tool_permissions: Record<string, "ask" | "allow" | "deny">

  created_at: string
}
```

---

### Permission Request Content

Embedded in messages of type `permission_request`:

```typescript
{
  request_id: string
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
  status: "pending" | "approved" | "denied" | "timed_out"
  scope?: "once" | "project" | "user" | "local"
  approved_by?: UserID
  approved_at?: string
}
```

---

### Input Request Content

Embedded in messages of type `input_request`:

```typescript
{
  request_id: string
  questions: {
    id: string
    question: string
    type: "text" | "select" | "multi-select"
    options?: string[]
    annotations?: string[]
  }[]
  status: "pending" | "answered" | "timed_out"
  answers?: Record<string, string | string[]>
}
```

---

### Spawn Config

Used when creating a child session via `fork` or `spawn`:

```typescript
{
  prompt: string
  agent_override?: AgenticToolName
  permission_override?: PermissionMode
  model_override?: string
  mcp_servers?: MCPServerID[]
  callback_config?: {
    on_complete?: string   // webhook URL
    on_fail?: string
  }
}
```

---

## Enumerations

### SessionStatus

```
idle | running | stopping | awaiting_permission | awaiting_input | timed_out | completed | failed
```

### TaskStatus

```
created | running | stopping | awaiting_permission | awaiting_input | timed_out | completed | failed | stopped
```

### MessageType

```
user | assistant | system | file-history-snapshot | permission_request | input_request
```

### MessageRole

```
user | assistant | system
```

### AgenticToolName

```
claude-code | codex | gemini | opencode
```

### UserRole

```
owner | admin | member | viewer
```

### PermissionMode (Claude Code)

```
default | acceptEdits | bypassPermissions | plan | dontAsk
```

### PermissionMode (Gemini)

```
autoEdit | yolo
```

### PermissionMode (Codex)

```
ask | auto | on-failure | allow-all
```

### PermissionScope

```
once | project | user | local
```

### BoardObjectType

```
text | zone | markdown
```

### ChannelType (Gateway)

```
slack | discord | whatsapp | telegram
```

### ThreadStatus

```
active | archived | paused
```

### CodexSandboxMode

```
read-only | workspace-write | danger-full-access
```

---

## ID System

All IDs are **UUIDv7** (time-ordered) using branded TypeScript types.

| Type | Prefix | Example |
|------|--------|---------|
| `SessionID` | `ses_` | `ses_01j2...` |
| `TaskID` | `tsk_` | `tsk_01j2...` |
| `MessageID` | `msg_` | `msg_01j2...` |
| `BoardID` | `brd_` | `brd_01j2...` |
| `WorktreeID` | `wt_` | `wt_01j2...` |
| `RepoID` | `repo_` | `repo_01j2...` |
| `UserID` | `usr_` | `usr_01j2...` |
| `MCPServerID` | `mcp_` | `mcp_01j2...` |
| `CommentID` | `cmt_` | `cmt_01j2...` |

**Short IDs** — 8-16 char prefix strings for UI display (`ShortID` type)

---

## Error Handling

All errors follow the FeathersJS error format:

```json
{
  "name": "NotAuthenticated",
  "message": "Not authenticated",
  "code": 401,
  "className": "not-authenticated",
  "errors": {}
}
```

| Error Class | HTTP Code | When |
|-------------|-----------|------|
| `NotAuthenticated` | 401 | Missing/invalid JWT |
| `NotAuthorized` | 403 | Lacks role/permission |
| `Forbidden` | 403 | Operation not allowed |
| `BadRequest` | 400 | Invalid input |
| `NotFound` | 404 | Entity missing |
| `Conflict` | 409 | Unique constraint |
| `GeneralError` | 500 | Unexpected error |

---

## RBAC & Permissions

Controlled by `~/.agor/config.yaml`:

```yaml
execution:
  worktree_rbac: false          # Enable RBAC (default: false)
  unix_user_mode: simple        # simple | insulated | strict
```

### Modes

| Mode | RBAC | Unix Groups | Per-user Isolation |
|------|------|-------------|-------------------|
| Open (default) | No | No | No |
| RBAC Only | Yes | No | No |
| RBAC + Groups | Yes | Yes (`agor_wt_*`) | No |
| Full Isolation | Yes | Yes | Yes (per Unix user) |

### Worktree Permission Levels

| Level | Can do |
|-------|--------|
| `none` | No access |
| `view` | Read sessions and messages |
| `prompt` | Send prompts (create tasks) |
| `all` | Full control including settings |

Worktree owners always have implicit `all` permission.

### Unix Groups

- `agor_rp_<short-id>` — repo access group
- `agor_wt_<short-id>` — worktree access group

Executor process uses these groups for filesystem permission enforcement in `insulated` and `strict` modes.

---

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `POST /authentication` | 5 attempts per email/IP per 15 min |
| `POST /authentication/refresh` | 5 attempts per IP per 15 min |

Limits are in-memory and reset on daemon restart.

---

_For architecture context: see `context/concepts/architecture.md`_
_For data model details: see `context/concepts/models.md`_
_For WebSocket patterns: see `context/concepts/websockets.md`_
_For RBAC design: see `context/guides/rbac-and-unix-isolation.md`_
