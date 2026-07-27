;; Asks for a function the host does not supply, and is refused by the runtime.
;;
;; `thread_spawn` is the wasi-threads entry point. Two reasons it is the right thing
;; to ask for here: threads are a first-class nondeterminism source in the WASM
;; specification, and the name lives in the same `wasi_snapshot_preview1` namespace as
;; the 23 imports a real translated artifact uses — so this is not the easy case of a
;; module reaching for an obviously foreign namespace, it is a module reaching for one
;; more function in a namespace it is already entitled to.
;;
;; It still fails, at `WebAssembly.instantiate`, with a `LinkError` naming
;; `wasi_snapshot_preview1.thread_spawn`. **No code in this repository decided that.**
;; The host supplies a set of functions and the runtime refuses a module that wants
;; anything outside it — which is why there is no allow-list to maintain, no scanner
;; to keep in step with the WASI specification, and no way for the two to disagree.

(module
  (import "wasi_snapshot_preview1" "thread_spawn"
    (func $thread_spawn (param i32) (result i32)))
  (memory (export "memory") 1 1)
  (func (export "_start")
    (drop (call $thread_spawn (i32.const 0))))
)
