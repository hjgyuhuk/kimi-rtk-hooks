#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SHELL_TOOL_PATTERN = /^(Bash|Shell)$/i;
const DEFAULT_REWRITE_TIMEOUT_MS = 5000;

export function extractKimiShellCommand(rawInput) {
  if (!rawInput || !rawInput.trim()) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (typeof payload.tool_name === 'string' && !SHELL_TOOL_PATTERN.test(payload.tool_name)) {
    return null;
  }

  const command = payload.tool_input?.command;
  if (typeof command !== 'string') {
    return null;
  }

  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function decideKimiRtkAction(originalCommand, rewriteResult) {
  const { status, stdout } = rewriteResult;
  const output = typeof stdout === 'string' ? stdout.trim() : '';

  if (status === 1) {
    return { action: 'allow' };
  }

  if (status === 2) {
    if (output.length > 0) {
      return { action: 'block', reason: output };
    }
    return { action: 'allow' };
  }

  if (status === 0 || status === 3) {
    if (output.length === 0 || output === originalCommand) {
      return { action: 'allow' };
    }
    return {
      action: 'block',
      reason: `Use RTK for token-optimized output. Re-run this command with:\n${output}`,
    };
  }

  return { action: 'allow' };
}

export function invokeRtkRewrite(command, rtkBin = process.env.RTK_BIN || 'rtk') {
  try {
    const stdout = execFileSync(rtkBin, ['rewrite', '--', command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: DEFAULT_REWRITE_TIMEOUT_MS,
    });
    return { status: 0, stdout };
  } catch (err) {
    if (err && typeof err.status === 'number') {
      return {
        status: err.status,
        stdout: typeof err.stdout === 'string' ? err.stdout : '',
      };
    }
    return { status: null, stdout: '' };
  }
}

export function emitKimiHookDecision(decision, outputMode = process.env.RTK_KIMI_OUTPUT || 'exit2') {
  if (decision.action !== 'block') {
    return 0;
  }

  if (outputMode === 'json') {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason,
        },
      })}\n`,
    );
    return 0;
  }

  process.stderr.write(`${decision.reason}\n`);
  return 2;
}

function readAllStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

async function runKimiRtkPreToolHook() {
  if (process.env.RTK_HOOK_DISABLED === '1') {
    process.exit(0);
  }

  const rawInput = await readAllStdin();
  const command = extractKimiShellCommand(rawInput);
  if (!command) {
    process.exit(0);
  }

  const rewriteResult = invokeRtkRewrite(command);
  const decision = decideKimiRtkAction(command, rewriteResult);
  const exitCode = emitKimiHookDecision(decision);
  process.exit(exitCode);
}

const isEntrypoint =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  runKimiRtkPreToolHook().catch(() => {
    // Fail-open per Kimi Code CLI hook contract
    process.exit(0);
  });
}
