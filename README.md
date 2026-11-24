# Kimi Code CLI RTK Hooks

参考 Antigravity CLI 的 RTK 插件，为 [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html) 实现的 `PreToolUse` Hook 与配套规则。

## 与 Antigravity CLI 的关键差异

- **Antigravity CLI**：`PreToolUse` 支持透明修改工具参数（类似 `updatedInput`），因此可以直接调用 `rtk hook antigravity` 无感改写命令。
- **Kimi Code CLI**：`PreToolUse` 仅支持 **放行（exit 0）** 或 **阻断（exit 2 / `permissionDecision: "deny"`）**，不支持直接修改 `tool_input`。

因此本方案采用 **「规则优先 + Hook 兜底改写建议」**：
1. 在系统/项目规则中引入 `rules/AGENTS.md`，让模型主动使用 `rtk` 前缀执行命令，减少额外往返。
2. 当模型直接调用原始命令（如 `git status`）时，`hooks/rtk-rewrite.mjs` 调用 `rtk rewrite -- <command>`：
   - 存在 RTK 改写结果且与原命令不同 → 返回退出码 `2` 并在 `stderr` 给出改写后的命令，由 Kimi Code CLI 反馈给模型重新执行。
   - 已是 `rtk ...`、`rtk bypass ...` 或无 RTK 对应改写 → 返回退出码 `0` 放行。
   - 命中 `rtk` 策略拒绝（exit 2 且带输出） → 透传拒绝原因并阻断。
   - 异常或未安装 `rtk` → 遵循 Kimi Code CLI 约定 fail-open（exit 0）。

## 安装与配置

前置条件：本机已安装 `rtk` 与 `node`。

### 方式一：作为 Kimi Code 插件安装（推荐）

本目录已包含标准插件清单 [kimi.plugin.json](kimi.plugin.json)，同时声明了 `systemPromptPath`（自动注入 `rules/AGENTS.md`）与 `hooks`（`PreToolUse`）：

1. 在 Kimi Code CLI 中打开插件管理（`/plugins`），选择安装自定义插件并填入本地路径：
   ```text
   /home/das/code/kimi-rtk-hooks
   ```
2. 启用 `rtk` 插件并重载/开启新会话即可生效。

### 方式二：手动配置 `~/.kimi-code/config.toml`

1. 将 `config.example.toml` 中的 `[[hooks]]` 合并到 `~/.kimi-code/config.toml`（注意将路径改为本仓库实际路径）：

```toml
[[hooks]]
event = "PreToolUse"
matcher = "^(Bash|Shell)$"
command = "node /home/das/code/kimi-rtk-hooks/hooks/rtk-rewrite.mjs"
timeout = 10
```

> Kimi Code CLI 的 `[[hooks]]` 仅允许 `event`、`matcher`、`command`、`timeout` 四个字段，多写会导致配置加载失败。

2. （推荐）将 `rules/AGENTS.md` 的内容加入到你的 Kimi Code 指令文件中，让模型默认直接调用 `rtk` 命令。

3. 重启 Kimi Code CLI 会话使配置生效。

## 环境变量

- `RTK_HOOK_DISABLED=1`：临时禁用本 Hook（直接放行）。
- `RTK_KIMI_OUTPUT=json`：改用 stdout JSON (`hookSpecificOutput.permissionDecision = "deny"`) 形式阻断，默认使用 `stderr` + 退出码 `2`。
- `RTK_BIN`：自定义 `rtk` 可执行文件路径（默认 `rtk`）。

## 运行测试

```bash
node --test tests/rtk-rewrite.test.mjs
```
