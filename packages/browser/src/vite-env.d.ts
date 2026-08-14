/**
 * Types for Vite's `?worker` import suffix.
 *
 * `import W from './x.ts?worker'` makes Vite bundle that module and its imports
 * into a Worker script and hand back a constructor. TypeScript has no knowledge
 * of the query suffix, so it needs declaring. Duplicated from `@o2/core` rather
 * than shared: an ambient declaration is not an export, and a package that needs
 * it must state so itself.
 */

declare module '*?worker' {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}

/**
 * Types for Vite's `?raw` import suffix — the module's source text as a string.
 *
 * Declared here for the same reason `?worker` is: TypeScript does not know the query
 * suffix, and an ambient declaration is not an export, so the package that needs it
 * states so itself.
 *
 * Used by `consent.test.ts` to read what `browser-node.ts` actually does, so the case
 * coupling the disclosure to the behaviour it describes reads the source rather than
 * restating it. Restating would produce a guard that outlives the fact it guards.
 */
declare module '*?raw' {
  const source: string
  export default source
}
