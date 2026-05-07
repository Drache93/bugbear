require('./index.js')

const log = __bugbear('test')
log.debug({ stuff: true })
log.stack({ stuffagain: true })

const bound = __bugbear('hello', { stuff: 'my instance' })
bound.error('something went wrong')

__bugbear.print()

// Sample object to explore in the REPL
const sample = {
  name: 'autobase',
  peers: [
    { id: 'abc123', connected: true, latency: 42 },
    { id: 'def456', connected: false, latency: null }
  ],
  db: {
    length: 100,
    writable: true,
    key: 'deadbeef',
    indexes: { byAuthor: {}, byDate: {} }
  },
  stats: { reads: 10, writes: 3 }
}

__bugbear.repl('sample', sample)
