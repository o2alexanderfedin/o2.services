;; Exports `memory` and nothing else.
;;
;; A WASI *reactor* looks like this plus `_initialize`; a `.wasm` produced by any of
;; a dozen other toolchains looks like this exactly. The fabric must tell such an
;; artifact apart from a command module before it runs it, and say which export was
;; missing — "instantiation failed" would be a lie, because instantiation succeeds.

(module
  (memory (export "memory") 1 1)
)
