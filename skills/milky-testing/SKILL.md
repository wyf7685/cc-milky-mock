---
name: milky-testing
description: 当用户要测试 milky 客户端、模拟 QQ 消息、调试 nonebot 机器人、或进行 milky 协议相关测试时使用此技能
version: 0.4.0
---

# Milky 测试工作流

使用 milky-mock MCP 控制本地 QQ 模拟环境。目标是用一次模拟调用和一次等待调用完成一个测试回合，禁止高频轮询完整历史。

## 活动模型

`get_activity` 返回统一、按 `cursor` 排序的活动流：

| type | 含义 |
|---|---|
| `event` | mock 向被测 Bot 推送的入站事件，包括 `message_receive` |
| `message` | 被测 Bot 通过 Milky API 发送的出站消息 |
| `api_call` | 被测 Bot 调用的全部 Milky API，包括不产生消息的操作 |
| `connection` | SSE / WebSocket 连接和断开 |

每条活动都包含 `cursor`、`type`、`time` 和原始 `data`；可解析时还包含：

- `message_scene`
- `peer_id`
- `sender_id`
- `event_type`
- `api`
- `plain_text`

查询结果包含：

- `next_cursor`：下一次增量查询使用的游标
- `current_cursor`：当前全局最新游标
- `oldest_cursor`：仍被保留的最早游标
- `truncated`：请求游标是否早于保留窗口
- `timed_out`：等待是否超时

## 可用工具（10 个）

### 服务器与环境

- `init_test_env(bot?, users?, groups?, friends?, start_server?, port?, access_token?)`
- `get_milky_server_status()`
- `stop_milky_server()`

`init_test_env` 跳过已存在的用户、群和成员，可重复补充环境；结果包含 `activity_cursor`。

### 模拟消息与事件

- `simulate_message(message_scene, peer_id, sender_id, segments)`
- `simulate_message_recall(message_scene, peer_id, message_seq, sender_id, operator_id?)`
- `simulate_friend_event(event_type, ...)`
- `simulate_group_event(event_type, group_id, ...)`

所有成功的 `simulate_*` 结果都包含 `activity_cursor`。该游标指向刚产生的入站活动，用它等待 Bot 后续行为。

### 观察与资源

- `get_activity(after_cursor?, type?, limit?, wait_timeout_ms?, message_scene?, peer_id?, sender_id?, event_type?, api?, text_contains?, include_state?)`
- `clear_activity()`
- `get_image_data(resource_id)`

`clear_activity` 只清除活动历史，保留实体、服务器和现有连接；游标不会回退。

## 标准流程

### 1. 初始化并启动服务器

```text
init_test_env(
  start_server=true,
  bot={uin: 10001, nickname: "TestBot"},
  users=[{user_id: 20001, nickname: "测试用户"}],
  groups=[{
    group_id: 123456,
    group_name: "测试群",
    members: [{user_id: 20001, role: "owner"}]
  }],
  friends=[20001]
)
```

### 2. 等待 Bot 连接

先读取状态；已经连接则不要再等待：

```text
get_milky_server_status()
```

若 `connections=0`，使用状态结果的 `activity_cursor` 等待新连接：

```text
get_activity(
  after_cursor=<status.activity_cursor>,
  type=["connection"],
  wait_timeout_ms=30000
)
```

确认返回活动的 `data.action="connected"`。

### 3. 一个消息回合：两次调用

发送模拟消息：

```text
simulate_message(
  message_scene="group",
  peer_id=123456,
  sender_id=20001,
  segments=[{"type":"text","text":"你好"}]
)
```

记下返回的 `activity_cursor=C`，直接等待 Bot 出站消息：

```text
get_activity(
  after_cursor=C,
  type=["message"],
  message_scene="group",
  peer_id=123456,
  wait_timeout_ms=10000
)
```

不需要在 `simulate_message` 和结果之间反复调用无游标的 `get_activity`。

### 4. 检查无回复场景

```text
get_activity(
  after_cursor=C,
  type=["message"],
  message_scene="group",
  peer_id=123456,
  wait_timeout_ms=2000
)
```

`timed_out=true` 且 `activities=[]` 表示等待窗口内没有回复。需要确认 Bot 是否处理过事件时，再从同一游标查询 `api_call`，不要重新拉取全部历史。

### 5. 检查非消息操作

例如表情回应、戳一戳、撤回等可能不产生 `message`，按 API 名称等待：

```text
get_activity(
  after_cursor=C,
  type=["api_call"],
  api="send_group_message_reaction",
  peer_id=123456,
  wait_timeout_ms=10000
)
```

### 6. 连续多轮

每次把上次结果的 `next_cursor` 作为下一次查询的 `after_cursor`。多个独立场景共用同一环境时，可在场景间调用：

```text
clear_activity()
```

不要为了清活动调用 `stop_milky_server`；stop 会清空整个模拟环境并断开 Bot。

## 即时查询语义

- 不传 `after_cursor` 且 `wait_timeout_ms=0`：返回最近匹配活动。
- 传 `after_cursor`：从该游标之后增量读取。
- `wait_timeout_ms>0`：没有匹配结果时等待新活动。
- 等待时不传 `after_cursor`：只等待调用之后产生的新活动，不匹配旧历史。
- `include_state=true`：活动结果中附带环境摘要；默认关闭以减少输出。
- `limit` 最大 200；默认 20。

## 消息段

调用 `simulate_message` 时使用 OutgoingSegment 平铺格式：

```json
[
  {"type":"text","text":"你好"},
  {"type":"mention","user_id":20001},
  {"type":"face","face_id":14},
  {"type":"image","uri":"file:///path/to/image.png"},
  {"type":"image","uri":"base64://iVBOR..."}
]
```

mock 推送给 Bot 的入站事件使用 IncomingSegment：

```json
{"type":"text","data":{"text":"你好"}}
```

合并转发：

```json
{
  "type":"forward",
  "forward_id":"forward-case-1",
  "messages":[{
    "user_id":20001,
    "sender_name":"测试用户",
    "segments":[{"type":"text","text":"转发内容"}]
  }]
}
```

`forward_id` 可省略。图片 URI 支持 `file://`、`http://`、`https://` 和 `base64://`。

## 场景示例

```text
simulate_group_event(event_type="member_increase", group_id=123456, user_id=30001)
simulate_group_event(event_type="message_reaction", group_id=123456, user_id=20001, message_seq=1, face_id="14")
simulate_friend_event(event_type="nudge", user_id=20001, display_action="拍了拍")
simulate_message_recall(message_scene="group", peer_id=123456, message_seq=1, sender_id=20001)
```

## 注意事项

- 客户端 WebSocket：`ws://localhost:{port}/event?access_token={token}`
- HTTP API：`http://localhost:{port}/api/{endpoint}`
- 图片资源：`GET /resources/{resource_id}`
- 服务器停止后内存状态和临时资源全部清空。
- `event` 是入站，`message` 是 Bot 出站；不要从 `message` 中寻找模拟用户刚发送的消息。
- `plain_text` 是辅助检索字段，断言完整消息结构时仍检查 `data.segments`。
