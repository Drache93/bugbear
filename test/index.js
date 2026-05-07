const { test } = require('brittle')
const bugbear = require('../index.js')

function capture(fn) {
  const lines = []
  const orig = console.log
  console.log = (...args) => lines.push(args.join(' '))
  fn()
  console.log = orig
  return lines
}

test('debug event appears in print output', (t) => {
  const log = bugbear('test-scope')
  log.debug({ x: 1 })
  const lines = capture(() => bugbear.print(1))
  t.ok(lines.some((l) => l.includes('test-scope')))
  t.ok(lines.some((l) => l.includes('debug')))
  t.ok(lines.some((l) => l.includes('"x": 1')))
})

test('error event has correct level', (t) => {
  const log = bugbear('err-scope')
  log.error({ msg: 'boom' })
  const lines = capture(() => bugbear.print(1))
  t.ok(lines.some((l) => l.includes('error')))
  t.ok(lines.some((l) => l.includes('"msg": "boom"')))
})

test('stack event includes stack trace in output', (t) => {
  const log = bugbear('stack-scope')
  log.stack({ trace: true })
  const lines = capture(() => bugbear.print(1))
  t.ok(lines.some((l) => l.includes('stack')))
  t.ok(lines.some((l) => l.includes('at ')))
})

test('context is included in output when provided', (t) => {
  const log = bugbear('ctx-scope', 'my-context')
  log.debug({ val: 42 })
  const lines = capture(() => bugbear.print(1))
  t.ok(lines.some((l) => l.includes('my-context')))
})

test('print(n) limits output to last n events', (t) => {
  const log = bugbear('limit-scope')
  log.debug({ i: 'a' })
  log.debug({ i: 'b' })
  log.debug({ i: 'c' })
  const all = capture(() => bugbear.print())
  const last1 = capture(() => bugbear.print(1))
  t.ok(all.join('').includes('"i": "a"'))
  t.absent(last1.join('').includes('"i": "a"'))
  t.ok(last1.join('').includes('"i": "c"'))
})
