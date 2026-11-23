/**
 * Keyless recorded-session snapshot for the shipped `tui` profile. The suite
 * starts the product through the `dsh` CLI under a PTY, replays one recorded
 * model answer with `llm-replay`, sends the startup prompt and Ctrl+D, then
 * compares the normalized persisted Session and its model-visible sidecars
 * with the committed fixtures. The fixture is authored: refresh replays the
 * committed script and rewrites the normalized session and sidecars, while
 * record is rejected because there is no live provider for this scenario.
 */

import { spawnSync } from 'node:child_process'
import { globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertSessionFixtureVersion,
  formatSystemPromptSnapshot,
  formatToolSchemasSnapshot,
  normalizeSessionSnapshots,
  normalizedSystemPrompts,
  normalizedToolSchemas,
  redactSessionSnapshotIds,
  scrubSystemPrompts,
  scrubToolSchemas,
  sessionFixtureName,
  sessionFixtureNames,
  sessionHeaderVersion,
} from '@deepseek-ai/dsh-session-snapshot'

type SnapshotMode = 'replay' | 'record' | 'refresh'

/** Parse the snapshot mode; unknown values fail instead of becoming a replay. */
function snapshotMode(value: string | undefined): SnapshotMode {
  switch (value) {
    case undefined:
    case '':
    case 'replay': return 'replay'
    case 'record': return 'record'
    case 'refresh': return 'refresh'
    default: throw new Error(`unknown DSH_SNAPSHOT mode: ${value}`)
  }
}

const mode = snapshotMode(process.env.DSH_SNAPSHOT)
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const scenarioDir = fileURLToPath(new URL('./composed-boot', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/src/bin.ts')
const provider = 'tui-snapshot'
const tsxLoader = import.meta.resolve('tsx/esm')

// A POSIX PTY is required: the terminal surface refuses pipes. Windows skips;
// macOS and Linux must fail loudly when the required driver is unavailable.
const ptyProbe = process.platform === 'win32'
  ? undefined
  : spawnSync('python3', ['-c', 'import pty; pty.fork()'], { encoding: 'utf8', timeout: 10_000 })

/** Restore the format version onto a normalized (versionless) comparison log. */
function withVersion(normalized: string, version: number): string {
  const [first, ...rest] = normalized.split('\n')
  if (first === undefined) throw new Error('normalized session log is empty')
  const header = JSON.parse(first) as Record<string, unknown>
  return [JSON.stringify({ type: header.type, version, ...header }), ...rest].join('\n')
}

/** Remove the format version from a committed fixture for comparison. */
function withoutVersion(committed: string): string {
  const [first, ...rest] = committed.split('\n')
  if (first === undefined) throw new Error('committed session fixture is empty')
  const header = JSON.parse(first) as Record<string, unknown>
  delete header.version
  return [JSON.stringify(header), ...rest].join('\n')
}

/** Drive one command under a PTY with a small action script. */
function runPty(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  actions: readonly { waitFor: string; occurrence?: number; send?: string }[],
  cwd = repoRoot,
): { status: number | null; output: string; stderr: string } {
  const driver = String.raw`
import errno, json, os, pty, select, sys, time
node, args_json, env_json, cwd, actions_json, timeout_seconds = sys.argv[1:]
env = os.environ.copy()
env.update(json.loads(env_json))
actions = json.loads(actions_json)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, *json.loads(args_json)], env)
output = bytearray()
action_index = 0
deadline = time.monotonic() + float(timeout_seconds)
status = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)
    while action_index < len(actions):
        action = actions[action_index]
        if "waitFor" in action and output.count(action["waitFor"].encode()) < action.get("occurrence", 1):
            break
        if "send" in action:
            os.write(fd, action["send"].encode())
        action_index += 1
    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate
        break
if status is None:
    os.kill(pid, 9)
    _, status = os.waitpid(pid, 0)
    sys.exit(124)
sys.stdout.write(output.decode(errors="replace"))
sys.exit(os.waitstatus_to_exitcode(status))
`
  const result = spawnSync('python3', [
    '-c', driver, process.execPath, JSON.stringify(args), JSON.stringify(env), cwd,
    JSON.stringify(actions), '90',
  ], { encoding: 'utf8', timeout: 120_000 })
  return { status: result.status, output: result.stdout, stderr: result.stderr }
}

/** Compose the scenario overlay for this mode into the temporary home. */
function writePatch(home: string): string {
  const persistence = [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    "    compression: 'none'",
  ]
  const deterministic = [
    '- id: session-title-llm',
    '  disabled: true',
  ]
  // The committed fixture records workspace-write; pin that default so the
  // shipped Auto default does not rewrite the replayed session's permission
  // rows. The shipped default is covered by the bundle-composition spec.
  const permission = [
    '- id: permission',
    '  config:',
    '    defaultPreset: workspace-write',
    '    presets:',
    '      read-only:',
    '        sandbox: read-only',
    '        approval: ask',
    '      workspace-write:',
    '        sandbox: workspace-write',
    '        approval: ask',
    '      danger-full-access:',
    '        sandbox: danger-full-access',
    '        approval: never',
  ]
  const model = [
    '- id: agent-default-model',
    '  config:',
    `    provider: '${provider}'`,
    `    model: '${provider}'`,
  ]
  const providerRows = [
    '- insert:',
    '    - id: llm-replay',
    "      name: '@deepseek-ai/dsh-llm-replay'",
    '      config:',
    '        providers:',
    `          - id: '${provider}'`,
    '            name: TUI Snapshot',
    '            models:',
    `              - id: '${provider}'`,
  ]
  const path = join(home, 'scenario.patch.yml')
  writeFileSync(path, [...persistence, ...deterministic, ...permission, ...model, ...providerRows, ''].join('\n'))
  return path
}

/** The selected committed generation, highest first. */
function committedFixture(): string {
  const name = sessionFixtureNames(readdirSync(scenarioDir))[0]
  if (name === undefined) throw new Error('snapshots/tui/composed-boot: no committed Session fixture')
  return name
}

/** The recorded user task and model answer, so replay follows the committed log. */
function recordedTurn(name: string): { prompt: string; answer: string } {
  const records = readFileSync(join(scenarioDir, name), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as { type?: string; data?: { content?: unknown; message?: { content?: unknown } } })
  const textOf = (content: unknown): string | undefined => Array.isArray(content)
    ? content.flatMap(part => typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? [part.text] : []).join('')
    : undefined
  const prompt = records.find(record => record.type === 'user/message' && textOf(record.data?.content) !== undefined)
  const answer = records.find(record => record.type === 'assistant/message' && textOf(record.data?.message?.content) !== undefined)
  const promptText = prompt === undefined ? undefined : textOf(prompt.data?.content)
  const answerText = answer === undefined ? undefined : textOf(answer.data?.message?.content)
  if (promptText === undefined || answerText === undefined || promptText === '' || answerText === '') {
    throw new Error('tui snapshot fixture must contain one user message and one assistant message')
  }
  return { prompt: promptText, answer: answerText }
}

/** Run one composed scenario through the CLI and return the persisted log. */
function boot(): { log: string; output: string } {
  if (ptyProbe === undefined || ptyProbe.status !== 0) {
    throw new Error('snapshots/tui: python3 with pty.fork() is required on macOS and Linux')
  }
  const home = mkdtempSync(join(tmpdir(), 'dsh-tui-snapshot-'))
  try {
    const workspace = join(home, 'workspace')
    mkdirSync(workspace)
    const { prompt, answer } = recordedTurn(committedFixture())
    const marker = answer
    const result = runPty(
      ['--import', tsxLoader, dshBin, 'tui', '--patch', writePatch(home), prompt],
      {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
        DSH_SNAPSHOT_FILE: join(scenarioDir, committedFixture()),
        TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json'),
      },
      [{ waitFor: marker }, { send: '\u0004' }],
      workspace,
    )
    expect(result.stderr).toBe('')
    expect(result.status, result.output.slice(-4_000)).toBe(0)
    expect(result.output).toContain(marker)
    const files = globSync('sessions/**/session*.jsonl', { cwd: home })
    expect(files).toHaveLength(1)
    return { log: readFileSync(join(home, files[0] as string), 'utf8'), output: result.output }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('tui recorded-session snapshot', () => {
  it('replays the composed profile session and its model-visible sidecars', () => {
    if (mode === 'record') throw new Error('snapshots/tui: authored fixture; use DSH_SNAPSHOT=refresh to regenerate outputs')
    const { log } = boot()
    const header = JSON.parse(log.split('\n')[0] as string) as { id: string; cwd: string }
    const ctx = { sessionIds: [header.id], cwd: header.cwd }
    const version = sessionHeaderVersion(log, 'tui composed boot')
    const fixtureName = sessionFixtureName(0, version)
    if (mode === 'replay' && fixtureName !== committedFixture()) {
      throw new Error(`snapshots/tui: the writer now produces ${fixtureName}; run DSH_SNAPSHOT=refresh to add it`)
    }
    const normalized = normalizeSessionSnapshots([log], ctx, { identityMode: 'preserve' })[0] as string
    const prompts = normalizedSystemPrompts(log, ctx)
    const schemas = normalizedToolSchemas(log, ctx)
    const systemPrompt = formatSystemPromptSnapshot(prompts[0] ?? '', prompts.slice(1))
    const toolSchemas = formatToolSchemasSnapshot(schemas[0] ?? [], schemas.slice(1))

    // The corpus fixed-point and ownership rules hold before anything is written.
    expect(redactSessionSnapshotIds([normalized])).toEqual([normalized])
    expect(scrubSystemPrompts(normalized)).toBe(normalized)
    expect(scrubToolSchemas(normalized)).toBe(normalized)
    expect(systemPrompt).toContain('You are a coding agent')

    const committed = withVersion(normalized, version)
    assertSessionFixtureVersion(fixtureName, committed)
    if (mode === 'refresh') {
      writeFileSync(join(scenarioDir, fixtureName), committed)
      writeFileSync(join(scenarioDir, 'system-prompt.expected.md'), systemPrompt)
      writeFileSync(join(scenarioDir, 'tool-schemas.expected.json'), toolSchemas)
    }
    expect(normalized).toBe(withoutVersion(readFileSync(join(scenarioDir, fixtureName), 'utf8')))
    expect(systemPrompt).toBe(readFileSync(join(scenarioDir, 'system-prompt.expected.md'), 'utf8'))
    expect(toolSchemas).toBe(readFileSync(join(scenarioDir, 'tool-schemas.expected.json'), 'utf8'))
  }, 180_000)
})
