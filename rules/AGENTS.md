# Command output (RTK)

Prefer `rtk`-prefixed commands when running supported shell tools (for example `rtk git status`, `rtk ls`, `rtk find`, `rtk rg`, `rtk pnpm test`, `rtk cargo test`, `rtk pytest`) so commands succeed on the first try without triggering a PreToolUse block-and-retry.

Command output here is condensed to save tokens, keeping every signal and
dropping costly noise. Treat it as the complete result: run commands
normally, and batch related commands into one call to avoid extra turns.
Truncated results state their recovery path in their own output. Re-run a
command as `rtk bypass <cmd>` only when its result is unusable: empty when
output was clearly expected, contradicting its exit code, or garbled.
