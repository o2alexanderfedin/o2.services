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
