/**
 * Types for Vite's `?worker` import suffix.
 *
 * `import W from './x.ts?worker'` makes Vite bundle that module and its imports
 * into a Worker script and hand back a constructor. TypeScript has no knowledge
 * of the query suffix, so it needs declaring.
 */

declare module '*?worker' {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}
