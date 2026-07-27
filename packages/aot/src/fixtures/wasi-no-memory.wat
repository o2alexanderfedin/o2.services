;; Exports `_start` and no memory.
;;
;; The mirror of `wasi-no-start.wat`, and the more dangerous of the two: this module
;; instantiates, `_start` is callable, and the host's clock and entropy functions have
;; nowhere to write their answers. Every WASI function that takes a pointer needs the
;; guest's linear memory, so an artifact without one is not runnable under this ABI
;; however healthy it looks — better to say so than to hand the guest a stream of
;; `ERRNO_INVAL` and let it decide what that means.

(module
  (func (export "_start"))
)
