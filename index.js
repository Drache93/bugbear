const z32 = require('z32')

const events = []
let _repl = null
let _replReady = null
const _pending = new Map()
const _resumes = []

function bugbear(scope, context) {
  function store(level, data, captureStack) {
    const event = { scope, level, data, ts: Date.now() }
    if (context !== undefined) event.context = context
    if (captureStack) event.stack = new Error().stack.split('\n').slice(2).join('\n')
    events.push(event)
  }
  return {
    debug(data) {
      store('debug', data)
    },
    error(data) {
      store('error', data)
    },
    stack(data) {
      store('stack', data, true)
    }
  }
}

bugbear.print = function (n) {
  const slice = n ? events.slice(-n) : events
  if (slice.length === 0) {
    console.log('(no debug events)')
    return
  }
  for (const ev of slice) {
    const ts = new Date(ev.ts).toISOString()
    console.log(`\n[${ts}] [${ev.level}] ${ev.scope}`)
    if (ev.context !== undefined) console.log('  ctx:', ev.context)
    if (ev.data !== undefined) console.log('  data:', JSON.stringify(ev.data, undefined, 2))
    if (ev.stack) console.log('  stack:\n' + ev.stack.replace(/^/gm, '    '))
  }
  console.log()
}

bugbear.repl = function (name, value) {
  _pending.set(name, value)
  if (_repl) {
    _repl.context[name] = value
  } else {
    _startRepl().catch(() => {})
  }
}

bugbear.sleep = function (ms) {
  return new Promise((resolve) => {
    let timer = null
    const done = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      _removeResume(done)
      resolve()
    }
    _addResume(done)
    if (ms !== undefined) timer = setTimeout(done, ms)
  })
}

bugbear.breakpoint = function (name, value) {
  let exposeKey = null
  let exposeVal = undefined
  let shouldOpen = false

  if (arguments.length === 0) {
    // pause only
  } else if (typeof name === 'string') {
    exposeKey = name
    exposeVal = value
  } else {
    exposeKey = 'it'
    exposeVal = name
    shouldOpen = exposeVal !== null && typeof exposeVal === 'object'
  }

  if (exposeKey !== null) _pending.set(exposeKey, exposeVal)

  return new Promise((resolve, reject) => {
    const go = (r) => {
      if (exposeKey !== null) r.context[exposeKey] = exposeVal
      const done = () => {
        _removeResume(done)
        resolve()
      }
      _addResume(done)
      if (shouldOpen && r.context.open) {
        r.context.open(exposeVal)
      } else {
        console.log('[bugbear] breakpoint — call resume() in the REPL to continue')
      }
    }

    if (_repl) go(_repl)
    else _startRepl().then(go).catch(reject)
  })
}

function _addResume(fn) {
  _resumes.push(fn)
  if (_repl) _repl.context.resume = _doResume
}

function _removeResume(fn) {
  const i = _resumes.lastIndexOf(fn)
  if (i !== -1) _resumes.splice(i, 1)
  if (_repl) {
    if (_resumes.length) _repl.context.resume = _doResume
    else delete _repl.context.resume
  }
}

function _doResume() {
  const fn = _resumes[_resumes.length - 1]
  if (fn) fn()
}

function _startRepl() {
  if (_replReady) return _replReady
  _replReady = import('bare-repl')
    .then(({ start }) => {
      _repl = start()
      for (const [name, value] of _pending) _repl.context[name] = value
      if (_resumes.length) _repl.context.resume = _doResume
      _setupOpen(_repl.context)
      return _repl
    })
    .catch((err) => {
      console.error('[bugbear] bare-repl unavailable:', err.message)
      _replReady = null
      throw err
    })
  return _replReady
}

function _setupOpen(ctx) {
  let cur = null
  let _root = null
  let stack = [] // { obj, key, sel }[]
  let sel = 0
  let _active = false
  let _decoder = null
  let _rawHandler = null
  let bufMode = 0 // 0=hex 1=z32 2=raw
  const _BUF_MODES = ['hex', 'z32', 'raw']
  const _history = new Map()

  ctx.open = function (obj) {
    _root = obj
    if (_history.has(obj)) {
      const saved = _history.get(obj)
      cur = saved.cur
      stack = saved.stack
      sel = saved.sel
    } else {
      cur = obj
      stack = []
      sel = 0
    }
    ctx.$ = _selVal()
    _enter()
  }

  ctx.pwd = function () {
    return '/' + stack.map((f) => f.key).join('/')
  }

  ctx.print = function (max) {
    return bugbear.print(max)
  }

  ctx.ls = function () {
    if (!_pending.size) {
      console.log('(nothing registered — use bugbear.repl(name, value) to expose values)')
      return []
    }
    const result = {}
    for (const [name, val] of _pending) {
      const t = val === null ? 'null' : Array.isArray(val) ? `Array(${val.length})` : typeof val
      result[name] = t
    }
    return result
  }

  ctx.help = function () {
    console.log(`
bugbear REPL
  open(val)        explore an object in the TUI browser
  pwd()            print current path inside open browser
  ls()             list values registered with bugbear.repl()
  resume()         resume paused code (sleep / breakpoint)
  print(n?)        print last n debug events (all if n omitted)
  $                currently selected value in open browser
`)
  }

  function _keys(obj) {
    if (obj === null || typeof obj !== 'object') return []
    const keys = new Set(Object.keys(obj))
    let proto = Object.getPrototypeOf(obj)
    while (proto && proto !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(proto)) {
        if (k !== 'constructor' && !k.startsWith('_')) keys.add(k)
      }
      proto = Object.getPrototypeOf(proto)
    }
    return [...keys]
  }
  function _selKey() {
    return _keys(cur)[sel] ?? null
  }
  function _selVal() {
    const k = _selKey()
    if (k === null) return undefined
    const v = cur[k]
    return typeof v === 'function' ? v.bind(cur) : v
  }

  function _drill() {
    const val = _selVal()
    if (val === null || typeof val !== 'object') return
    stack.push({ obj: cur, key: _selKey(), sel })
    cur = val
    sel = 0
    ctx.$ = _selVal()
  }

  function _goUp() {
    if (!stack.length) return
    const prev = stack.pop()
    cur = prev.obj
    sel = prev.sel
    ctx.$ = _selVal()
  }

  function _onResize() {
    _render()
  }

  function _enter() {
    if (_active) return
    _active = true
    _repl._input.off('data', _repl._oninput)
    const KeyDecoder = globalThis.require('bare-ansi-escapes/key-decoder')
    _decoder = new KeyDecoder()
    _rawHandler = (chunk) => _decoder.write(chunk)
    _decoder.on('data', _onKey)
    _repl._input.on('data', _rawHandler)
    _repl._output.on('resize', _onResize)
    _w('\x1b[?25l')
    _render()
  }

  function _exitToCall() {
    _exit()
    _repl._input.emit('data', Buffer.from('$('))
  }

  function _exit() {
    if (_root !== null) _history.set(_root, { cur, stack: stack.slice(), sel })
    _active = false
    _repl._output.off('resize', _onResize)
    _repl._input.off('data', _rawHandler)
    _decoder.destroy()
    _decoder = null
    _rawHandler = null
    _repl._input.on('data', _repl._oninput)
    _w('\x1b[?25h\x1b[2J\x1b[H')
    _repl._previousRows = 0
    _repl.prompt()
  }

  function _onKey(key) {
    const ks = _keys(cur)
    if (key.name === 'j' || key.name === 'down') {
      if (sel < ks.length - 1) {
        sel++
        ctx.$ = _selVal()
        _render()
      }
    } else if (key.name === 'k' || key.name === 'up') {
      if (sel > 0) {
        sel--
        ctx.$ = _selVal()
        _render()
      }
    } else if (key.name === 'l' || key.name === 'right' || key.name === 'return') {
      if (typeof _selVal() === 'function') {
        _exitToCall()
      } else {
        _drill()
        _render()
      }
    } else if (key.name === 'h' || key.name === 'left') {
      _goUp()
      _render()
    } else if (key.name === 'g') {
      sel = 0
      ctx.$ = _selVal()
      _render()
    } else if (key.name === 'G') {
      sel = Math.max(0, ks.length - 1)
      ctx.$ = _selVal()
      _render()
    } else if (key.name === 'escape') {
      _goUp()
      _render()
    } else if (key.name === 'x') {
      bufMode = (bufMode + 1) % 3
      _render()
    } else if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      _exit()
    }
  }

  function _w(s) {
    _repl._output.write(s)
  }

  function _renderBuf(buf) {
    if (bufMode === 1) return z32.encode(buf)
    if (bufMode === 2) {
      try {
        return buf
      } catch {
        return '<invalid utf8>'
      }
    }
    // hex (default)
    return buf.toString('hex')
  }

  function _render() {
    const cols = _repl._columns || 80
    const rows = _repl._rows || 24
    const contentH = rows - 2 // header row + status row

    const w1 = Math.floor(cols * 0.22)
    const w2 = Math.floor(cols * 0.38)
    const w3 = cols - w1 - w2 - 2 // 2 for │ separators

    const parent = stack.length ? stack[stack.length - 1] : null
    const parentKeys = _keys(parent?.obj)
    const curKeys = _keys(cur)

    // Scroll so selection stays centered
    const scrollMid = Math.max(0, sel - Math.floor(contentH / 2))
    const scrollLeft = parent ? Math.max(0, parent.sel - Math.floor(contentH / 2)) : 0
    const preview = _previewLines(_selVal(), w3, contentH)

    let out = '\x1b[2J\x1b[H'

    // ── Header: path ────────────────────────────────────────────────────────
    const pathStr = '/' + stack.map((f) => f.key).join('/')
    out += '\x1b[1;36m ' + _trunc(pathStr, cols - 2) + '\x1b[0m\r\n'

    // ── Content rows ────────────────────────────────────────────────────────
    for (let row = 0; row < contentH; row++) {
      // Left column — parent keys (dim, active key highlighted)
      const pi = row + scrollLeft
      let c1 = ''
      if (parent && parentKeys[pi] !== undefined) {
        const label = _trunc(parentKeys[pi], w1 - 1)
        c1 =
          pi === parent.sel ? '\x1b[1;34m ' + label + '\x1b[0m' : '\x1b[2;34m ' + label + '\x1b[0m'
      }

      // Middle column — current keys (selection reversed)
      const ci = row + scrollMid
      let c2 = ''
      if (curKeys[ci] !== undefined) {
        const k = curKeys[ci]
        const v = cur[k]
        const drillable = v !== null && typeof v === 'object'
        const label = _trunc(k, w2 - 2)
        if (ci === sel) {
          c2 = '\x1b[7m\x1b[1m ' + label.padEnd(w2 - 1) + '\x1b[0m'
        } else {
          c2 = drillable ? '\x1b[36m ' + label + '\x1b[0m' : '\x1b[37m ' + label + '\x1b[0m'
        }
      }

      // Right column — preview
      const c3 = preview[row] ?? ''

      out += _pad(c1, w1) + '\x1b[2m│\x1b[0m' + _pad(c2, w2) + '\x1b[2m│\x1b[0m ' + c3 + '\r\n'
    }

    // ── Status bar ───────────────────────────────────────────────────────────
    const count = curKeys.length ? `${sel + 1}/${curKeys.length}` : '0/0'
    const sk = _selKey() ?? ''
    const st = _typeName(_selVal())
    const hint = 'h:up  j:↓  k:↑  l:in  g:top  G:bot  x:enc  q:quit'
    const status = ` ${count}  ${sk}: ${st}   ${hint}`
    out += '\x1b[7m' + _trunc(status, cols).padEnd(cols) + '\x1b[0m'

    _w(out)
  }

  // ── Preview column ─────────────────────────────────────────────────────────
  function _previewLines(val, width, maxH) {
    const lines = []
    if (val === null || val === undefined) {
      lines.push('\x1b[2m' + String(val) + '\x1b[0m')
    } else if (typeof val === 'function') {
      lines.push('\x1b[35m[Function: ' + (val.name || '(anon)') + ']\x1b[0m')
    } else if (Buffer.isBuffer(val) && bufMode !== 2) {
      const s = _renderBuf(val)
      const mode = _BUF_MODES[bufMode]
      lines.push('\x1b[2m[' + mode + ' ' + val.length + 'b]\x1b[0m')
      for (let i = 0; i < s.length && lines.length < maxH; i += width - 1) {
        lines.push('\x1b[33m' + _trunc(s.slice(i), width - 1) + '\x1b[0m')
      }
    } else if (typeof val !== 'object') {
      const color = _colorCode(val)
      const s = String(val)
      for (let i = 0; i < s.length && lines.length < maxH; i += width - 1) {
        lines.push('\x1b[' + color + 'm' + _trunc(s.slice(i), width - 1) + '\x1b[0m')
      }
    } else {
      const ks = Object.keys(val)
      if (!ks.length) {
        lines.push('\x1b[2m(empty)\x1b[0m')
      } else {
        const kw = Math.floor(width * 0.4)
        const vw = width - kw - 2
        for (let i = 0; i < ks.length && lines.length < maxH; i++) {
          const k = ks[i]
          const v = val[k]
          const kPart = '\x1b[36m' + _trunc(k, kw) + '\x1b[0m'
          const vPart = '\x1b[' + _colorCode(v) + 'm' + _trunc(_shortVal(v), vw) + '\x1b[0m'
          lines.push(kPart + ' ' + vPart)
        }
      }
    }
    return lines
  }

  // ── Formatting helpers ────────────────────────────────────────────────────
  function _colorCode(val) {
    if (val === null) return '2'
    if (typeof val === 'string') return '32'
    if (typeof val === 'number') return '33'
    if (typeof val === 'boolean') return '35'
    if (typeof val === 'function') return '35'
    return '36'
  }

  function _typeName(val) {
    if (val === null) return 'null'
    if (val === undefined) return 'undefined'
    if (Buffer.isBuffer(val)) {
      return `${val.constructor.name}(${val.length}) [${_BUF_MODES[bufMode]}]`
    }
    if (Array.isArray(val)) return `Array(${val.length})`
    if (typeof val === 'function') return 'Function'
    if (typeof val === 'object') return `Object {${Object.keys(val).length}}`
    return typeof val
  }

  function _shortVal(val) {
    if (val === null) return 'null'
    if (val === undefined) return 'undefined'
    if (Buffer.isBuffer(val)) {
      return bufMode === 2 ? `[…${val.length}b]` : `<${_BUF_MODES[bufMode]} ${val.length}b>`
    }
    if (typeof val === 'string') return `"${val}"`
    if (typeof val === 'number' || typeof val === 'boolean') return String(val)
    if (Array.isArray(val)) return `[…${val.length}]`
    if (typeof val === 'function') return val.name ? `fn ${val.name}` : 'fn'
    return `{…${Object.keys(val).length}}`
  }

  function _pad(s, width) {
    const visible = s.replace(/\x1b\[[^m]*m/g, '')
    return s + ' '.repeat(Math.max(0, width - visible.length))
  }

  function _trunc(s, width) {
    return s.length <= width ? s : s.slice(0, width - 1) + '…'
  }
}

if (!globalThis.__bugbear) globalThis.__bugbear = bugbear

module.exports = globalThis.__bugbear
