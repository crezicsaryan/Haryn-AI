/**
 * Minimal ambient typings for Node's built-in SQLite module.
 *
 * `node:sqlite` is available from Node 22.5+, but the project's `@types/node`
 * (v20) predates it and does not ship declarations. Rather than force a
 * types-package upgrade, we declare only the surface this app actually uses.
 */

declare module "node:sqlite" {
  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export interface StatementSync {
    /** Execute the statement, returning change counts. */
    run(...params: unknown[]): StatementResultingChanges;
    /** Execute and return the first row, or undefined. */
    get(...params: unknown[]): Record<string, unknown> | undefined;
    /** Execute and return every row. */
    all(...params: unknown[]): Record<string, unknown>[];
    /** Bind and iterate without materialising every row. */
    iterate(...params: unknown[]): IterableIterator<Record<string, unknown>>;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    /** Run one or more statements, ignoring results. */
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
    readonly isOpen: boolean;
  }
}
