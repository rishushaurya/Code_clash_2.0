// The browser drives the relay over USB with the Web Serial API (Chrome and Edge).
// Without a board, or in other browsers, the relay is simulated and labelled as such.

import { create } from 'zustand'

export type RelayStatus = 'unsupported' | 'disconnected' | 'connected'

// Minimal Web Serial typings; the API is not in TypeScript's DOM library yet.
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>
  writable: WritableStream<Uint8Array> | null
}
type SerialNavigator = Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } }

const serial = () => (navigator as SerialNavigator).serial

export const useRelay = create<{ status: RelayStatus }>(() => ({
  status: typeof navigator !== 'undefined' && serial() ? 'disconnected' : 'unsupported',
}))

let port: SerialPortLike | null = null

/** Must be called from a click: browsers only show the port picker after a user gesture. */
export async function connectRelay() {
  const s = serial()
  if (!s) return useRelay.setState({ status: 'unsupported' })
  port = await s.requestPort()
  await port.open({ baudRate: 9600 })
  useRelay.setState({ status: 'connected' })
}

/** Sends "R1:0" (off) or "R1:1" (on). Returns 'real' if a board received it, else 'none'. */
export async function setRelay(on: boolean): Promise<'real' | 'none'> {
  if (!port?.writable) return 'none'
  const writer = port.writable.getWriter()
  try {
    await writer.write(new TextEncoder().encode(`R1:${on ? 1 : 0}\n`))
    return 'real'
  } catch {
    useRelay.setState({ status: 'disconnected' })
    port = null
    return 'none'
  } finally {
    writer.releaseLock()
  }
}
