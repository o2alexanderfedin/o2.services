/**
 * The two workerd gaps, asserted against injected scopes.
 *
 * Plain `.test.ts`, so it runs under Node and in all three browser engines — and in both
 * environments the module's own side effect is a **no-op**, which is the first case below
 * and is the property that lets this file run in the ordinary lanes at all.
 *
 * What these cases can and cannot claim is worth stating plainly. They prove the *logic*:
 * what it writes, what it declines to overwrite, that a scope it cannot repair makes it
 * throw rather than report success, and that the channel delivers the way the platform's
 * does. They cannot prove that workerd's own `process.versions` accepts the write — no local
 * run reaches that object — and the throw exists precisely because that branch is the one
 * nothing here can take.
 */

import { describe, expect, it } from 'vitest'
import {
  MinimalBroadcastChannel,
  SHIMMED_NODE_VERSION,
  ShimRefusedError,
  installNodeVersion,
  installWorkerdShims,
} from './workerd-shims.ts'
import type { ShimScope } from './workerd-shims.ts'

describe('importing this module is a no-op wherever the globals already exist', () => {
  it('reports both gaps already present on the real globalThis', () => {
    // The module installs on `globalThis` at import time. Under Node and in a browser both
    // fields exist, so this must report that it found them rather than that it wrote them —
    // a shim that replaced a working global would be a portability bug in the one file whose
    // whole purpose is portability. Plant that reddens this: drop the `already-present`
    // early returns.
    expect(installWorkerdShims(globalThis as ShimScope)).toEqual({
      processVersions: 'already-present',
      broadcastChannel: 'already-present',
    })
  })

  it('leaves a version that is already set exactly as it found it', () => {
    const scope: ShimScope = { process: { versions: { node: '24.18.0' } } }
    expect(installNodeVersion(scope)).toBe('already-present')
    expect(scope.process?.versions?.['node']).toBe('24.18.0')
  })
})

describe('gap 1 — one absent field stops the whole stack constructing', () => {
  it('fills `node` when versions is the empty object workerd reports', () => {
    // This is the measured shape: the consult's probe returned `process.versions` as `{}`,
    // and `user-agent.js:5` reads `.node` off it unconditionally.
    const scope: ShimScope = { process: { versions: {} } }

    expect(installNodeVersion(scope)).toBe('installed')
    expect(scope.process?.versions?.['node']).toBe(SHIMMED_NODE_VERSION)
  })

  it('creates the whole `process` object when there is none', () => {
    const scope: ShimScope = {}
    expect(installNodeVersion(scope)).toBe('installed')
    expect(scope.process?.versions?.['node']).toBe(SHIMMED_NODE_VERSION)
  })

  it('creates `versions` when `process` exists without it', () => {
    const scope: ShimScope = { process: {} }
    expect(installNodeVersion(scope)).toBe('installed')
    expect(scope.process?.versions?.['node']).toBe(SHIMMED_NODE_VERSION)
  })

  it('treats an empty string as absent, not as a version', () => {
    // `userAgent()` would build `libp2p/x.y.z node/` from it — a value that reads as success
    // and is not one. Plant that reddens this: check only for `!== undefined`.
    const scope: ShimScope = { process: { versions: { node: '' } } }
    expect(installNodeVersion(scope)).toBe('installed')
    expect(scope.process?.versions?.['node']).toBe(SHIMMED_NODE_VERSION)
  })

  it('REFUSES a frozen versions object rather than reporting success', () => {
    // A frozen object throws on assignment under strict mode, and an ES module is always
    // strict. Without the catch this escapes as a `TypeError` from inside a shim, naming
    // nothing a reader could connect to the deploy that fails afterwards.
    const scope: ShimScope = { process: { versions: Object.freeze({}) } }
    expect(() => installNodeVersion(scope)).toThrow(ShimRefusedError)
  })

  it('REFUSES a getter-only property', () => {
    // Measured: this ALSO throws on assignment under V8 strict mode, so it reaches the same
    // `catch` the frozen case does rather than a different mechanism. Kept as its own case
    // because it is a different shape of refusal and a host could implement either.
    const versions: Record<string, string | undefined> = {}
    Object.defineProperty(versions, 'node', { get: () => undefined, configurable: false })
    const scope: ShimScope = { process: { versions } }

    expect(() => installNodeVersion(scope)).toThrow(ShimRefusedError)
  })

  it('REFUSES a scope that ACCEPTS the write and keeps its old value', () => {
    // The case the read-back exists for, and the only local shape that produces it. V8 throws
    // on every refusing object it has — probed — so nothing in Node reaches the read-back;
    // a platform binding that returned `true` from its setter and ignored the value would,
    // and it would otherwise be reported as `installed` about a scope where nothing was.
    // Plant that reddens this: delete the read-back check.
    const versions = new Proxy({} as Record<string, string | undefined>, {
      set: () => true,
      get: () => undefined,
    })
    const scope: ShimScope = { process: { versions } }

    expect(() => installNodeVersion(scope)).toThrow(ShimRefusedError)
  })
})

describe('gap 2 — the mutex constructs a BroadcastChannel on its primary path', () => {
  it('installs the minimal channel when the global is missing', () => {
    const scope: ShimScope = { process: { versions: { node: '24.18.0' } } }
    expect(installWorkerdShims(scope)).toEqual({
      processVersions: 'already-present',
      broadcastChannel: 'installed',
    })
    expect(scope.BroadcastChannel).toBe(MinimalBroadcastChannel)
  })

  it('does not replace a platform channel that is already there', () => {
    const platform = class {}
    const scope: ShimScope = { process: { versions: { node: '24.18.0' } }, BroadcastChannel: platform }
    expect(installWorkerdShims(scope).broadcastChannel).toBe('already-present')
    expect(scope.BroadcastChannel).toBe(platform)
  })
})

describe('the minimal channel behaves the way the platform’s does', () => {
  it('delivers to another channel of the same name', () => {
    const sender = new MinimalBroadcastChannel('locks')
    const receiver = new MinimalBroadcastChannel('locks')
    const seen: unknown[] = []
    receiver.addEventListener('message', (event) => seen.push(event.data))

    sender.postMessage({ kind: 'requestReadLock' })

    expect(seen).toEqual([{ kind: 'requestReadLock' }])
    sender.close()
    receiver.close()
  })

  it('does NOT deliver back to the sender', () => {
    // The platform's own rule, and getting it wrong here would be worse than a missing
    // feature: mortice's primary registers handlers that REPLY on the same channel, so a
    // self-delivering channel answers its own replies. Plant that reddens this: drop the
    // `peer === this` skip.
    const sender = new MinimalBroadcastChannel('locks')
    const seen: unknown[] = []
    sender.addEventListener('message', (event) => seen.push(event.data))

    sender.postMessage('hello')

    expect(seen).toEqual([])
    sender.close()
  })

  it('does not cross names', () => {
    const a = new MinimalBroadcastChannel('one')
    const b = new MinimalBroadcastChannel('two')
    const seen: unknown[] = []
    b.addEventListener('message', (event) => seen.push(event.data))

    a.postMessage('x')

    expect(seen).toEqual([])
    a.close()
    b.close()
  })

  it('stops delivering to a closed channel, and refuses to post from one', () => {
    const sender = new MinimalBroadcastChannel('locks')
    const receiver = new MinimalBroadcastChannel('locks')
    const seen: unknown[] = []
    receiver.addEventListener('message', (event) => seen.push(event.data))

    receiver.close()
    sender.postMessage('after close')
    expect(seen).toEqual([])

    sender.close()
    expect(() => sender.postMessage('from a closed channel')).toThrow()
  })

  it('honours removeEventListener, which the mutex calls on every released lock', () => {
    const sender = new MinimalBroadcastChannel('locks')
    const receiver = new MinimalBroadcastChannel('locks')
    const seen: unknown[] = []
    const listener = (event: { readonly data: unknown }): number => seen.push(event.data)
    receiver.addEventListener('message', listener)
    receiver.removeEventListener('message', listener)

    sender.postMessage('x')

    expect(seen).toEqual([])
    sender.close()
    receiver.close()
  })

  it('survives the optional `unref()` the mutex calls on it', () => {
    // `node.js:26` is `channel.unref?.()`. The optional chain means an absent method is
    // fine, and this asserts the consumer's actual call rather than a shape this file
    // imagines — a `unref` that existed and threw would pass every case above.
    const channel = new MinimalBroadcastChannel('locks') as MinimalBroadcastChannel & {
      unref?: () => void
    }
    expect(() => channel.unref?.()).not.toThrow()
    channel.close()
  })
})
