import assert from 'node:assert/strict'

const loaded = []
globalThis.window = {
  __ModuleLoader__: { load: (spec) => { loaded.push(spec) } },
  innerHeight: 800,
  innerWidth: 1280,
  addEventListener() {},
  removeEventListener() {},
}
const styles = []
globalThis.document = {
  createElement: () => ({ dataset: {}, style: {}, set textContent(_value) {}, remove() {} }),
  head: { appendChild: (tag) => { styles.push(tag) } },
  documentElement: { style: {} },
  addEventListener() {},
  removeEventListener() {},
}

await import('../client.js')

assert.equal(loaded.length, 1, 'client bundle must register exactly one module')
const spec = loaded[0]
assert.equal(spec.id, 'dsh-model-request-stats', 'module id must equal the package name')

const React = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState: () => [false, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: () => ({ current: null }),
  useId: () => 'id',
  memo: (value) => value,
}
const require = (name) => {
  if (name === 'react') return React
  if (name === 'react-dom') return { createPortal: () => null }
  throw new Error('unexpected require: ' + name)
}

const mod = spec.factory(require)
assert.deepEqual(mod.inject, ['slots', 'locale'])

const effects = []
const localeRegistrations = []
const slotRegistrations = []
const slotInjects = []
const ctx = {
  effect(fn, label) {
    const cleanup = fn()
    effects.push({ label, cleanup })
    return cleanup
  },
  locale: {
    register(ns, dictionaries) {
      localeRegistrations.push({ ns, dictionaries })
      return () => {}
    },
    getSnapshot: () => ({ active: 'en' }),
  },
  slots: {
    inject(name, fn) { slotInjects.push(name); fn() },
    register(slot, component) {
      slotRegistrations.push({ slot, component })
      return () => {}
    },
  },
}

mod.apply(ctx)

assert.equal(localeRegistrations.length, 1)
assert.equal(localeRegistrations[0].ns, 'model-request-stats')
assert.ok(localeRegistrations[0].dictionaries.en['pill.rate'])
assert.ok(localeRegistrations[0].dictionaries.zh['pill.rate'])
assert.equal(styles.length, 1, 'stylesheet must be installed as an effect')
assert.equal(slotRegistrations.length, 1, 'exactly one dock entry must be registered')
const entry = slotRegistrations[0]
assert.equal(entry.slot.name, 'conversation.composer.dock')
assert.equal(entry.slot.id, 'model-request-stats')
assert.equal(entry.slot.order, 2)
assert.equal(entry.slot.locale, 'model-request-stats')
assert.equal(typeof entry.component, 'function')
assert.deepEqual(slotInjects, ['conversation.composer.dock'])
assert.ok(effects.length >= 2, 'locale and stylesheet registrations must be effects')

console.log('client bundle assertions passed')
