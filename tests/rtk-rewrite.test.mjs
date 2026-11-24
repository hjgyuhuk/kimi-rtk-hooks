import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  extractKimiShellCommand,
  decideKimiRtkAction,
} from '../hooks/rtk-rewrite.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_SCRIPT = path.resolve(REPO_ROOT, 'hooks/rtk-rewrite.mjs');

function invokeHookScript(stdinPayload, extraEnv = {}) {
  const input = typeof stdinPayload === 'string' ? stdinPayload : JSON.stringify(stdinPayload);
  return spawnSync(process.execPath, [HOOK_SCRIPT], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

test('extractKimiShellCommand extracts Bash and Shell commands and ignores other tools', () => {
  assert.equal(
    extractKimiShellCommand(JSON.stringify({ tool_name: 'Bash', tool_input: { command: '  git status  ' } })),
    'git status',
  );
  assert.equal(
    extractKimiShellCommand(JSON.stringify({ tool_name: 'Shell', tool_input: { command: 'ls -la' } })),
    'ls -la',
  );
  assert.equal(
    extractKimiShellCommand(JSON.stringify({ tool_name: 'ReadFile', tool_input: { command: 'git status' } })),
    null,
  );
  assert.equal(extractKimiShellCommand('not-json'), null);
  assert.equal(extractKimiShellCommand(''), null);
});

test('decideKimiRtkAction handles all four rtk rewrite exit codes', () => {
  assert.deepEqual(decideKimiRtkAction('echo hi', { status: 1, stdout: '' }), { action: 'allow' });
  assert.deepEqual(decideKimiRtkAction('rm -rf /', { status: 2, stdout: '' }), { action: 'allow' });
  assert.deepEqual(decideKimiRtkAction('curl foo', { status: 2, stdout: 'Blocked by policy' }), {
    action: 'block',
    reason: 'Blocked by policy',
  });
  assert.deepEqual(decideKimiRtkAction('rtk git status', { status: 3, stdout: 'rtk git status\n' }), {
    action: 'allow',
  });
  const blockDecision = decideKimiRtkAction('git status', { status: 3, stdout: 'rtk git status\n' });
  assert.equal(blockDecision.action, 'block');
  assert.match(blockDecision.reason, /rtk git status/);
  assert.deepEqual(decideKimiRtkAction('git status', { status: null, stdout: '' }), { action: 'allow' });
});

test('CLI hook blocks rewritable Bash command with exit code 2 and suggestion on stderr', () => {
  const result = invokeHookScript({
    hook_event_name: 'PreToolUse',
    session_id: 'session_test',
    cwd: process.cwd(),
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  });

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /rtk git status/);
});

test('CLI hook supports JSON permissionDecision deny mode via RTK_KIMI_OUTPUT=json', () => {
  const result = invokeHookScript(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    },
    { RTK_KIMI_OUTPUT: 'json' },
  );

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /rtk ls -la/);
});

test('CLI hook allows already-rewritten, rtk bypass, and non-rewritable commands', () => {
  for (const command of ['rtk git status', 'rtk bypass ls -la', 'echo hello']) {
    const result = invokeHookScript({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    });
    assert.equal(result.status, 0, `expected allow for: ${command}`);
    assert.equal(result.stderr, '');
  }
});

test('CLI hook fails open when disabled, malformed, or rtk binary is missing', () => {
  const disabled = invokeHookScript(
    { tool_name: 'Bash', tool_input: { command: 'git status' } },
    { RTK_HOOK_DISABLED: '1' },
  );
  assert.equal(disabled.status, 0);

  const malformed = invokeHookScript('{bad json');
  assert.equal(malformed.status, 0);

  const missingBin = invokeHookScript(
    { tool_name: 'Bash', tool_input: { command: 'git status' } },
    { RTK_BIN: 'nonexistent-rtk-binary-xyz' },
  );
  assert.equal(missingBin.status, 0);
});

test('kimi.plugin.json manifest is valid and points to existing files', () => {
  const manifestPath = path.resolve(REPO_ROOT, 'kimi.plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  assert.match(manifest.name, /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*(@[A-Za-z0-9_-]+)?$/);
  assert.ok(existsSync(path.resolve(REPO_ROOT, manifest.systemPromptPath)));
  assert.ok(Array.isArray(manifest.hooks) && manifest.hooks.length === 1);

  const allowedHookKeys = new Set(['event', 'matcher', 'command', 'timeout']);
  for (const hook of manifest.hooks) {
    for (const key of Object.keys(hook)) {
      assert.ok(allowedHookKeys.has(key), `unexpected hook key: ${key}`);
    }
    assert.equal(hook.event, 'PreToolUse');
    assert.ok(existsSync(path.resolve(REPO_ROOT, 'hooks/rtk-rewrite.mjs')));
  }
});
