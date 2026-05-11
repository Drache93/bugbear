const fs = require('fs')
const path = require('path')
const { encode } = require('./lib/serialize')

const DEFAULT_FILE = path.join('.', 'bugbear.jsonl')
const _fds = new Map()

function _fd(file) {
  if (!_fds.has(file)) _fds.set(file, fs.openSync(file, 'a'))
  return _fds.get(file)
}

function bugbear(scopes, ...rest) {
  if (!Array.isArray(scopes)) scopes = [scopes]

  let file = DEFAULT_FILE
  if (rest.length > 0) {
    const last = rest[rest.length - 1]
    if (last !== null && typeof last === 'object' && !Array.isArray(last) && !Buffer.isBuffer(last) && typeof last.file === 'string') {
      file = rest.pop().file
    }
  }

  return function log(data, ...tags) {
    const entry = {
      scope: scopes,
      data: encode(data),
      ts: Date.now(),
      stack: new Error().stack.split('\n').slice(2).join('\n')
    }
    if (tags.length) entry.tags = tags.map(encode)
    fs.writeSync(_fd(file), JSON.stringify(entry) + '\n')
  }
}

if (!globalThis.__bugbear) globalThis.__bugbear = bugbear
module.exports = globalThis.__bugbear
