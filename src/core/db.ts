import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { MIGRATIONS } from './schema';

export type Params = Record<string, SqlValue | boolean | undefined> | (SqlValue | boolean | undefined)[];
export type Row = Record<string, any>;

let SQL: SqlJsStatic | null = null;

export async function loadSqlite(locateFile?: (f: string) => string): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
  return SQL;
}

function normalise(p?: Params): any {
  if (!p) return undefined;
  if (Array.isArray(p)) return p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(p)) {
    const key = /^[:@$]/.test(k) ? k : ':' + k;
    out[key] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}

/** Thin, synchronous wrapper around an in-memory SQLite database. */
export class Db {
  private listeners = new Set<() => void>();
  private txDepth = 0;
  private dirty = false;

  constructor(public raw: Database) {
    raw.run('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  static async create(bytes?: Uint8Array, locateFile?: (f: string) => string): Promise<Db> {
    const S = await loadSqlite(locateFile);
    return new Db(bytes ? new S.Database(bytes) : new S.Database());
  }

  get version(): number { return Number(this.get('PRAGMA user_version')?.user_version ?? 0); }

  private migrate() {
    let v = this.version;
    if (v > MIGRATIONS.length) throw new Error(`This data was created by a newer version of the app (schema v${v}). Please update the app.`);
    while (v < MIGRATIONS.length) {
      this.raw.run('BEGIN');
      try {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.run(`PRAGMA user_version = ${v + 1}`);
        this.raw.run('COMMIT');
      } catch (e) {
        this.raw.run('ROLLBACK');
        throw e;
      }
      v++;
    }
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    const stmt = this.raw.prepare(sql);
    try {
      if (params) stmt.bind(normalise(params));
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally { stmt.free(); }
  }

  get<T = Row>(sql: string, params?: Params): T | undefined { return this.all<T>(sql, params)[0]; }

  value<T = any>(sql: string, params?: Params): T | undefined {
    const r = this.get(sql, params);
    return r ? (Object.values(r)[0] as T) : undefined;
  }

  run(sql: string, params?: Params): { changes: number; lastId: number } {
    this.raw.run(sql, normalise(params));
    const changes = this.raw.getRowsModified();
    const lastId = Number(this.raw.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0);
    this.markDirty();
    return { changes, lastId };
  }

  insert(table: string, data: Record<string, any>): number {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => ':' + k).join(',')})`;
    return this.run(sql, Object.fromEntries(keys.map((k) => [k, data[k]]))).lastId;
  }

  update(table: string, id: number, data: Record<string, any>) {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined && k !== 'id');
    if (!keys.length) return;
    this.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`, { ...Object.fromEntries(keys.map((k) => [k, data[k]])), id });
  }

  /** Run fn atomically; rolls back everything on error. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.raw.run('BEGIN');
    this.txDepth++;
    try {
      const r = fn();
      this.raw.run('COMMIT');
      return r;
    } catch (e) {
      this.raw.run('ROLLBACK');
      throw e;
    } finally {
      this.txDepth--;
      if (this.txDepth === 0 && this.dirty) this.emit();
    }
  }

  private markDirty() {
    this.dirty = true;
    if (this.txDepth === 0) this.emit();
  }

  private emit() {
    this.dirty = false;
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  export(): Uint8Array {
    const bytes = this.raw.export();
    // sql.js re-opens the database during export, which resets connection pragmas.
    this.raw.run('PRAGMA foreign_keys = ON;');
    return bytes;
  }

  integrityCheck(): string { return String(this.value('PRAGMA integrity_check')); }

  close() { this.raw.close(); }
}
