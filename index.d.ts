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
}

declare const bugbear: Bugbear
export = bugbear
