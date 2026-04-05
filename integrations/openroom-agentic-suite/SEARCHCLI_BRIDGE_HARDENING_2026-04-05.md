# OpenRoom Bridge Hardening for SearchCli (2026-04-05)

## 背景
在 Router direct 模式下，`/api/openclaw-agent` 偶发出现“前端看起来没收到回复”的现象。
常见根因是 OpenClaw CLI 输出可能混入前缀日志，导致服务端按“纯 JSON”解析失败。

## 修复点
修改文件：
- `integrations/openroom-agentic-suite/files/apps/webuiapps/vite.config.ts`

变更内容：
1. 新增 `tryParseJsonFromMixedOutput(raw)`
- 先尝试整段 JSON
- 再尝试逐行从后向前解析
- 最后尝试从首个 `{` 到末尾 `}` 的子串解析

2. 强化 `extractPayloadText(payload)`
- 同时兼容 `result.payloads` 与 `payloads`
- 返回“最后一条非空文本”，避免取到中间步骤文本

3. 解析失败时返回更多上下文
- 错误响应增加 `stderr` 片段，便于定位 gateway/fallback 问题

## 结果
- OpenRoom 到 OpenClaw 的代理回包稳定性提高
- SearchCli 长耗时场景下不再轻易出现“无回包”假象
