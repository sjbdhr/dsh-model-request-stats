/**
 * Browser half of the model-request-stats bundle.
 *
 * Renders one ambient reading in the composer dock — model request attempts,
 * failed attempts, and the whole-request speed for the open Session — and a
 * click-open panel with the success, failure, cancellation, failure-rate,
 * model-time, token, speed, and retry counts plus a ranked breakdown of the
 * failure reasons.
 *
 * Every figure comes from the Host `modelRequestStats` projection (see
 * `host.js`): the browser folds no session events, so paging, compaction,
 * reloads, and resume cannot change the numbers.
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-request-stats',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this bundle. */
    const NS = 'model-request-stats'
    /** Projection key registered by the Host half. */
    const KEY = 'modelRequestStats'
    /** Dock entry id (also the `data-` marker the pill carries). */
    const ENTRY_ID = 'model-request-stats'

    /** English dictionary; the locale chain falls back to it. */
    const en = {
      'pill.requests': 'Requests {count}',
      'pill.failed': 'Failed {count}',
      'pill.rate': 'Overall {value}',
      'pill.aria': 'Model requests: {requests}. Failures: {failed}. Show statistics',
      'pill.title': 'Model requests: {requests} · Failed: {failed}',
      'pill.title.rate': 'Model requests: {requests} · Failed: {failed} · Overall {value}',
      'panel.title': 'Model request statistics',
      'panel.requests': '{count} attempts',
      'row.requests': 'Attempts',
      'row.completed': 'Completed',
      'row.failed': 'Failed',
      'row.cancelled': 'Cancelled',
      'row.rate': 'Failure rate',
      'row.speed': 'Overall speed',
      'row.elapsed': 'Model time',
      'row.tokens': 'Output tokens',
      'row.retries': 'Retries',
      'reasons.title': 'Failure reasons',
      'reasons.empty': 'No failed model requests in this session yet.',
      'reasons.unattributed': 'Reason not recorded',
      'last.title': 'Latest failure',
      'last.empty': 'No failure details available.',
      'note.speed': 'Overall speed divides all output tokens by each request\'s full wall time — connection, queueing, retry backoff, and failed attempts included. The built-in tok/s counts only decoding after the first token.',
      'duration.seconds': '{seconds}s',
      'duration.minutes': '{minutes}m {seconds}s',
    }

    /** Simplified Chinese dictionary. */
    const zh = {
      'pill.requests': '访问 {count}',
      'pill.failed': '失败 {count}',
      'pill.rate': '整体 {value}',
      'pill.aria': '模型访问 {requests} 次，失败 {failed} 次，查看统计',
      'pill.title': '模型访问 {requests} 次 · 失败 {failed} 次',
      'pill.title.rate': '模型访问 {requests} 次 · 失败 {failed} 次 · 整体 {value}',
      'panel.title': '模型访问统计',
      'panel.requests': '{count} 次访问',
      'row.requests': '访问次数',
      'row.completed': '成功',
      'row.failed': '失败',
      'row.cancelled': '已取消',
      'row.rate': '失败率',
      'row.speed': '整体速度',
      'row.elapsed': '模型耗时',
      'row.tokens': '输出 tokens',
      'row.retries': '重试',
      'reasons.title': '失败原因',
      'reasons.empty': '本会话还没有失败的模型请求。',
      'reasons.unattributed': '未记录原因',
      'last.title': '最近一次失败',
      'last.empty': '暂无失败详情。',
      'note.speed': '整体速度按每次请求从发起到结束的完整耗时计算，包含连接、排队、重试等待与失败尝试；原生 tok/s 只统计首个 token 之后的解码时间。',
      'duration.seconds': '{seconds} 秒',
      'duration.minutes': '{minutes} 分 {seconds} 秒',
    }

    /** Docked-composer reading, panel, and bar styles; class prefix `dsh-mrs-`. */
    const CSS = `
.dsh-mrs-anchor{display:inline-flex;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));}
.dsh-mrs-pill{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;max-width:100%;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer;}
.dsh-mrs-pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}
@media (hover:hover){.dsh-mrs-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}}
.dsh-mrs-pill svg{width:14px;height:14px;flex:none;}
.dsh-mrs-pill-label{min-width:0;overflow:hidden;text-overflow:ellipsis;}
.dsh-mrs-sep{margin:0 6px;color:var(--dsw-alias-separator-primary);}
.dsh-mrs-failed{color:var(--dsw-alias-state-warn-primary);}
.dsh-mrs-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(288px,calc(100vw - 24px));max-width:min(420px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow-x:hidden;overflow-y:auto;padding:16px;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:default;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);}
.dsh-mrs-head{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500;}
.dsh-mrs-head-title{display:inline-flex;align-items:center;gap:6px;min-width:0;}
.dsh-mrs-head-title svg{width:14px;height:14px;flex:none;}
.dsh-mrs-head-value{font-variant-numeric:tabular-nums;}
.dsh-mrs-rule{margin-bottom:10px;border-top:.5px solid var(--dsw-alias-border-l2);}
.dsh-mrs-rows{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary);}
.dsh-mrs-rows dt,.dsh-mrs-rows dd{min-width:0;margin:0;}
.dsh-mrs-rows dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;}
.dsh-mrs-section{margin:14px 0 8px;color:var(--dsw-alias-label-primary);font-weight:500;}
.dsh-mrs-reason+.dsh-mrs-reason{margin-top:8px;}
.dsh-mrs-reason-head{display:flex;justify-content:space-between;gap:12px;}
.dsh-mrs-reason-label{min-width:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}
.dsh-mrs-reason-count{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);}
.dsh-mrs-bar{margin-top:4px;height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}
.dsh-mrs-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-error-primary);}
.dsh-mrs-bar-fill[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary);}
.dsh-mrs-empty{margin:0;color:var(--dsw-alias-label-tertiary);}
.dsh-mrs-last{margin-top:14px;}
.dsh-mrs-last-text{margin:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;}
.dsh-mrs-note{margin:14px 0 0;color:var(--dsw-alias-label-tertiary);}
.dsh-mrs-panel:focus{outline:none;}
`

    /**
     * Install the stylesheet for this client run.
     * @returns the cleanup that removes the element.
     */
    function insertStyles() {
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = `${NS}/panel.css`
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /** The reading glyph: three ranked bars. Inherits `currentColor`. */
    function StatsGlyph() {
      return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': true, focusable: 'false' },
        h('rect', { x: 2, y: 9, width: 3, height: 5, rx: 1, fill: 'currentColor', opacity: 0.55 }),
        h('rect', { x: 6.5, y: 6, width: 3, height: 8, rx: 1, fill: 'currentColor', opacity: 0.75 }),
        h('rect', { x: 11, y: 2.5, width: 3, height: 11.5, rx: 1, fill: 'currentColor' }),
      )
    }

    /**
     * Whether a projection value carries the fields this panel reads.
     * @param value - `useProjection` value for this key.
     * @returns true for a usable statistics value.
     */
    function usable(value) {
      return value !== undefined && value !== null
        && typeof value.requests === 'number' && value.requests > 0
        && Array.isArray(value.reasons)
    }

    /**
     * Normalize a statistics value across Host generations. An older Host
     * counted cancellations as failures and reported them as `ABORTED`
     * reasons without a `cancelled` field; the panel always separates them,
     * so a page refresh never shows cancellations as failures.
     * @param value - projection value.
     * @returns the same reading with cancellations split out.
     */
    function normalizeStats(value) {
      if (typeof value.cancelled === 'number') return value
      const aborted = value.reasons.filter(entry => entry.code === 'ABORTED')
      const cancelled = aborted.reduce((total, entry) => total + entry.count, 0)
      return {
        requests: value.requests,
        completed: value.completed,
        failed: Math.max(0, value.failed - cancelled),
        cancelled,
        retries: value.retries,
        tokens: value.tokens,
        requestMs: value.requestMs,
        reasons: value.reasons.filter(entry => entry.code !== 'ABORTED'),
        unattributed: value.unattributed,
        lastFailure: value.lastFailure !== null && value.lastFailure.code === 'ABORTED'
          ? null
          : value.lastFailure,
      }
    }

    /** Locale-aware integer formatter for every count in this view. */
    const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

    /** Client locale service, captured so failure times follow the UI language. */
    let localeService

    /**
     * Format a count for display.
     * @param value - count.
     * @returns grouped number text with at most one decimal.
     */
    function formatCount(value) {
      return formatter.format(value)
    }

    /**
     * Percentage of settled requests that failed; cancellations are excluded.
     * @param failed - failed attempts.
     * @param settled - completed plus failed attempts.
     * @returns localized-reading percentage, or an em dash when nothing settled.
     */
    function formatRate(failed, settled) {
      if (!(settled > 0)) return '—'
      const percent = (failed / settled) * 100
      const rounded = percent >= 99.95 ? 100 : Math.round(percent * 10) / 10
      return `${formatCount(rounded)}%`
    }

    /**
     * Compact duration in the active locale.
     * @param ms - duration in milliseconds.
     * @param t - bound translate function.
     * @returns display text.
     */
    function formatDuration(ms, t) {
      const seconds = ms / 1_000
      if (seconds < 60) return t('duration.seconds', { seconds: formatCount(Math.round(seconds * 10) / 10) })
      const whole = Math.round(seconds)
      return t('duration.minutes', {
        minutes: Math.floor(whole / 60),
        seconds: whole % 60,
      })
    }

    /**
     * Whole-request throughput: all output tokens over all model wall time,
     * including connection, queueing, retry backoff, and failed attempts.
     * @param value - normalized statistics value.
     * @returns the speed reading text, or null while no tokens are recorded.
     */
    function formatSpeed(value) {
      if (typeof value.tokens !== 'number' || typeof value.requestMs !== 'number') return null
      if (value.tokens <= 0 || value.requestMs <= 0) return null
      return `${formatCount(value.tokens / (value.requestMs / 1_000))} tok/s`
    }

    /**
     * Clock time of one failure in the active UI locale, with a date when the
     * failure did not happen today.
     * @param time - event time in milliseconds.
     * @returns a short local time reading.
     */
    function formatTime(time) {
      if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return ''
      const date = new Date(time)
      const now = new Date()
      const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate()
      const options = { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      if (!sameDay) {
        options.month = '2-digit'
        options.day = '2-digit'
      }
      let active
      try {
        active = localeService?.getSnapshot?.().active
      } catch {
        active = undefined
      }
      try {
        return date.toLocaleString(active ?? undefined, options)
      } catch {
        return ''
      }
    }

    /**
     * Reason label: provider code plus an HTTP status when recorded.
     * @param code - failure code.
     * @param status - optional HTTP status.
     * @returns the display label.
     */
    function reasonLabel(code, status) {
      const text = typeof code === 'string' && code !== '' ? code : 'UNKNOWN'
      return typeof status === 'number' ? `${text} · HTTP ${status}` : text
    }

    /**
     * Place the portaled panel above or below its pill, clamped to the
     * viewport and to the frame's top overlay inset.
     * @param anchor - the pill's root element.
     * @param panel - the portaled panel element.
     */
    function placePanel(anchor, panel) {
      const rect = anchor.getBoundingClientRect()
      const edge = 12
      const gap = 8
      let topInset = edge
      try {
        const parsed = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-overlay-top'),
        )
        if (Number.isFinite(parsed) && parsed > edge) topInset = parsed
      } catch {
        topInset = edge
      }
      // A panel that grew past the usable viewport scrolls instead of clipping.
      const available = Math.max(80, window.innerHeight - topInset - edge)
      if (panel.scrollHeight > available) panel.style.maxHeight = `${Math.round(available)}px`
      else panel.style.maxHeight = ''
      const width = panel.offsetWidth
      const height = panel.offsetHeight
      const roomAbove = rect.top - topInset - gap
      const roomBelow = window.innerHeight - rect.bottom - edge - gap
      let top = roomAbove >= height || roomAbove >= roomBelow ? rect.top - height - gap : rect.bottom + gap
      if (top < topInset) top = topInset
      if (top + height > window.innerHeight - edge) {
        top = Math.max(topInset, window.innerHeight - edge - height)
      }
      const maxLeft = Math.max(edge, window.innerWidth - edge - width)
      const left = Math.min(Math.max(edge, rect.left), maxLeft)
      panel.style.left = `${Math.round(left)}px`
      panel.style.top = `${Math.round(top)}px`
    }

    /**
     * Last-resort translate used only when the slot seat is missing: returns
     * the dictionary key instead of throwing inside the slot.
     * @param key - message key.
     * @returns the key itself.
     */
    function identityTranslate(key) {
      return key
    }

    /** One grid row of the summary block (a keyed fragment of `dt` + `dd`). */
    function summaryRow(key, label, value) {
      return h(React.Fragment, { key }, h('dt', null, label), h('dd', null, value))
    }

    /** One ranked failure-reason row with its proportional bar. */
    function reasonRow(key, label, count, total, tone) {
      const share = total > 0 ? Math.min(100, Math.max(2, (count / total) * 100)) : 0
      return h('div', { className: 'dsh-mrs-reason', key },
        h('div', { className: 'dsh-mrs-reason-head' },
          h('span', { className: 'dsh-mrs-reason-label', title: label }, label),
          h('span', { className: 'dsh-mrs-reason-count' }, formatCount(count)),
        ),
        h('div', { className: 'dsh-mrs-bar', 'aria-hidden': true },
          h('div', { className: 'dsh-mrs-bar-fill', 'data-tone': tone, style: { width: `${share}%` } }),
        ),
      )
    }

    /**
     * The dock reading plus its click-open statistics panel.
     * @param props - standard slot props: the bound locale seat and the
     * per-session projection reader.
     * @returns the pill, or null before this Session has any model request.
     */
    function RequestStatsPill(props) {
      const t = typeof props.t === 'function' ? props.t : identityTranslate
      const stats = props.useProjection(KEY)
      const [open, setOpen] = React.useState(false)
      const panelId = React.useId()
      const rootRef = React.useRef(null)
      const buttonRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const available = usable(stats)

      React.useEffect(() => {
        if (!available) setOpen(false)
      }, [available])

      React.useEffect(() => {
        if (!open) return undefined
        const close = () => { setOpen(false) }
        const onPointerDown = (event) => {
          const target = event.target
          if (rootRef.current !== null && rootRef.current.contains(target)) return
          if (panelRef.current !== null && panelRef.current.contains(target)) return
          close()
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          close()
          const button = buttonRef.current
          if (button !== null && typeof button.focus === 'function') button.focus({ preventScroll: true })
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])

      // Move focus into the opened panel so a keyboard user can scroll a long
      // reason list and a screen reader announces the statistics.
      React.useEffect(() => {
        if (!open) return
        const panel = panelRef.current
        if (panel !== null) panel.focus({ preventScroll: true })
      }, [open])

      React.useLayoutEffect(() => {
        if (!open) return undefined
        const place = () => {
          const anchor = rootRef.current
          const panel = panelRef.current
          if (anchor === null || panel === null) return
          placePanel(anchor, panel)
        }
        place()
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
        // Re-measure when fresh statistics change the panel's height.
      }, [open, stats])

      if (!available) return null

      const view = normalizeStats(stats)
      const failed = view.failed
      const requests = view.requests
      const cancelled = view.cancelled
      const settled = view.completed + failed
      const speed = formatSpeed(view)
      const aria = t('pill.aria', { requests: formatCount(requests), failed: formatCount(failed) })

      // Zero failures is still an answer: the segment stays visible so the
      // reading doubles as the entry point to the breakdown. The speed segment
      // is the whole-request rate the built-in tok/s understates.
      const headline = h('span', { className: 'dsh-mrs-pill-label' },
        h('span', null, t('pill.requests', { count: formatCount(requests) })),
        h('span', { key: 'sep', className: 'dsh-mrs-sep', 'aria-hidden': true }, '·'),
        h('span', {
          key: 'failed',
          className: failed > 0 ? 'dsh-mrs-failed' : undefined,
        }, t('pill.failed', { count: formatCount(failed) })),
        speed === null ? null : [
          h('span', { key: 'sep2', className: 'dsh-mrs-sep', 'aria-hidden': true }, '·'),
          h('span', { key: 'speed' }, t('pill.rate', { value: speed })),
        ],
      )

      const reasons = view.reasons
      const last = view.lastFailure

      const panel = h('div', {
        ref: panelRef,
        id: panelId,
        className: 'dsh-mrs-panel',
        role: 'dialog',
        tabIndex: -1,
        'aria-label': t('panel.title'),
        'data-model-request-stats': 'panel',
      },
      h('div', { className: 'dsh-mrs-head' },
        h('span', { className: 'dsh-mrs-head-title' }, h(StatsGlyph), t('panel.title')),
        h('span', { className: 'dsh-mrs-head-value' }, t('panel.requests', { count: formatCount(requests) })),
      ),
      h('div', { className: 'dsh-mrs-rule', 'aria-hidden': true }),
      h('dl', { className: 'dsh-mrs-rows' },
        summaryRow('requests', t('row.requests'), formatCount(requests)),
        summaryRow('completed', t('row.completed'), formatCount(view.completed)),
        summaryRow('failed', t('row.failed'), formatCount(failed)),
        cancelled > 0 ? summaryRow('cancelled', t('row.cancelled'), formatCount(cancelled)) : null,
        summaryRow('rate', t('row.rate'), formatRate(failed, settled)),
        speed === null ? null : summaryRow('speed', t('row.speed'), speed),
        view.requestMs > 0 ? summaryRow('elapsed', t('row.elapsed'), formatDuration(view.requestMs, t)) : null,
        speed === null ? null : summaryRow('tokens', t('row.tokens'), formatCount(view.tokens)),
        view.retries > 0 ? summaryRow('retries', t('row.retries'), formatCount(view.retries)) : null,
      ),
      h('div', { className: 'dsh-mrs-section' }, t('reasons.title')),
      failed === 0
        ? h('p', { className: 'dsh-mrs-empty' }, t('reasons.empty'))
        : h('div', null,
          reasons.map(entry => reasonRow(
            `${entry.code}|${entry.status ?? ''}`,
            reasonLabel(entry.code, entry.status),
            entry.count,
            failed,
            'error',
          )),
          view.unattributed > 0
            ? reasonRow('unattributed', t('reasons.unattributed'), view.unattributed, failed, 'warn')
            : null,
        ),
      failed === 0 ? null : h('div', { className: 'dsh-mrs-last' },
        h('div', { className: 'dsh-mrs-section' }, t('last.title')),
        h('p', { className: 'dsh-mrs-last-text', title: last === null ? undefined : last.message },
          last === null
            ? t('last.empty')
            : `${formatTime(last.time)} · ${reasonLabel(last.code, last.status)}${last.message === '' ? '' : ` — ${last.message}`}`,
        ),
      ),
      speed === null ? null : h('p', { className: 'dsh-mrs-note' }, t('note.speed')),
      )

      return h('span', {
        ref: rootRef,
        className: 'dsh-mrs-anchor',
        'data-model-request-stats': 'pill',
      },
      h('button', {
        ref: buttonRef,
        type: 'button',
        className: 'dsh-mrs-pill',
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': open ? panelId : undefined,
        'aria-label': aria,
        title: speed === null
          ? t('pill.title', { requests: formatCount(requests), failed: formatCount(failed) })
          : t('pill.title.rate', { requests: formatCount(requests), failed: formatCount(failed), value: speed }),
        'data-composer-stat': ENTRY_ID,
        onClick: () => { setOpen(!open) },
      }, h(StatsGlyph), headline),
      open ? createPortal(panel, document.body) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the dictionaries, the stylesheet, and the dock entry.
       * Every registration is an effect, so unloading removes them.
       * @param ctx - client root context.
       */
      apply(ctx) {
        localeService = ctx.locale
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'model-request-stats: dictionaries')
        ctx.effect(insertStyles, 'model-request-stats: styles')
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: ENTRY_ID,
          order: 2,
          locale: NS,
        }, RequestStatsPill))
      },
    }
  },
})
