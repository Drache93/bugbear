const { test } = require('brittle')
const fs = require('fs')
const path = require('path')
const bugbear = require('../index.js')

let _counter = 0
function tmpFile() {
  return path.join(__dirname, `_tmp-${Date.now()}-${_counter++}.jsonl`)
}

function readEntries(file) {
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

test('logger writes an entry to the file', (t) => {
  const file = tmpFile()
  const log = bugbear('test-scope', { file })
  log({ x: 1 })
  const entries = readEntries(file)
  t.is(entries.length, 1)
  t.alike(entries[0].scope, ['test-scope'])
  t.alike(entries[0].data, { x: 1 })
  t.ok(typeof entries[0].ts === 'number')
  t.ok(typeof entries[0].stack === 'string')
  fs.unlinkSync(file)
})

test('scope is always stored as an array', (t) => {
  const file = tmpFile()
  const log = bugbear('my-scope', { file })
  log({})
  const [entry] = readEntries(file)
  t.alike(entry.scope, ['my-scope'])
  fs.unlinkSync(file)
})

test('nested scopes are preserved', (t) => {
  const file = tmpFile()
  const log = bugbear(['hyperswarm', 'peers'], { file })
  log({ event: 'connected' })
  const [entry] = readEntries(file)
  t.alike(entry.scope, ['hyperswarm', 'peers'])
  fs.unlinkSync(file)
})

test('tags are stored when provided', (t) => {
  const file = tmpFile()
  const log = bugbear('tag-scope', { file })
  log({ val: 1 }, 'important', 'debug')
  const [entry] = readEntries(file)
  t.alike(entry.tags, ['important', 'debug'])
  fs.unlinkSync(file)
})

test('no tags field when none provided', (t) => {
  const file = tmpFile()
  const log = bugbear('no-tag-scope', { file })
  log({ val: 1 })
  const [entry] = readEntries(file)
  t.absent('tags' in entry)
  fs.unlinkSync(file)
})

test('multiple calls append to the same file', (t) => {
  const file = tmpFile()
  const log = bugbear('multi-scope', { file })
  log({ i: 0 })
  log({ i: 1 })
  log({ i: 2 })
  const entries = readEntries(file)
  t.is(entries.length, 3)
  t.is(entries[0].data.i, 0)
  t.is(entries[2].data.i, 2)
  fs.unlinkSync(file)
})

test('Buffer is encoded correctly', (t) => {
  const file = tmpFile()
  const log = bugbear('buf-scope', { file })
  log({ buf: Buffer.from('hello') })
  const [entry] = readEntries(file)
  t.alike(entry.data.buf, { __type: 'Buffer', hex: Buffer.from('hello').toString('hex') })
  fs.unlinkSync(file)
})

test('globalThis.__bugbear is set to bugbear', (t) => {
  t.is(globalThis.__bugbear, bugbear)
})
