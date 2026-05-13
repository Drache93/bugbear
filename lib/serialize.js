function encode(val, seen = new WeakSet()) {
  if (val === undefined) return { __type: 'undefined' }
  if (val === null) return null
  if (typeof val === 'bigint') return { __type: 'BigInt', value: val.toString() }
  if (Buffer.isBuffer(val)) return { __type: 'Buffer', hex: val.toString('hex') }
  if (typeof val === 'object') {
    if (seen.has(val)) return { __type: 'Circular' }
    seen.add(val)
    if (val instanceof Map) {
      return { __type: 'Map', entries: [...val].map(([k, v]) => [encode(k, seen), encode(v, seen)]) }
    }
    if (val instanceof Set) {
      return { __type: 'Set', values: [...val].map((v) => encode(v, seen)) }
    }
    if (Array.isArray(val)) return val.map((v) => encode(v, seen))
    const out = {}
    for (const k of Object.keys(val)) out[k] = encode(val[k], seen)
    return out
  }
  return val
}

function decode(val) {
  if (val === null || val === undefined) return val
  if (Array.isArray(val)) return val.map(decode)
  if (typeof val === 'object') {
    if (val.__type === 'undefined') return undefined
    if (val.__type === 'BigInt') return BigInt(val.value)
    if (val.__type === 'Buffer') return Buffer.from(val.hex, 'hex')
    if (val.__type === 'Map') return new Map(val.entries.map(([k, v]) => [decode(k), decode(v)]))
    if (val.__type === 'Set') return new Set(val.values.map(decode))
    const out = {}
    for (const k of Object.keys(val)) out[k] = decode(val[k])
    return out
  }
  return val
}

module.exports = { encode, decode }
