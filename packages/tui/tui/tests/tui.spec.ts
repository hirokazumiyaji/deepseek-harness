/**
 * Interactive surface acceptance through the terminal double: the composer,
 * streamed output, real approval and question answerers, steering, and the
 * Ctrl+D exit path. Detailed behavior lives in app.spec.ts and components.spec.ts.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createAppBench, settle } from './app-bench.ts'

const benches: Awaited<ReturnType<typeof createAppBench>>[] = []

afterEach(async () => {
  for (const bench of benches.splice(0)) {
    bench.app.stop()
    await bench.dispose()
  }
})

/** Start one surface and register it for teardown. */
async function started(options: Parameters<typeof createAppBench>[0] = {}) {
  const bench = await createAppBench(options)
  benches.push(bench)
  bench.start()
  await settle()
  return bench
}

/** Type one line and submit it as two terminal reads. */
function typeLine(bench: { terminal: { send(data: string): void } }, text: string): void {
  bench.terminal.send(text)
  bench.terminal.send('\r')
}

describe('terminal surface', () => {
  it('starts with the product banner, composer, and status line', async () => {
    const bench = await started()
    const screen = bench.terminal.screenLines()
    expect(screen[0]).toContain('Harness')
    expect(screen.join('\n')).toContain('idle')
    expect(bench.terminal.started).toBe(true)
    expect(bench.terminal.title).toContain('new session')
  })

  it('submits a typed prompt as one follow-up message', async () => {
    const bench = await started()
    typeLine(bench, 'explain the repository')
    await settle()
    expect(bench.prompts).toHaveLength(1)
    expect(JSON.stringify(bench.prompts[0]?.content)).toContain('explain the repository')
    expect(bench.terminal.visible()).toContain('You')
    expect(bench.terminal.visible()).toContain('explain the repository')
  })

  it('renders streamed assistant text', async () => {
    const bench = await started()
    const attemptId = 'test-attempt' as never
    bench.emitStream({ type: 'start', attemptId, revision: 1, turn: 1, step: 1 })
    bench.emitStream({
      type: 'chunk', attemptId, revision: 2, index: 0, time: Date.now(),
      chunk: { type: 'text-delta', index: 0, text: 'streamed answer' },
    })
    await settle()
    expect(bench.terminal.visible()).toContain('streamed answer')
  })

  it('answers an approval request from the keyboard', async () => {
    const bench = await started({ mountApproval: true })
    bench.session.append('turn/start', { turn: 1 })
    const approval = bench.ctx.get('approval')
    if (approval === undefined) throw new Error('approval service missing')
    const outcome = approval.request({ agent: bench.agent, toolName: 'bash', reason: 'run the test command' })
    await settle()
    expect(bench.terminal.visible()).toContain('Approve bash?')
    bench.terminal.reset()
    bench.terminal.send('\r')
    await settle()
    await expect(outcome).resolves.toBe('allowed-once')
    expect(bench.terminal.visible()).not.toContain('Approve bash?')
  })

  it('rejects an approval with the second row', async () => {
    const bench = await started({ mountApproval: true })
    bench.session.append('turn/start', { turn: 1 })
    const approval = bench.ctx.get('approval')
    if (approval === undefined) throw new Error('approval service missing')
    const outcome = approval.request({ agent: bench.agent, toolName: 'bash' })
    await settle()
    bench.terminal.send('\u001B[B')
    bench.terminal.send('\r')
    await settle()
    await expect(outcome).resolves.toBe('rejected')
  })

  it('answers a model question with the selected option', async () => {
    const bench = await started({ mountQuestions: true })
    const questions = bench.ctx.get('userQuestions')
    if (questions === undefined) throw new Error('user-questions service missing')
    const answer = questions.ask({
      agent: bench.agent,
      questions: [{ id: 'pick', question: 'Which file?', options: [{ label: 'alpha.txt' }, { label: 'beta.txt' }] }],
    })
    await settle()
    expect(bench.terminal.visible()).toContain('Which file?')
    bench.terminal.send('\r')
    await settle()
    await expect(answer).resolves.toEqual({ answers: [{ id: 'pick', selected: ['alpha.txt'] }] })
  })

  it('steers instead of queueing while the agent runs', async () => {
    const bench = await started()
    bench.running = true
    typeLine(bench, 'change direction')
    await settle()
    expect(bench.prompts).toHaveLength(0)
    expect(bench.steered).toHaveLength(1)
    expect(bench.terminal.visible()).toContain('Steering')
  })

  it('flushes the session and requests exit on Ctrl+D', async () => {
    const bench = await started()
    bench.terminal.send('\u0004')
    await settle()
    expect(bench.flushed).toEqual([bench.session])
    expect(bench.exitCode).toBe(0)
    expect(bench.terminal.started).toBe(false)
  })
})
