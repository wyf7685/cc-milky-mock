---
name: milky-start
description: 启动 milky 模拟服务器
arguments:
  - name: port
    description: HTTP 监听端口（默认 3000）
    required: false
  - name: token
    description: Bearer access token（默认 milky-mock-token）
    required: false
---

调用 `start_milky_server` MCP 工具启动 milky HTTP + WebSocket 服务器。

参数：
- port: {{port | default: 3000}}
- access_token: {{token | default: milky-mock-token}}

启动后输出连接信息，包括 WebSocket 地址供客户端使用。
