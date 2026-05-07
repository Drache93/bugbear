export interface BugbearLogger {
  debug(data: unknown): void
  error(data: unknown): void
  /** Logs an error-level event and captures the current stack trace */
  stack(data: unknown): void
}

export interface Bugbear {
  (scope: string, context?: unknown): BugbearLogger
  /** Print the last n events to stdout (all events if n is omitted) */
  print(n?: number): void
  /** Expose a value in the bare-repl context, starting the REPL if needed */
  repl(name: string, value: unknown): void
  /**
   * Pause execution for ms milliseconds, or indefinitely if ms is omitted.
   * Call `resume()` in the REPL to unblock early.
   */
  sleep(ms?: number): Promise<void>
  /**
   * Pause execution until `resume()` is called in the REPL.
   * Starts the REPL if needed.
   * - `breakpoint()` — pause only
   * - `breakpoint(obj)` — expose as `it` and open the TUI browser automatically
   * - `breakpoint(name, value)` — expose value as name
   */
  breakpoint(): Promise<void>
  breakpoint(obj: object): Promise<void>
  breakpoint(name: string, value: unknown): Promise<void>
}

declare const bugbear: Bugbear
export = bugbear
