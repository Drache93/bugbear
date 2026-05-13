#!/usr/bin/env bare
'use strict'

const fs = require('fs')
const path = require('path')
const process = require('process')
const { command, flag, arg, argv } = require('paparam')
const LabeledList = require('./lib/list')
const { decode } = require('./lib/serialize')
const navigate = require('./lib/navigator')

const DEFAULT_FILE = path.join('.', 'bugbear.jsonl')

const cmd = command(
  'bugbear',
  arg('[file]', 'jsonl log file to browse'),
  flag('--file|-f [path]', 'jsonl log file to browse'),
  flag('--clear', 'clear the log file on close')
)

const parsed = cmd.parse(argv())
if (parsed === null) process.exit(0)

const file = parsed.flags.file || parsed.args.file || DEFAULT_FILE
const clearFileOnClose = parsed.flags.clear

const root = new LabeledList()
const scopeMap = new Map()
let offset = 0

function addEntry(entry) {
  const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope]
  const tags = entry.tags || []

  let list = root
  let pathKey = ''
  for (const segment of [...scopes, ...tags]) {
    pathKey = pathKey ? pathKey + '\x00' + segment : segment
    if (!scopeMap.has(pathKey)) {
      const scopeList = new LabeledList()
      scopeMap.set(pathKey, scopeList)
      list.push(segment, scopeList)
    }
    list = scopeMap.get(pathKey)
  }

  const decoded = {
    ...entry,
    data: decode(entry.data),
    tags: entry.tags ? entry.tags.map(decode) : undefined
  }
  list.push('[log]', decoded)
}

function loadNew() {
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return false
  }
  const stat = fs.fstatSync(fd)
  if (stat.size <= offset) {
    fs.closeSync(fd)
    return false
  }
  const buf = Buffer.alloc(stat.size - offset)
  fs.readSync(fd, buf, 0, buf.length, offset)
  fs.closeSync(fd)
  offset = stat.size

  let added = false
  for (const line of buf.toString().split('\n')) {
    if (!line) continue
    try {
      addEntry(JSON.parse(line))
      added = true
    } catch {}
  }
  return added
}

loadNew()
const nav = navigate(root, clearFileOnClose, file)

try {
  fs.watch(file, () => {
    if (loadNew()) nav.rerender()
  })
} catch {}
