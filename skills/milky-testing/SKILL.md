---
name: milky-testing
description: 当用户要测试 milky 客户端、模拟 QQ 消息、调试 nonebot 机器人、或进行 milky 协议相关测试时使用此技能
version: 0.1.0
---

# Milky 测试工作流

你正在帮助用户使用 milky-mcp 模拟服务器进行 QQ 机器人客户端的本地调试。

## 核心概念

milky-mcp 是一个 milky 协议的模拟实现，通过 MCP 工具控制。你可以：
- **定义环境**：创建用户、群组、好友关系
- **模拟事件**：模拟其他用户发送消息、入群、好友请求等
- **检查结果**：查看客户端发送的消息、环境状态、事件日志

## 标准测试流程

### 1. 环境准备
```
init_test_env(
  start_server=true,
  port=3000,
  access_token="milky-mock-token",
  bot={uin: 10001, nickname: "TestBot"},
  users=[{user_id: 20001, nickname: "测试用户"}],
  groups=[{group_id: 123456, group_name: "测试群", members: [{user_id: 20001, role: "owner"}]}],
  friends=[20001]
)
```

如需启动已有环境的服务器，调用 `get_milky_server_status` 检查状态，如未运行则 `start_milky_server(port=3000, access_token="milky-mock-token")`。

### 2. 模拟消息
```
simulate_message(
  message_scene="group",
  peer_id=123456,
  sender_id=20001,
  segments=[{"type": "text", "text": "你好"}]
)
```

### 3. 验证客户端行为
```
get_sent_messages(limit=10)        # 客户端发了什么
get_event_log(limit=20)            # 产生了哪些事件
get_state()                        # 当前环境全貌
```

### 4. 测试特定场景
- **成员管理**：simulate_group_member_increase / decrease
- **管理员变更**：simulate_group_admin_change
- **群名变更**：simulate_group_name_change
- **禁言**：simulate_group_mute / simulate_group_whole_mute
- **消息撤回**：simulate_message_recall
- **表情回应**：simulate_group_message_reaction
- **精华消息**：simulate_group_essence_message_change
- **好友请求**：simulate_friend_request
- **群通知**：simulate_group_join_request / simulate_group_invited_join_request / group_invitation
- **戳一戳**：simulate_friend_nudge / simulate_group_nudge
- **文件上传**：simulate_friend_file_upload / simulate_group_file_upload

## 消息段格式

发送消息时使用 OutgoingSegment 格式：
```json
[
  {"type": "text", "text": "你好"},
  {"type": "mention", "user_id": 20001},
  {"type": "face", "face_id": 14}
]
```

## 注意事项

- 服务器停止后所有模拟数据清空（内存存储）
- 同一端口不能重复启动，需先 stop 再 start
- 客户端通过 WebSocket 连接：`ws://localhost:{port}/event?access_token={token}`
- HTTP API 地址：`http://localhost:{port}/api/{endpoint}`
