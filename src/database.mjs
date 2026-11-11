import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import postgres from 'postgres';

export function openDatabase(path, connectionString) {
  if (connectionString) {
    const client = postgres(connectionString, { max: 1, prepare: false, ssl: 'verify-full', connect_timeout: 10, idle_timeout: 20 });
    function query(statement, args, connection = client) {
      let position = 0;
      return connection.unsafe(statement.replace(/\?/g, () => '$' + ++position), args);
    }
    return {
      get: async (statement, ...args) => (await query(statement, args))[0],
      all: (statement, ...args) => query(statement, args),
      run: async (statement, ...args) => ({ changes: (await query(statement, args)).count }),
      batch: statements => client.begin(async connection => {
        for (const [sql, args, check] of statements) {
          const result = await query(sql, args, connection);
          check?.(result.count);
        }
      }),
      close: () => client.end()
    };
  }
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return {
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    batch: statements => {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [sql, args, check] of statements) {
          const result = db.prepare(sql).run(...args);
          check?.(result.changes);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    exec: sql => db.exec(sql),
    close: () => db.close()
  };
}
