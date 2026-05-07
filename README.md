# bugbear

> a persistent source of annoyance — now useful

Debug events and interactive REPL inspector for [Bare](https://github.com/holepunchto/bare). Log structured events from anywhere in your app, then poke around live state in a ranger-style tree browser without stopping anything.

Designed for debugging and inspecting, not for production use. Created with love by Claude.

## Install

```
npm install bugbear
```

## Log events

```js
const bugbear = require('bugbear')

const log = bugbear('hyperswarm')
const log = bugbear('hyperswarm', peerId) // optional context attached to every event

log.debug({ event: 'peer-added', peers: 4 })
log.error({ msg: 'connection refused', code: 111 })
log.stack({ msg: 'unexpected branch' }) // captures a stack trace too
```

### Global

`__bugbear` is a global variable that holds the bugbear instance. This lets you debug or repl from anywhere in your app without passing the logger around.

```js
require('bugbear')

__bugbear.debug({ event: 'peer-added', peers: 4 })
__bugbear.print()

```

## Inspect events

```js
bugbear.print() // dump everything
bugbear.print(20) // last 20 events
```

## Inspect live state in the REPL

```js
bugbear.repl('swarm', swarm)
bugbear.repl('store', corestore)
```

Drops you into `bare-repl` with those values in scope. Add more values any time — the REPL stays open.

```
> open(swarm)   // launch the tree browser
> $             // currently selected value
> pwd()         // path to current node
```

### Navigator keys

| key                 | action                                 |
| ------------------- | -------------------------------------- |
| `j` / `↓`           | down                                   |
| `k` / `↑`           | up                                     |
| `l` / `→` / `enter` | drill in                               |
| `h` / `←` / `esc`   | go up                                  |
| `g`                 | top                                    |
| `G`                 | bottom                                 |
| `x`                 | cycle buffer encoding: hex → z32 → raw |
| `q` / `ctrl+c`      | exit                                   |

## Singleton

bugbear registers itself at `globalThis.__bugbear` — one instance shared across every module in your app, no matter how many times it's required.

## License

Apache-2.0
