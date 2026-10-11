// A repeating timer that keeps its pace in a background tab.
// Chrome slows main-thread timers in hidden tabs, down to once a minute after five minutes, which would
// stall a camera tab or the twin while another window is in front. Timers inside a worker are not slowed,
// so the worker keeps time and the page does the work.

const tasks = new Map<number, () => void>()
let worker: Worker | null = null
let next = 0

function start() {
  const code = 'const t={};onmessage=e=>{const{id,ms}=e.data;clearInterval(t[id]);delete t[id];if(ms)t[id]=setInterval(()=>postMessage(id),ms)}'
  const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
  w.onmessage = (e: MessageEvent<number>) => tasks.get(e.data)?.()
  return w
}

/** Calls `fn` every `ms` milliseconds; returns a function that stops it */
export function every(ms: number, fn: () => void): () => void {
  if (typeof Worker === 'undefined') {
    const t = setInterval(fn, ms)
    return () => clearInterval(t)
  }
  try {
    worker ??= start()
  } catch {
    // A strict policy may forbid blob workers: plain timers still work in the foreground.
    const t = setInterval(fn, ms)
    return () => clearInterval(t)
  }
  const id = ++next
  tasks.set(id, fn)
  worker.postMessage({ id, ms })
  return () => {
    tasks.delete(id)
    worker?.postMessage({ id, ms: 0 })
  }
}
