/**
 * Host half of the model-request-stats bundle.
 *
 * Registers the `modelRequestStats` session projection unit: a pure fold over
 * the durable session log that counts model request attempts, their outcomes,
 * and the failure reasons it can attribute. Delivery to the browser rides the
 * session-projection seam (`wire.view`), so the client renders whole-session
 * figures that survive reloads, resume, paging, and compaction.
 *
 * Counted events (one model request attempt each):
 * - `assistant/message`            — an attempt that committed a message;
 *                                    `interrupted: true` marks a cancelled one.
 * - `assistant/attempt`            — an attempt that committed no message
 *                                    (failed, retried, cancelled, stream error).
 *
 * Outcomes are exclusive: `completed`, `failed`, or `cancelled`. A user
 * cancellation is not a failure, and the failure rate excludes it.
 *
 * The same fold also produces a whole-request throughput that the built-in
 * decode-only tok/s leaves out:
 * - `step/start` → the step's last model settle (`assistant/message` or
 *   `assistant/attempt`) spans connection, queueing, retry backoff, and
 *   failed or cancelled attempts inside that step; `step/end` accumulates the
 *   span once per step.
 * - `assistant/message.usage.outputTokens` sums the provider-reported output
 *   tokens.
 * `tokens / requestMs` is therefore the honest session speed: it pays for
 * everything the model request actually cost, not just the post-first-token
 * decode window.
 *
 * Failure reasons come from the log only, in attribution order:
 * 1. The attempt's embedded stream finish chunk, when it carries an error.
 * 2. The following `llm/retry` event, when the attempt is retried.
 * 3. The closing `turn/end` error reason, when the attempt ends the turn.
 * A failure whose reason never lands in the log stays in the `unattributed`
 * bucket instead of being guessed.
 */

/** Cordis plugin name. */
export const name = 'model-request-stats'

/** The projection registry is the whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/** Projection key served to clients through `wire`. */
export const STATS_KEY = 'modelRequestStats'

/** Persisted-cache invalidation version; bump when state fields or folds change. */
export const STATE_VERSION = 3

/** Reason code used when an attempt carries no usable failure identity. */
const UNKNOWN = 'UNKNOWN'

/** Longest failure code kept (opaque provider identifiers stay bounded). */
const MAX_CODE = 80

/** Longest failure message kept for the "latest failure" reading. */
const MAX_MESSAGE = 500

/**
 * Coerce one recorded failure into the bounded shape the state keeps.
 * @param failure - provider failure identity from a log event.
 * @returns the normalized failure.
 */
function normalizeFailure(failure) {
  if (failure === null || typeof failure !== 'object') {
    return { code: UNKNOWN, status: null, message: '' }
  }
  const rawCode = typeof failure.code === 'string' ? failure.code.trim() : ''
  const code = rawCode === '' ? UNKNOWN : rawCode.slice(0, MAX_CODE)
  const status = typeof failure.status === 'number' && Number.isFinite(failure.status)
    ? Math.trunc(failure.status)
    : null
  const message = typeof failure.message === 'string' ? failure.message.slice(0, MAX_MESSAGE) : ''
  return { code, status, message }
}

/**
 * Read how an attempt's embedded stream ended.
 * @param stream - the attempt event's `AssistantStreamRecord[]`.
 * @returns `{ kind: 'error', failure }` for an error finish,
 * `{ kind: 'aborted' }` for a cancellation, or null when the stream carries no
 * terminating failure (a thrown stream error, or malformed data).
 */
function streamTermination(stream) {
  if (!Array.isArray(stream)) return null
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record === null || typeof record !== 'object' || record.type !== 'chunk') continue
    const chunk = record.chunk
    if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'finish') continue
    const reason = chunk.reason
    // The last finish chunk decides: a clean finish is not a failure.
    if (reason === null || typeof reason !== 'object') return null
    if (reason.kind === 'error') return { kind: 'error', failure: normalizeFailure(reason.failure) }
    if (reason.kind === 'aborted') return { kind: 'aborted' }
    return null
  }
  return null
}

/**
 * The empty fold state.
 * @returns a fresh state with every counter at zero.
 */
function initialState() {
  return {
    /** Model request attempts observed in the log. */
    requests: 0,
    /** Attempts that committed a non-interrupted message. */
    completed: 0,
    /** Attempts that ended in an error. */
    failed: 0,
    /** Attempts the user or the turn cancelled; not failures. */
    cancelled: 0,
    /** Scheduled retries recorded by the retry executor. */
    retries: 0,
    /** Attributed failure reasons, one entry per (code, status) pair. */
    reasons: [],
    /** The last failed attempt still waiting for its reason, or null. */
    pending: null,
    /** Most recent attributed failure. */
    lastFailure: null,
    /** Provider output tokens over completed messages. */
    tokens: 0,
    /** Summed model wall time over settled steps, in milliseconds. */
    requestMs: 0,
    /** The open step's model timeline, or null outside a step. */
    openStep: null,
  }
}

/**
 * Provider-reported output tokens of one assistant message.
 * @param data - the `assistant/message` payload.
 * @returns the output-token count, or 0 when unreported or invalid.
 */
function outputTokens(data) {
  if (data === null || typeof data !== 'object') return 0
  const usage = data.usage
  if (usage === null || typeof usage !== 'object') return 0
  const value = usage.outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Mark the open step's last model settle time.
 * @param openStep - the open step, or null.
 * @param data - the settle event payload carrying turn and step.
 * @param time - the settle event time.
 * @returns the updated open step (same reference when it does not apply).
 */
function settleStep(openStep, data, time) {
  if (openStep === null || data === null || typeof data !== 'object') return openStep
  if (openStep.turn !== data.turn || openStep.step !== data.step) return openStep
  return { ...openStep, lastSettle: time }
}

/**
 * Record one attributed failure's reason and latest-failure reading.
 * @param state - state after the failure was counted.
 * @param failure - normalized failure identity.
 * @param time - event time in milliseconds.
 * @returns the next state (a new reference).
 */
function attribute(state, failure, time) {
  let matched = false
  const reasons = state.reasons.map((entry) => {
    if (entry.code !== failure.code || entry.status !== failure.status) return entry
    matched = true
    return { code: entry.code, status: entry.status, count: entry.count + 1 }
  })
  if (!matched) reasons.push({ code: failure.code, status: failure.status, count: 1 })
  return {
    ...state,
    reasons,
    lastFailure: {
      code: failure.code,
      status: failure.status,
      message: failure.message,
      time: typeof time === 'number' && Number.isFinite(time) ? time : 0,
    },
  }
}

/**
 * Whether a pending attempt sits on the same turn and step as a retry record.
 * @param pending - pending attempt coordinates.
 * @param data - the retry event payload.
 * @returns true when the record belongs to the pending attempt.
 */
function sameStep(pending, data) {
  return pending !== null && pending.turn === data.turn && pending.step === data.step
}

/**
 * Fold one committed session event into the statistics state.
 * Uninteresting events return the same reference, so the projection drive
 * publishes nothing for them.
 * @param state - state covering all prior events.
 * @param event - the next committed session event.
 * @returns the next state.
 */
function fold(state, event) {
  switch (event.type) {
    case 'step/start': {
      const data = event.data
      if (data === null || typeof data !== 'object') return state
      // A fresh step supersedes any open step left by a crash-interrupted turn.
      return {
        ...state,
        openStep: { turn: data.turn, step: data.step, startTime: event.time, lastSettle: null },
      }
    }
    case 'step/end': {
      const data = event.data
      const openStep = state.openStep
      if (openStep === null || data === null || typeof data !== 'object') return state
      if (openStep.turn !== data.turn || openStep.step !== data.step) return state
      return {
        ...state,
        // One wall time per step: start to its last settle, so retries and
        // backoff waits inside the step are included exactly once.
        requestMs: openStep.lastSettle === null
          ? state.requestMs
          : state.requestMs + Math.max(0, openStep.lastSettle - openStep.startTime),
        openStep: null,
      }
    }
    case 'assistant/message': {
      const data = event.data
      const interrupted = data !== null && typeof data === 'object' && data.interrupted === true
      return {
        ...state,
        requests: state.requests + 1,
        completed: interrupted ? state.completed : state.completed + 1,
        cancelled: interrupted ? state.cancelled + 1 : state.cancelled,
        pending: null,
        tokens: state.tokens + outputTokens(data),
        openStep: settleStep(state.openStep, data, event.time),
      }
    }
    case 'assistant/attempt': {
      const data = event.data
      const hasData = data !== null && typeof data === 'object'
      const turn = hasData ? data.turn : undefined
      const step = hasData ? data.step : undefined
      const counted = {
        ...state,
        requests: state.requests + 1,
        openStep: settleStep(state.openStep, data, event.time),
      }
      const termination = hasData ? streamTermination(data.stream) : null
      if (termination?.kind === 'error') {
        return attribute({ ...counted, failed: counted.failed + 1, pending: null }, termination.failure, event.time)
      }
      if (termination?.kind === 'aborted') {
        return { ...counted, cancelled: counted.cancelled + 1, pending: null }
      }
      // No reason in the attempt itself: the retry or turn ending supplies it.
      return {
        ...counted,
        pending: typeof turn === 'number' && typeof step === 'number' ? { turn, step } : null,
      }
    }
    case 'llm/retry': {
      const data = event.data
      const counted = { ...state, retries: state.retries + 1 }
      if (data === null || typeof data !== 'object' || !sameStep(state.pending, data)) return counted
      return attribute({ ...counted, failed: counted.failed + 1, pending: null }, normalizeFailure(data.failure), event.time)
    }
    case 'turn/end': {
      const data = event.data
      if (state.pending === null || data === null || typeof data !== 'object') return state
      const reason = data.reason
      if (reason === null || typeof reason !== 'object') return { ...state, pending: null }
      if (reason.kind === 'error') {
        return attribute({ ...state, failed: state.failed + 1, pending: null }, normalizeFailure(reason.error), event.time)
      }
      if (reason.kind === 'aborted') {
        return { ...state, cancelled: state.cancelled + 1, pending: null }
      }
      return { ...state, pending: null }
    }
    default:
      return state
  }
}

/** Thrown when a persisted row or a produced view does not match the declared shape. */
function invalid(where, value) {
  throw new TypeError(`${STATS_KEY}: ${where} has an unexpected shape: ${JSON.stringify(value)?.slice(0, 200)}`)
}

/**
 * Validate one non-negative integer field.
 * @param record - containing object.
 * @param key - field name.
 * @param where - validation label for the error.
 */
function countField(record, key, where) {
  const value = record[key]
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${where}.${key}`, value)
  return value
}

/**
 * Validate one reason entry.
 * @param entry - candidate reason.
 * @param where - validation label for the error.
 * @returns a plain copy of the entry.
 */
function reasonField(entry, where) {
  if (entry === null || typeof entry !== 'object') invalid(where, entry)
  if (typeof entry.code !== 'string' || entry.code === '') invalid(`${where}.code`, entry.code)
  if (entry.status !== null && !Number.isSafeInteger(entry.status)) {
    invalid(`${where}.status`, entry.status)
  }
  if (!Number.isSafeInteger(entry.count) || entry.count < 1) invalid(`${where}.count`, entry.count)
  return { code: entry.code, status: entry.status, count: entry.count }
}

/**
 * Validate the persisted fold state before it seeds a restore.
 * @param value - candidate state from a checkpoint row.
 * @returns the validated state.
 */
function validateState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('state', value)
  const state = {
    requests: countField(value, 'requests', 'state'),
    completed: countField(value, 'completed', 'state'),
    failed: countField(value, 'failed', 'state'),
    cancelled: countField(value, 'cancelled', 'state'),
    retries: countField(value, 'retries', 'state'),
    tokens: countField(value, 'tokens', 'state'),
    requestMs: countField(value, 'requestMs', 'state'),
    reasons: [],
    pending: null,
    openStep: null,
    lastFailure: null,
  }
  if (!Array.isArray(value.reasons)) invalid('state.reasons', value.reasons)
  for (const entry of value.reasons) state.reasons.push(reasonField(entry, 'state.reasons[]'))
  if (value.pending !== null) {
    const pending = value.pending
    if (pending === null || typeof pending !== 'object'
      || !Number.isSafeInteger(pending.turn) || !Number.isSafeInteger(pending.step)) {
      invalid('state.pending', pending)
    }
    state.pending = { turn: pending.turn, step: pending.step }
  }
  if (value.openStep !== null) {
    const openStep = value.openStep
    if (openStep === null || typeof openStep !== 'object'
      || !Number.isSafeInteger(openStep.turn) || !Number.isSafeInteger(openStep.step)
      || typeof openStep.startTime !== 'number' || !Number.isFinite(openStep.startTime)) {
      invalid('state.openStep', openStep)
    }
    if (openStep.lastSettle !== null
      && (typeof openStep.lastSettle !== 'number' || !Number.isFinite(openStep.lastSettle))) {
      invalid('state.openStep.lastSettle', openStep.lastSettle)
    }
    state.openStep = {
      turn: openStep.turn,
      step: openStep.step,
      startTime: openStep.startTime,
      lastSettle: openStep.lastSettle,
    }
  }
  if (value.lastFailure !== null) {
    const last = value.lastFailure
    if (last === null || typeof last !== 'object') invalid('state.lastFailure', last)
    if (typeof last.message !== 'string' || typeof last.time !== 'number' || !Number.isFinite(last.time)) {
      invalid('state.lastFailure', last)
    }
    const failure = reasonField({ code: last.code, status: last.status, count: 1 }, 'state.lastFailure')
    state.lastFailure = { code: failure.code, status: failure.status, message: last.message, time: last.time }
  }
  return state
}

/**
 * Validate the client-visible view.
 * @param value - candidate view.
 * @returns the validated view.
 */
function validateView(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('view', value)
  if (value.version !== STATE_VERSION) invalid('view.version', value.version)
  const view = {
    version: STATE_VERSION,
    requests: countField(value, 'requests', 'view'),
    completed: countField(value, 'completed', 'view'),
    failed: countField(value, 'failed', 'view'),
    cancelled: countField(value, 'cancelled', 'view'),
    retries: countField(value, 'retries', 'view'),
    tokens: countField(value, 'tokens', 'view'),
    requestMs: countField(value, 'requestMs', 'view'),
    unattributed: countField(value, 'unattributed', 'view'),
    reasons: [],
    lastFailure: null,
  }
  if (!Array.isArray(value.reasons)) invalid('view.reasons', value.reasons)
  for (const entry of value.reasons) view.reasons.push(reasonField(entry, 'view.reasons[]'))
  if (value.lastFailure !== null) {
    const last = value.lastFailure
    if (last === null || typeof last !== 'object') invalid('view.lastFailure', last)
    if (typeof last.message !== 'string' || typeof last.time !== 'number' || !Number.isFinite(last.time)) {
      invalid('view.lastFailure', last)
    }
    const failure = reasonField({ code: last.code, status: last.status, count: 1 }, 'view.lastFailure')
    view.lastFailure = { code: failure.code, status: failure.status, message: last.message, time: last.time }
  }
  return view
}

/** Persisted-state schema (the registry only reads `parse`). */
const stateSchema = { parse: validateState }

/**
 * State → wire payload. Reasons are ordered by count so the client renders the
 * ranked breakdown without folding the log itself.
 * @param state - current fold state.
 * @returns the whole client-visible value.
 */
function viewOf(state) {
  const reasons = state.reasons
    .map(entry => ({ code: entry.code, status: entry.status, count: entry.count }))
    .sort((left, right) => right.count - left.count
      || left.code.localeCompare(right.code)
      || String(left.status ?? '').localeCompare(String(right.status ?? '')))
  const attributed = reasons.reduce((total, entry) => total + entry.count, 0)
  return {
    version: STATE_VERSION,
    requests: state.requests,
    completed: state.completed,
    failed: state.failed,
    cancelled: state.cancelled,
    retries: state.retries,
    tokens: state.tokens,
    requestMs: state.requestMs,
    reasons,
    unattributed: Math.max(0, state.failed - attributed),
    lastFailure: state.lastFailure === null
      ? null
      : {
        code: state.lastFailure.code,
        status: state.lastFailure.status,
        message: state.lastFailure.message,
        time: state.lastFailure.time,
      },
  }
}

/** Wire payload schema (the registry only reads `parse`). */
const viewSchema = { parse: validateView }

/**
 * The `modelRequestStats` projection unit.
 *
 * `summary: false` keeps the figures out of Session summary payloads: no
 * session-list row renders them, and the client reads them for the open
 * Session through `useProjection`.
 */
export const modelRequestStatsProjection = {
  key: STATS_KEY,
  stateVersion: STATE_VERSION,
  stateSchema,
  init: initialState,
  apply: fold,
  wire: {
    viewSchema,
    view: viewOf,
    summary: false,
  },
}

/**
 * Register the projection unit; the registration is an effect on this
 * plugin's fiber, so unloading the bundle removes the key.
 * @param ctx - registrant context carrying the projection registry.
 * @returns when the unit is registered.
 */
export async function apply(ctx) {
  await ctx.sessionProjections.register(modelRequestStatsProjection)
}
