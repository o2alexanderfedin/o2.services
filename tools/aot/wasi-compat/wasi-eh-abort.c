/* wasi-eh-abort.c — the two Itanium C++ ABI entry points wasi-sdk's libc++abi omits.
 *
 * Compiled and linked by tools/aot/link-elflift-wasm.sh. Unlike everything else in this
 * directory these must be REAL symbols rather than static inlines: they are referenced by
 * object files that were already compiled, so nothing a header does can satisfy them.
 *
 * ## Why aborting here is equivalent, not a compromise
 *
 * wasi-sdk 24 builds libc++ and libc++abi with `-fno-exceptions`. Measured across every
 * variant it ships -- wasm32-wasi, -wasip1, -wasip2, both -threads, and the llvm-lto copies,
 * ten archives in all -- not one defines `__cxa_throw`. So the sysroot has no exception
 * runtime, and elfconv's objects, compiled WITH exceptions, reference one.
 *
 * The decisive measurement is what ELSE they reference. Across all 27 elfconv objects and
 * all 37 LLVM archives, the only EH symbols that appear are `__cxa_throw` and
 * `__cxa_allocate_exception`. There is no `__cxa_begin_catch`, no `__cxa_end_catch`, no
 * `_Unwind_Resume` and no `__gxx_personality_v0` -- which means there is not a single landing
 * pad in the linked program. (`__cxa_atexit` and `__cxa_pure_virtual` also appear and are
 * unrelated to exceptions; both are already defined in the sysroot.)
 *
 * **Nothing catches.** Every throw therefore propagates out of main and reaches
 * std::terminate, whose default action is abort. Doing that directly is the same observable
 * behaviour, reached without an unwinder.
 *
 * What is genuinely lost is the message a real runtime prints -- "terminate called after
 * throwing an instance of ..." -- so this prints its own, naming the abort as an
 * uncaught C++ exception rather than letting the module trap anonymously.
 *
 * The throws that exist are the standard library's error paths: `std::length_error`,
 * `std::out_of_range`, `std::bad_array_new_length`, `std::bad_function_call`. Reaching one
 * means the translator was handed input it cannot process, which is a fatal condition here
 * either way.
 *
 * **If a `catch` is ever added on this path, this file becomes wrong** -- a caught exception
 * would abort instead of being handled. The link would tell you: `__cxa_begin_catch` would
 * appear as undefined. At that point the answer is a libc++abi built with exception support,
 * not a bigger stub.
 */

#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>

/* The caller allocates, constructs the exception object into the returned storage, then
 * calls __cxa_throw. The allocation has to be real for that construction to be valid, even
 * though the very next call never returns. */
void *__cxa_allocate_exception(size_t thrown_size) {
  void *p = malloc(thrown_size);
  if (p == NULL) {
    fputs("elflift: out of memory allocating a C++ exception\n", stderr);
    abort();
  }
  return p;
}

/* _Noreturn: the Itanium ABI says __cxa_throw never returns to its caller, and callers are
 * compiled on that assumption -- there is no code after the call site to return to. */
_Noreturn void __cxa_throw(void *thrown_exception, void *tinfo,
                           void (*destructor)(void *)) {
  (void)thrown_exception;
  (void)tinfo;
  (void)destructor;
  fputs("elflift: uncaught C++ exception; this build has no exception runtime "
        "(see tools/aot/wasi-compat/wasi-eh-abort.c)\n",
        stderr);
  abort();
}
