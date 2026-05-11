const z32 = require('z32')
const process = require('process')
const KeyDecoder = require('bare-ansi-escapes/key-decoder')
const LabeledList = require('./list')

function navigate(root) {
  let cur = root
  const stack = []
  let sel = 0
  let _filter = ''
  let _filterMode = false
  let _mapPath = ''
  let _mapMode = false
  let _pagerMode = false
  let _pagerLines = []
  let _pagerScroll = 0
  const _selections = new Map()
  let _visualMode = false
  let _visualAnchor = 0
  let _visualPrevKeys = new Set()
  let _active = false
  let _decoder = null
  let _rawHandler = null
  let xMode = 0
  const _BUF_MODES = ['hex', 'z32', 'raw']
  const _TS_MODES = ['ms', 'utc', 'local']

  function rerender() {
    if (_active && !_pagerMode) _render()
  }

  function _ll(obj) {
    return obj instanceof LabeledList
  }

  function _getVal(obj, key) {
    if (_ll(obj)) return obj._items[parseInt(key)]?.value
    const v = obj[key]
    return typeof v === 'function' ? v.bind(obj) : v
  }

  function _getLabel(obj, key) {
    if (_ll(obj)) return obj._items[parseInt(key)]?.label ?? key
    return key
  }

  function _keys(obj) {
    if (_ll(obj)) return obj._items.map((_, i) => String(i))
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

  function _visibleKeys() {
    const all = _keys(cur)
    if (!_filter) return all
    let re
    try {
      re = new RegExp(_filter, 'i')
    } catch {
      return all
    }
    return all.filter((k) => re.test(_getLabel(cur, k)))
  }

  function _resolvePath(val, path) {
    for (const p of path.split('.')) {
      if (
        val === null ||
        val === undefined ||
        typeof val !== 'object' ||
        val instanceof LabeledList
      ) {
        return undefined
      }
      val = val[p]
    }
    return val
  }

  function _isSelected(key) {
    return _selections.get(cur)?.has(key) ?? false
  }
  function _toggleSelect(key) {
    if (!_selections.has(cur)) _selections.set(cur, new Set())
    const s = _selections.get(cur)
    s.has(key) ? s.delete(key) : s.add(key)
  }
  function _applyVisualSelection() {
    const ks = _visibleKeys()
    const lo = Math.min(_visualAnchor, sel)
    const hi = Math.max(_visualAnchor, sel)
    const newKeys = new Set()
    for (let i = lo; i <= hi; i++) if (ks[i] !== undefined) newKeys.add(ks[i])
    if (!_selections.has(cur)) _selections.set(cur, new Set())
    const s = _selections.get(cur)
    for (const k of _visualPrevKeys) if (!newKeys.has(k)) s.delete(k)
    for (const k of newKeys) s.add(k)
    _visualPrevKeys = newKeys
  }

  function _selKey() {
    return _visibleKeys()[sel] ?? null
  }
  function _selVal() {
    const k = _selKey()
    return k === null ? undefined : _getVal(cur, k)
  }

  function _exitVisual() {
    _visualMode = false
    _visualPrevKeys = new Set()
  }

  function _drill() {
    const k = _selKey()
    const val = _getVal(cur, k)
    if (val === null || typeof val !== 'object') return
    stack.push({ obj: cur, key: _getLabel(cur, k), sel })
    cur = val
    sel = 0
    _filter = ''
    _filterMode = false
    _exitVisual()
  }

  function _goUp() {
    if (!stack.length) return
    const prev = stack.pop()
    cur = prev.obj
    sel = prev.sel
    _filter = ''
    _filterMode = false
    _exitVisual()
  }

  function _buildPagerLines() {
    const cols = (process.stdout.columns || 80) - 1
    const lines = []

    const globalSel = []
    for (const [obj, keys] of _selections) {
      for (const k of keys) globalSel.push({ obj, k })
    }

    const entries = globalSel.length
      ? globalSel.map(({ obj, k }) => ({ label: _getLabel(obj, k), val: _getVal(obj, k) }))
      : _visibleKeys().map((k) => ({ label: _getLabel(cur, k), val: _getVal(cur, k) }))

    for (const { label, val } of entries) {
      const fill = '─'.repeat(Math.max(0, cols - label.length - 4))
      lines.push(`\x1b[2m──\x1b[0m \x1b[1;36m${label}\x1b[0m \x1b[2m${fill}\x1b[0m`)
      _appendVal(val, lines, 0)
      lines.push('')
    }
    return lines
  }

  function _appendVal(val, lines, depth) {
    const indent = '  '.repeat(depth)
    if (val instanceof LabeledList) {
      for (const item of val._items) {
        lines.push(`${indent}\x1b[36m${item.label}\x1b[0m`)
        _appendVal(item.value, lines, depth + 1)
      }
    } else if (val === null || val === undefined) {
      lines.push(`${indent}\x1b[2m${String(val)}\x1b[0m`)
    } else if (Buffer.isBuffer(val)) {
      lines.push(`${indent}\x1b[33m<Buffer ${val.length}b>\x1b[0m`)
    } else if (typeof val !== 'object') {
      const s = _isTs(val) ? _fmtTs(val) : typeof val === 'string' ? val : String(val)
      const color = _colorCode(val)
      for (const line of s.split('\n')) {
        lines.push(`${indent}\x1b[${color}m${line}\x1b[0m`)
      }
    } else if (depth > 5) {
      lines.push(`${indent}\x1b[2m${_shortVal(val)}\x1b[0m`)
    } else {
      for (const k of Object.keys(val)) {
        const v = val[k]
        if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) {
          lines.push(`${indent}\x1b[36m${k}\x1b[0m:`)
          _appendVal(v, lines, depth + 1)
        } else if (typeof v === 'string' && v.includes('\n')) {
          lines.push(`${indent}\x1b[36m${k}\x1b[0m:`)
          for (const line of v.split('\n')) {
            lines.push(`${indent}  \x1b[32m${line}\x1b[0m`)
          }
        } else {
          const s = Buffer.isBuffer(v)
            ? `<Buffer ${v.length}b>`
            : _isTs(v)
              ? _fmtTs(v)
              : typeof v === 'string'
                ? v
                : String(v)
          lines.push(`${indent}\x1b[36m${k}\x1b[0m: \x1b[${_colorCode(v)}m${s}\x1b[0m`)
        }
      }
    }
  }

  function _truncAnsi(s, maxLen) {
    let visible = 0
    let i = 0
    let result = ''
    while (i < s.length) {
      if (s.charCodeAt(i) === 0x1b && s[i + 1] === '[') {
        const end = s.indexOf('m', i + 2)
        if (end === -1) break
        result += s.slice(i, end + 1)
        i = end + 1
      } else {
        if (visible >= maxLen) break
        result += s[i++]
        visible++
      }
    }
    return result + '\x1b[0m'
  }

  function _renderPager() {
    const cols = process.stdout.columns || 80
    const rows = process.stdout.rows || 24
    const contentH = rows - 1

    let out = '\x1b[2J'
    for (let row = 0; row < contentH; row++) {
      out += `\x1b[${row + 1};1H\x1b[2K` + _truncAnsi(_pagerLines[_pagerScroll + row] ?? '', cols)
    }
    const total = _pagerLines.length
    const pos = total
      ? `${_pagerScroll + 1}-${Math.min(_pagerScroll + contentH, total)}/${total}`
      : '0/0'
    out +=
      `\x1b[${rows};1H\x1b[7m ` +
      `${pos}  j:↓  k:↑  c:clear-sel  q:back`.padEnd(cols - 1) +
      '\x1b[0m'
    _w(out)
  }

  function _onResize() {
    if (_pagerMode) _renderPager()
    else _render()
  }

  function _enter() {
    if (_active) return
    _active = true
    process.stdin.setRawMode(true)
    _decoder = new KeyDecoder()
    _rawHandler = (chunk) => _decoder.write(chunk)
    _decoder.on('data', _onKey)
    process.stdin.on('data', _rawHandler)
    process.stdout.on('resize', _onResize)
    _w('\x1b[?25l')
    _render()
  }

  function _exit() {
    _active = false
    process.stdout.off('resize', _onResize)
    process.stdin.off('data', _rawHandler)
    _decoder.destroy()
    _decoder = null
    _rawHandler = null
    process.stdin.setRawMode(false)
    _w('\x1b[?25h\x1b[2J\x1b[H')
    process.exit(0)
  }

  function _onKey(key) {
    if (_pagerMode) {
      const contentH = (process.stdout.rows || 24) - 1
      if (key.name === 'j' || key.name === 'down') {
        if (_pagerScroll < _pagerLines.length - contentH) {
          _pagerScroll++
          _renderPager()
        }
      } else if (key.name === 'k' || key.name === 'up') {
        if (_pagerScroll > 0) {
          _pagerScroll--
          _renderPager()
        }
      } else if (key.name === 'c') {
        _selections.clear()
        _exitVisual()
        _pagerMode = false
        _render()
      } else if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        _pagerMode = false
        _render()
      }
      return
    }

    if (_mapMode) {
      if (key.name === 'escape') {
        _mapPath = ''
        _mapMode = false
        _render()
      } else if (key.name === 'return') {
        _mapMode = false
        _render()
      } else if (key.name === 'backspace') {
        _mapPath = _mapPath.slice(0, -1)
        _render()
      } else if (key.sequence && key.sequence.length === 1 && key.sequence.charCodeAt(0) >= 32) {
        _mapPath += key.sequence
        _render()
      }
      return
    }

    if (_filterMode) {
      if (key.name === 'escape') {
        _filter = ''
        _filterMode = false
        sel = 0
        _render()
      } else if (key.name === 'return') {
        _filterMode = false
        _render()
      } else if (key.name === 'backspace') {
        _filter = _filter.slice(0, -1)
        sel = 0
        _render()
      } else if (key.sequence && key.sequence.length === 1 && key.sequence.charCodeAt(0) >= 32) {
        _filter += key.sequence
        sel = 0
        _render()
      }
      return
    }

    const ks = _visibleKeys()
    if (key.name === 'j' || key.name === 'down') {
      if (sel < ks.length - 1) {
        sel++
        if (_visualMode) _applyVisualSelection()
        _render()
      }
    } else if (key.name === 'k' || key.name === 'up') {
      if (sel > 0) {
        sel--
        if (_visualMode) _applyVisualSelection()
        _render()
      }
    } else if (key.name === 'l' || key.name === 'right' || key.name === 'return') {
      _drill()
      _render()
    } else if (key.name === 'h' || key.name === 'left' || key.name === 'escape') {
      if (_visualMode) {
        _exitVisual()
        _render()
        return
      }
      _goUp()
      _render()
    } else if (key.name === 'g') {
      sel = 0
      _render()
    } else if (key.name === 'G') {
      sel = Math.max(0, ks.length - 1)
      _render()
    } else if (key.name === 'x') {
      xMode = (xMode + 1) % 3
      _render()
    } else if (key.name === 'c') {
      _selections.clear()
      _exitVisual()
      _render()
    } else if (key.name === 's') {
      const k = _selKey()
      if (k !== null) {
        _toggleSelect(k)
        if (sel < _visibleKeys().length - 1) sel++
        _render()
      }
    } else if (key.name === 'v') {
      if (_visualMode) {
        _exitVisual()
        _render()
      } else {
        _visualMode = true
        _visualAnchor = sel
        _visualPrevKeys = new Set()
        _applyVisualSelection()
        _render()
      }
    } else if (key.name === 'm') {
      _mapMode = true
      _render()
    } else if (key.sequence === '/') {
      _filterMode = true
      _render()
    } else if (key.name === 'p') {
      _pagerLines = _buildPagerLines()
      _pagerScroll = 0
      _pagerMode = true
      _renderPager()
    } else if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      _exit()
    }
  }

  function _w(s) {
    process.stdout.write(s)
  }

  function _isTs(n) {
    return typeof n === 'number' && Number.isInteger(n) && n >= 946684800000 && n <= 4102444800000
  }

  function _fmtTs(n) {
    if (xMode === 1) return new Date(n).toISOString()
    if (xMode === 2) return new Date(n).toLocaleString()
    return String(n)
  }

  function _renderBuf(buf) {
    if (xMode === 1) return z32.encode(buf)
    if (xMode === 2) {
      try {
        return buf.toString('utf8')
      } catch {
        return '<invalid utf8>'
      }
    }
    return buf.toString('hex')
  }

  function _render() {
    const cols = process.stdout.columns || 80
    const rows = process.stdout.rows || 24
    const contentH = rows - 2

    const w1 = Math.floor(cols * 0.22)
    const w2 = Math.floor(cols * 0.38)
    const w3 = cols - w1 - w2 - 2

    const parent = stack.length ? stack[stack.length - 1] : null
    const parentKeys = _keys(parent?.obj)
    const curKeys = _visibleKeys()

    const scrollMid = Math.max(0, sel - Math.floor(contentH / 2))
    const scrollLeft = parent ? Math.max(0, parent.sel - Math.floor(contentH / 2)) : 0
    const previewVal = _mapPath ? _resolvePath(_selVal(), _mapPath) : _selVal()
    const preview = _previewLines(previewVal, w3, contentH)

    let out = '\x1b[2J\x1b[H'
    const pathStr = '/' + stack.map((f) => f.key).join('/')
    out += '\x1b[1;36m ' + _trunc(pathStr, cols - 2) + '\x1b[0m\r\n'

    for (let row = 0; row < contentH; row++) {
      const pi = row + scrollLeft
      let c1 = ''
      if (parent && parentKeys[pi] !== undefined) {
        const label = _trunc(_getLabel(parent.obj, parentKeys[pi]), w1 - 1)
        c1 =
          pi === parent.sel ? '\x1b[1;34m ' + label + '\x1b[0m' : '\x1b[2;34m ' + label + '\x1b[0m'
      }

      const ci = row + scrollMid
      let c2 = ''
      if (curKeys[ci] !== undefined) {
        const k = curKeys[ci]
        const v = _getVal(cur, k)
        const drillable = v !== null && typeof v === 'object'
        const selected = _isSelected(k)
        const marker = selected ? '●' : ' '
        const label = _trunc(_getLabel(cur, k), w2 - 2)
        if (ci === sel) {
          const mc = selected ? '\x1b[33m' : ''
          c2 =
            '\x1b[7m\x1b[1m' +
            mc +
            marker +
            '\x1b[0m\x1b[7m\x1b[1m' +
            label.padEnd(w2 - 1) +
            '\x1b[0m'
        } else if (selected) {
          c2 = '\x1b[33m' + marker + label + '\x1b[0m'
        } else {
          c2 = drillable ? '\x1b[36m ' + label + '\x1b[0m' : '\x1b[37m ' + label + '\x1b[0m'
        }
      }

      const c3 = preview[row] ?? ''
      out += _pad(c1, w1) + '\x1b[2m│\x1b[0m' + _pad(c2, w2) + '\x1b[2m│\x1b[0m ' + c3 + '\r\n'
    }

    const count = curKeys.length ? `${sel + 1}/${curKeys.length}` : '0/0'
    const sk = _selKey() !== null ? _getLabel(cur, _selKey()) : ''
    const st = _typeName(_selVal())
    let selCount = 0
    for (const s of _selections.values()) selCount += s.size
    const selBadge = selCount ? ` \x1b[0m\x1b[7;33m[${selCount}✓]\x1b[0m\x1b[7m` : ''
    const mapBadge = _mapPath ? ` \x1b[0m\x1b[7;35m→${_mapPath}\x1b[0m\x1b[7m` : ''
    const visualBadge = _visualMode ? ` \x1b[0m\x1b[7;32mVISUAL\x1b[0m\x1b[7m` : ''
    let status
    if (_mapMode) {
      status = ` m:${_mapPath}█`
    } else if (_filterMode) {
      status = ` /${_filter}█`
    } else if (_filter) {
      status = ` ${count}${selBadge}${visualBadge}${mapBadge}  \x1b[0m\x1b[7;33m/${_filter}\x1b[0m\x1b[7m  ${sk}: ${st}  ESC:clear  q:quit`
    } else {
      status = ` ${count}${selBadge}${visualBadge}${mapBadge}  ${sk}: ${st}   j:↓  k:↑  l:→  h:←  s:sel  v:visual  m:map  /:filter  q:quit`
    }
    out += '\x1b[7m' + _trunc(status, cols).padEnd(cols) + '\x1b[0m'
    _w(out)
  }

  function _previewLines(val, width, maxH) {
    const lines = []
    if (val instanceof LabeledList) {
      if (!val._items.length) {
        lines.push('\x1b[2m(empty)\x1b[0m')
      } else {
        for (let i = 0; i < val._items.length && lines.length < maxH; i++) {
          lines.push('\x1b[36m' + _trunc(val._items[i].label, width - 1) + '\x1b[0m')
        }
      }
    } else if (val === null || val === undefined) {
      lines.push('\x1b[2m' + String(val) + '\x1b[0m')
    } else if (typeof val === 'function') {
      lines.push('\x1b[35m[Function: ' + (val.name || '(anon)') + ']\x1b[0m')
    } else if (Buffer.isBuffer(val) && xMode !== 2) {
      const s = _renderBuf(val)
      lines.push('\x1b[2m[' + _BUF_MODES[xMode] + ' ' + val.length + 'b]\x1b[0m')
      for (let i = 0; i < s.length && lines.length < maxH; i += width - 1) {
        lines.push('\x1b[33m' + _trunc(s.slice(i), width - 1) + '\x1b[0m')
      }
    } else if (typeof val !== 'object') {
      const color = _colorCode(val)
      const s = _isTs(val) ? _fmtTs(val) : String(val)
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

  function _colorCode(val) {
    if (val === null) return '2'
    if (typeof val === 'string') return '32'
    if (typeof val === 'number') return '33'
    if (typeof val === 'boolean' || typeof val === 'function') return '35'
    return '36'
  }

  function _typeName(val) {
    if (val instanceof LabeledList) return `Scope(${val.length})`
    if (val === null) return 'null'
    if (val === undefined) return 'undefined'
    if (Buffer.isBuffer(val)) return `${val.constructor.name}(${val.length}) [${_BUF_MODES[xMode]}]`
    if (Array.isArray(val)) return `Array(${val.length})`
    if (typeof val === 'function') return 'Function'
    if (typeof val === 'object') return `Object {${Object.keys(val).length}}`
    if (_isTs(val)) return `timestamp [${_TS_MODES[xMode]}]`
    return typeof val
  }

  function _shortVal(val) {
    if (val instanceof LabeledList) return `[…${val.length}]`
    if (val === null) return 'null'
    if (val === undefined) return 'undefined'
    if (Buffer.isBuffer(val))
      return xMode === 2 ? `[…${val.length}b]` : `<${_BUF_MODES[xMode]} ${val.length}b>`
    if (typeof val === 'string') return `"${val}"`
    if (typeof val === 'number') return _isTs(val) ? _fmtTs(val) : String(val)
    if (typeof val === 'boolean') return String(val)
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

  _enter()
  return { rerender }
}

module.exports = navigate
