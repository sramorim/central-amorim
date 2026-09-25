/**
 * Local D1-compatible database for the test-suite (node:sqlite shim).
 * Mirrors the small subset of the D1 API used by src/backend/app.js:
 *   db.prepare(sql).bind(...).run() / .first() / .all()
 * This lets the exact production handler run against real SQLite in Node.
 */
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/backend/app.js';

export function createLocalDb(path = ':memory:') {
  const conn = new DatabaseSync(path);
  conn.exec(SCHEMA_SQL);

  const prepare = (sql) => {
    const runP = (...params) => {
      const stmt = conn.prepare(sql);
      const info = stmt.run(...params);
      return {
        success: true,
        meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) },
      };
    };
    const allP = (...params) => {
      const rows = conn.prepare(sql).all(...params);
      return rows.map((r) => Object.fromEntries(Object.entries(r)));
    };
    const firstP = (...params) => {
      const rows = conn.prepare(sql).all(...params);
      const r = rows[0];
      return r ? Object.fromEntries(Object.entries(r)) : null;
    };
    return {
      run: runP,
      all: allP,
      first: firstP,
      bind: (...params) => ({
        run: () => runP(...params),
        all: () => allP(...params),
        first: () => firstP(...params),
      }),
    };
  };

  return {
    prepare,
    exec: (sql) => {
      conn.exec(sql);
    },
    _raw: conn,
    _exec: (sql) => conn.exec(sql),
  };
}