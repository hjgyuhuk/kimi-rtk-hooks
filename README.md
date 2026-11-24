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

本仓库包含标准插件清单 [kimi.plugin.json](kimi.plugin.json)，启用后会自动注入 `rules/AGENTS.md`（`systemPromptPath`）并注册 `PreToolUse` Hook。

1. 在 Kimi Code CLI 中执行 `/plugins`，选择**安装自定义插件**，填入 GitHub 仓库地址：
   ```text
   https://github.com/hjgyuhuk/kimi-rtk-hooks
   ```
   （如果你已 clone 到本地，也可以直接填本地目录路径。）
2. 启用 `rtk` 插件，并执行 `/plugins reload` 或开启新会话即可生效。

### 方式二：手动配置 `~/.kimi-code/config.toml`

1. 克隆本仓库到本地：
   ```bash
   git clone https://github.com/hjgyuhuk/kimi-rtk-hooks.git
   ```

2. 将 `config.example.toml` 中的 `[[hooks]]` 合并到 `~/.kimi-code/config.toml`（将路径替换为实际克隆路径）：

```toml
[[hooks]]
event = "PreToolUse"
matcher = "^(Bash|Shell)$"
command = "node /path/to/kimi-rtk-hooks/hooks/rtk-rewrite.mjs"
timeout = 10
```

> Kimi Code CLI 的 `[[hooks]]` 仅允许 `event`、`matcher`、`command`、`timeout` 四个字段，多写会导致配置加载失败。

3. （推荐）将 `rules/AGENTS.md` 的内容加入到你的 Kimi Code 指令文件中，让模型默认直接调用 `rtk` 命令。

4. 重启 Kimi Code CLI 会话使配置生效。

## 验证插件是否生效

1. 在 Kimi Code CLI 中输入普通命令需求（如 `查看当前目录文件列表`），模型应优先直接执行 `rtk ls`。
2. 输入 `不要加 rtk 前缀，直接用 Bash 执行 ls -la`，首次裸命令会被 Hook 阻断并提示改用 `rtk ls -la`，随后模型自动重跑成功。
3. 当 RTK 压缩结果确实不可用时，使用 `rtk bypass <cmd>` 会被 Hook 直接放行。

## 环境变量

- `RTK_HOOK_DISABLED=1`：临时禁用本 Hook（直接放行）。
- `RTK_KIMI_OUTPUT=json`：改用 stdout JSON (`hookSpecificOutput.permissionDecision = "deny"`) 形式阻断，默认使用 `stderr` + 退出码 `2`。
- `RTK_BIN`：自定义 `rtk` 可执行文件路径（默认 `rtk`）。

## 运行测试

```bash
node --test tests/rtk-rewrite.test.mjs
```
