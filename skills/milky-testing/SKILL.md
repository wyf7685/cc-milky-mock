---
name: milky-testing
description: 当用户要测试 milky 客户端、模拟 QQ 消息、调试 nonebot 机器人、或进行 milky 协议相关测试时使用此技能
version: 0.3.0
---

# Milky 测试工作流

你正在帮助用户使用 milky-mock 模拟服务器进行 QQ 机器人客户端的本地调试。

## 核心概念

milky-mock 是一个 milky 协议的模拟实现，通过 MCP 工具控制。你可以：
- **定义环境**：通过 `init_test_env` 一次性创建用户、群组、好友关系
- **模拟消息/事件**：模拟其他用户发送消息、入群、戳一戳、表情回应等
- **检查结果**：通过 `get_activity` 查看状态、消息记录、事件日志、API 调用

## 可用工具（10 个）

### 服务器管理
- `stop_milky_server` — 停止服务器（自动清理临时资源）
- `get_milky_server_status` — 查看运行状态

### 环境管理
- `init_test_env(bot?, users?, groups?, friends?, start_server?, port?, access_token?)` — 批量初始化，幂等（跳过已存在实体）。可同时启动服务器（`start_server=true`）。

### 消息模拟
- `simulate_message(message_scene, peer_id, sender_id, segments)` — 模拟用户发消息
- `simulate_message_recall(message_scene, peer_id, message_seq, sender_id, operator_id?)` — 模拟撤回

### 事件模拟
- `simulate_friend_event(event_type, ...)` — 好友事件
  - `request`：好友请求（initiator_id, comment?, via?）
  - `nudge`：戳一戳（user_id, display_action?, display_suffix?）
  - `file_upload`：文件上传（user_id, file_name, file_size）
- `simulate_group_event(event_type, group_id, ...)` — 群事件
  - `join_request`：入群申请（initiator_id, comment?）
  - `invited_join_request`：邀请入群（initiator_id, target_user_id）
  - `invitation`：群邀请（initiator_id）
  - `member_increase`：成员增加（user_id, operator_id?, invitor_id?）
  - `member_decrease`：成员减少（user_id, operator_id?）
  - `name_change`：群名变更（new_group_name, operator_id）
  - `admin_change`：管理员变更（user_id, operator_id, is_set?）
  - `essence_message_change`：精华消息（message_seq, operator_id, is_set?）
  - `message_reaction`：表情回应（user_id, message_seq, face_id, reaction_type?, is_add?）
  - `mute`：禁言（user_id, operator_id, duration）
  - `whole_mute`：全员禁言（operator_id, is_mute?）
  - `nudge`：戳一戳（sender_id, receiver_id, display_action?, display_suffix?）
  - `file_upload`：文件上传（user_id, file_name, file_size）

### 检查工具
- `get_activity(type?, limit?, message_scene?, peer_id?)` — 统一查询接口
  - `type`：数组，可选 `state`、`messages`、`events`、`api_calls`，默认全部
  - `limit`：最大返回条数（默认 20）
  - `message_scene` / `peer_id`：过滤消息
- `get_image_data(resource_id)` — 获取图片文件路径（可用 Read 工具查看）

## 标准测试流程

### 1. 环境准备
```
init_test_env(
  start_server=true,
  bot={uin: 10001, nickname: "TestBot"},
  users=[{user_id: 20001, nickname: "测试用户"}],
  groups=[{group_id: 123456, group_name: "测试群", members: [{user_id: 20001, role: "owner"}]}],
  friends=[20001]
)
```

### 2. 模拟消息
```
simulate_message(
  message_scene="group",
  peer_id=123456,
  sender_id=20001,
  segments=[{"type": "text", "text": "你好"}]
)
```

带图片的消息（使用 file:// URI）：
```
simulate_message(
  message_scene="group",
  peer_id=123456,
  sender_id=20001,
  segments=[{"type": "text", "text": "看图"}, {"type": "image", "uri": "file:///path/to/image.png"}]
)
```

### 3. 检查结果
```
get_activity()                                # 全部：状态 + 消息 + 事件 + API 调用
get_activity(type=["events", "api_calls"])    # 仅事件和 API 调用
get_activity(type=["messages"], limit=5)      # 仅最近 5 条消息
```

**推荐检查顺序**：先看 `events`（入站事件），再看 `api_calls`（出站 API 调用），最后看 `messages`（发送的消息）。

### 4. 测试特定场景
```
simulate_group_event(event_type="member_increase", group_id=123456, user_id=30001)
simulate_group_event(event_type="message_reaction", group_id=123456, user_id=20001, message_seq=1, face_id="14")
simulate_friend_event(event_type="nudge", user_id=20001, display_action="拍了拍")
simulate_message_recall(message_scene="group", peer_id=123456, message_seq=1, sender_id=20001)
```

## 消息段格式

```json
[
  {"type": "text", "text": "你好"},
  {"type": "mention", "user_id": 20001},
  {"type": "face", "face_id": 14},
  {"type": "image", "uri": "file:///path/to/image.png"},
  {"type": "image", "uri": "base64://iVBOR..."}
]
```

图片支持 `file://`、`http://`、`base64://` 三种 URI 格式。

## 注意事项

- 服务器停止后所有模拟数据清空（内存存储），临时图片资源自动清理
- 同一端口不能重复启动，需先 stop 再 start（或直接 `init_test_env(start_server=true)` 自动重启）
- `init_test_env` 幂等，跳过已存在实体，可多次调用补充环境
- `get_activity` 的 `api_calls` 记录所有出站 API 调用（包括 reaction、nudge 等不产生消息的操作）
- 客户端通过 WebSocket 连接：`ws://localhost:{port}/event?access_token={token}`
- HTTP API 地址：`http://localhost:{port}/api/{endpoint}`
- 图片资源通过 `GET /resources/{resource_id}` 访问（无需鉴权）
