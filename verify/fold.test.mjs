import assert from 'node:assert/strict'
import { modelRequestStatsProjection as unit, STATE_VERSION } from '../host.js'

const state0 = unit.init({}, 0)
const ev = (type, data, time = 1000) => ({ type, data, time, seq: 1 })

let s = state0

// 1. A completed message is one successful attempt.
s = unit.apply(s, ev('assistant/message', {}))
assert.equal(s.requests, 1)
assert.equal(s.completed, 1)
assert.equal(s.failed, 0)

// 2. An attempt whose stream finishes with an error carries its own reason.
s = unit.apply(s, ev('assistant/attempt', {
  turn: 1,
  step: 1,
  stream: [
    { type: 'text-chunks', time0: 1, index: 0, dt: [], texts: ['x'] },
    { type: 'chunk', time: 2, chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', status: 429, message: 'slow down' } } } },
  ],
}, 2000))
assert.equal(s.requests, 2)
assert.equal(s.failed, 1)
assert.deepEqual(s.reasons, [{ code: 'RATE_LIMIT', status: 429, count: 1 }])
assert.equal(s.pending, null)
assert.equal(s.lastFailure.code, 'RATE_LIMIT')
assert.equal(s.lastFailure.message, 'slow down')

// 3. An attempt without a finish chunk waits; the retry event supplies the reason.
s = unit.apply(s, ev('assistant/attempt', { turn: 1, step: 2, stream: [] }, 3000))
assert.deepEqual(s.pending, { turn: 1, step: 2 })
assert.equal(s.failed, 1)
s = unit.apply(s, ev('llm/retry', {
  retryId: 'r1', turn: 1, step: 2, provider: 'deepseek', mode: 'normal', policyKey: 'k',
  retry: 1, maxRetries: 5, delayMs: 500, failure: { code: 'TIMEOUT', message: 'idle' },
}, 3100))
assert.equal(s.retries, 1)
assert.deepEqual(s.pending, null)
assert.equal(s.failed, 2)
assert.deepEqual(s.reasons.map(r => [r.code, r.count]), [['RATE_LIMIT', 1], ['TIMEOUT', 1]])

// 4. A retry for a different step never claims the pending attempt.
s = unit.apply(s, ev('assistant/attempt', { turn: 1, step: 3, stream: [] }, 4000))
s = unit.apply(s, ev('llm/retry', { turn: 1, step: 9, failure: { code: 'SERVER' } }, 4100))
assert.deepEqual(s.pending, { turn: 1, step: 3 })
assert.equal(s.retries, 2)
assert.equal(s.failed, 2)

// 5. The turn ending attributes the remaining pending attempt.
s = unit.apply(s, ev('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'reset' } } }, 4200))
assert.deepEqual(s.pending, null)
assert.equal(s.reasons.find(r => r.code === 'TRANSPORT').count, 1)
assert.equal(s.failed, 3)

// 6. A cancelled message is an outcome, not a failure.
s = unit.apply(s, ev('assistant/message', { interrupted: true }, 4300))
assert.equal(s.cancelled, 1)
assert.equal(s.failed, 3)
assert.equal(s.requests, 5)
assert.equal(s.reasons.some(r => r.code === 'ABORTED'), false)

// 7. An aborted attempt also counts as cancelled, without a reason.
s = unit.apply(s, ev('assistant/attempt', {
  turn: 2, step: 1, stream: [{ type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED' } } } }],
}, 4400))
assert.equal(s.cancelled, 2)
assert.equal(s.failed, 3)

// 8. An attempt resolved by an aborted turn is a cancellation too.
s = unit.apply(s, ev('assistant/attempt', { turn: 2, step: 2, stream: [] }, 4500))
s = unit.apply(s, ev('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } }, 4600))
assert.equal(s.cancelled, 3)
assert.equal(s.failed, 3)
assert.deepEqual(s.pending, null)

// 9. An attempt with no recorded reason stays unattributed once the turn ends cleanly.
let unknown = unit.apply(state0, ev('assistant/attempt', { turn: 3, step: 1, stream: [] }, 5000))
unknown = unit.apply(unknown, ev('turn/end', { turn: 3, reason: { kind: 'completed' } }, 5100))
assert.equal(unknown.requests, 1)
assert.equal(unknown.failed, 0)
assert.equal(unknown.cancelled, 0)
assert.deepEqual(unknown.pending, null)
assert.deepEqual(unit.wire.view(unknown).reasons, [])
assert.equal(unit.wire.view(unknown).unattributed, 0)

// 10. Uninteresting events keep the same state reference.
const same = unit.apply(s, ev('user/message', {}))
assert.equal(same, s)

// 11. Persisted rows round-trip; malformed rows and views throw.
const checkpoint = JSON.parse(JSON.stringify(s))
assert.deepEqual(unit.stateSchema.parse(checkpoint), checkpoint)
const view = unit.wire.view(s)
assert.equal(view.version, STATE_VERSION)
assert.deepEqual(unit.wire.viewSchema.parse(view), view)
assert.throws(() => unit.stateSchema.parse({ ...checkpoint, requests: -1 }))
assert.throws(() => unit.stateSchema.parse({ ...checkpoint, pending: { turn: 'x', step: 1 } }))
assert.throws(() => unit.wire.viewSchema.parse({ ...view, reasons: [{ code: '', status: null, count: 1 }] }))
assert.throws(() => unit.wire.viewSchema.parse({ ...view, version: 1 }))

// 12. The view ranks reasons and its counters add up.
assert.equal(view.reasons[0].count >= view.reasons[view.reasons.length - 1].count, true)
assert.equal(view.unattributed, Math.max(0, view.failed - view.reasons.reduce((t, r) => t + r.count, 0)))
assert.equal(view.completed + view.failed + view.cancelled <= view.requests, true)

// 13. Whole-request wall time: step start → final settle, once per step.
let timing = state0
timing = unit.apply(timing, ev('step/start', { turn: 1, step: 1 }, 1000))
timing = unit.apply(timing, ev('assistant/message', { turn: 1, step: 1, usage: { outputTokens: 600 } }, 61000))
timing = unit.apply(timing, ev('step/end', { turn: 1, step: 1 }, 70000))
assert.equal(timing.tokens, 600)
assert.equal(timing.requestMs, 60000)
assert.equal(timing.openStep, null)
assert.equal(unit.wire.view(timing).tokens, 600)
assert.equal(unit.wire.view(timing).requestMs, 60000)

// 14. A retried attempt inside one step is charged once, over the full span.
let retried = unit.apply(state0, ev('step/start', { turn: 1, step: 1 }, 1000))
retried = unit.apply(retried, ev('assistant/attempt', { turn: 1, step: 1, stream: [] }, 9000))
retried = unit.apply(retried, ev('llm/retry', { turn: 1, step: 1, failure: { code: 'TIMEOUT' } }, 9500))
retried = unit.apply(retried, ev('assistant/attempt', { turn: 1, step: 1, stream: [] }, 20000))
retried = unit.apply(retried, ev('llm/retry', { turn: 1, step: 1, failure: { code: 'TIMEOUT' } }, 20500))
retried = unit.apply(retried, ev('assistant/message', { turn: 1, step: 1, usage: { outputTokens: 400 } }, 80000))
retried = unit.apply(retried, ev('step/end', { turn: 1, step: 1 }, 81000))
assert.equal(retried.failed, 2)
assert.equal(retried.requests, 3)
assert.equal(retried.tokens, 400)
assert.equal(retried.requestMs, 79000)
// Wall time includes the retry waits: the decode-only rate is far higher.
assert.equal(Math.round((retried.tokens / (retried.requestMs / 1000)) * 10) / 10, 5.1)

// 15. A cancelled step burns wall time but produces no tokens.
let cancelledStep = unit.apply(state0, ev('step/start', { turn: 1, step: 1 }, 1000))
cancelledStep = unit.apply(cancelledStep, ev('assistant/message', { turn: 1, step: 1, interrupted: true }, 21000))
cancelledStep = unit.apply(cancelledStep, ev('step/end', { turn: 1, step: 1 }, 22000))
assert.equal(cancelledStep.cancelled, 1)
assert.equal(cancelledStep.tokens, 0)
assert.equal(cancelledStep.requestMs, 20000)

// 16. A step without any model settle contributes no wall time.
let emptyStep = unit.apply(state0, ev('step/start', { turn: 1, step: 1 }, 1000))
emptyStep = unit.apply(emptyStep, ev('step/end', { turn: 1, step: 1 }, 5000))
assert.equal(emptyStep.requestMs, 0)

// 17. The open step survives a checkpoint round-trip and revalidates.
const openCheckpoint = JSON.parse(JSON.stringify(
  unit.apply(state0, ev('step/start', { turn: 4, step: 2 }, 1234)),
))
assert.deepEqual(unit.stateSchema.parse(openCheckpoint), openCheckpoint)
assert.throws(() => unit.stateSchema.parse({
  ...openCheckpoint,
  openStep: { turn: 4, step: 2, startTime: 'x', lastSettle: null },
}))

console.log('all assertions passed', JSON.stringify(view))
