import { describe, expect, it } from 'vitest'
import { installIceObserver } from './ice-observer.ts'
import type { IceGlobals } from './ice-observer.ts'

/**
 * Stage four's observer, driven over a fake `RTCPeerConnection`.
 *
 * A plain `.test.ts`, so it runs in the node lane and the browser lane from one file. The fake
 * is used in **both**: wrapping the browser's real `RTCPeerConnection` inside a test would
 * install a wrapper on the page the test itself runs in, and the property being asserted — that
 * the wrapper reports once and changes nothing — is about the wrapper rather than about any
 * particular implementation underneath it.
 */

/** A peer connection as narrowly as the observer uses one, plus a way to drive it. */
class FakePeerConnection {
  static built = 0
  iceGatheringState = 'new'
  readonly listeners = new Map<string, (() => void)[]>()
  /** Proves the wrapper called through: a value the wrapper never sets. */
  readonly constructedWith: unknown

  constructor(config?: unknown) {
    FakePeerConnection.built += 1
    this.constructedWith = config
  }

  addEventListener(type: string, listener: () => void): void {
    const found = this.listeners.get(type) ?? []
    found.push(listener)
    this.listeners.set(type, found)
  }

  /** Move the state and fire the event, as a real connection would. */
  moveTo(state: string): void {
    this.iceGatheringState = state
    for (const listener of this.listeners.get('icegatheringstatechange') ?? []) listener()
  }
}

function newGlobals(): IceGlobals {
  FakePeerConnection.built = 0
  return { RTCPeerConnection: FakePeerConnection }
}

type Constructed = FakePeerConnection & { moveTo(state: string): void }

function construct(globals: IceGlobals, config?: unknown): Constructed {
  const Ctor = globals.RTCPeerConnection as new (config?: unknown) => Constructed
  return new Ctor(config)
}

describe('the ICE observer reports the first gathering and nothing else', () => {
  it('reports once on the first transition into gathering', () => {
    const globals = newGlobals()
    let reported = 0
    const remove = installIceObserver(() => {
      reported += 1
    }, globals)

    const connection = construct(globals)
    expect(reported, 'reported before anything gathered').toBe(0)
    connection.moveTo('gathering')
    expect(reported).toBe(1)
    remove()
  })

  it('reports nothing for a later transition on the same connection', () => {
    const globals = newGlobals()
    let reported = 0
    const remove = installIceObserver(() => {
      reported += 1
    }, globals)

    const connection = construct(globals)
    connection.moveTo('gathering')
    connection.moveTo('complete')
    connection.moveTo('gathering')
    // One, as the literal. The funnel counts visits, not connections.
    expect(reported).toBe(1)
    remove()
  })

  it('reports once between TWO connections, because a visit reaches a stage once', () => {
    const globals = newGlobals()
    let reported = 0
    const remove = installIceObserver(() => {
      reported += 1
    }, globals)

    construct(globals).moveTo('gathering')
    construct(globals).moveTo('gathering')
    expect(reported).toBe(1)
    remove()
  })

  it('ignores a state that is not gathering', () => {
    const globals = newGlobals()
    let reported = 0
    const remove = installIceObserver(() => {
      reported += 1
    }, globals)

    const connection = construct(globals)
    connection.moveTo('complete')
    // The floor for the case above: if any transition reported, "reports once" would be
    // satisfied by a wrapper that reported on the wrong one.
    expect(reported).toBe(0)
    remove()
  })

  it('installing twice does not report twice', () => {
    const globals = newGlobals()
    let reported = 0
    const first = installIceObserver(() => {
      reported += 1
    }, globals)
    const second = installIceObserver(() => {
      reported += 1
    }, globals)

    construct(globals).moveTo('gathering')
    expect(reported, 'the second install wrapped the wrapper').toBe(1)
    second()
    first()
  })

  it('changes nothing about the connection it wraps', () => {
    const globals = newGlobals()
    const remove = installIceObserver(() => {}, globals)

    const config = { iceServers: [] }
    const connection = construct(globals, config)
    // Constructed at all, with the argument passed straight through, and it IS a real one.
    expect(FakePeerConnection.built).toBe(1)
    expect(connection.constructedWith).toBe(config)
    expect(connection).toBeInstanceOf(FakePeerConnection)
    // And the constructor still answers to its own name, so a feature probe or a log line
    // cannot tell it has been wrapped.
    expect((globals.RTCPeerConnection as { name: string }).name).toBe('FakePeerConnection')
    remove()
  })

  it('puts the global back, so a tab is left as it was found', () => {
    const globals = newGlobals()
    const before = globals.RTCPeerConnection
    const remove = installIceObserver(() => {}, globals)
    expect(globals.RTCPeerConnection, 'nothing was installed at all').not.toBe(before)
    remove()
    expect(globals.RTCPeerConnection).toBe(before)
  })

  it('answers a no-op remover when there is no RTCPeerConnection to wrap', () => {
    const globals: IceGlobals = {}
    let reported = 0
    const remove = installIceObserver(() => {
      reported += 1
    }, globals)
    expect(() => {
      remove()
    }).not.toThrow()
    expect(reported).toBe(0)
    // And nothing was invented on the way: a browser with no WebRTC still has none.
    expect(globals.RTCPeerConnection).toBeUndefined()
  })
})
