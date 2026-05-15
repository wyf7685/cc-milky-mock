---
name: milky-setup
description: 快速搭建模拟测试环境
arguments:
  - name: bot_uin
    description: 机器人 QQ 号（默认 10001）
    required: false
  - name: bot_name
    description: 机器人昵称（默认 TestBot）
    required: false
  - name: group_id
    description: 测试群号（默认 123456）
    required: false
  - name: group_name
    description: 测试群名（默认 测试群）
    required: false
  - name: user_id
    description: 测试用户 QQ 号（默认 20001）
    required: false
  - name: user_name
    description: 测试用户昵称（默认 测试用户）
    required: false
  - name: port
    description: HTTP 服务器端口（默认 3000）
    required: false
  - name: token
    description: Bearer access token（默认 milky-mock-token）
    required: false
---

调用 `init_test_env` 一次性搭建完整的模拟测试环境并启动服务器：

```
init_test_env(
  start_server=true,
  port={{port | default: 3000}},
  access_token={{token | default: milky-mock-token}},
  bot={uin: {{bot_uin | default: 10001}}, nickname: "{{bot_name | default: TestBot}}"},
  users=[{user_id: {{user_id | default: 20001}}, nickname: "{{user_name | default: 测试用户}}"}],
  groups=[{group_id: {{group_id | default: 123456}}, group_name: "{{group_name | default: 测试群}}", members: [{user_id: {{user_id | default: 20001}}, role: "owner"}]}],
  friends=[{{user_id | default: 20001}}]
)
```

完成后输出环境摘要。
