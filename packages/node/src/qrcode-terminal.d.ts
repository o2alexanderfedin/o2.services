/**
 * `qrcode-terminal` ships no types, so the project's own are declared here rather
 * than the dependency being used untyped. Only the surface actually called.
 */
declare module 'qrcode-terminal' {
  export function generate(
    text: string,
    options?: { small?: boolean },
    callback?: (output: string) => void,
  ): void
}
