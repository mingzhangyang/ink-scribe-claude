import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * 基于 node:sqlite 的最小 D1 兼容实现，只覆盖本项目用到的接口
 * （prepare/bind/first/all/run/batch），用于在 Node 中运行真实的 SQL 与迁移脚本。
 */

type Row = Record<string, unknown>;

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params);
  }

  async first<T = Row>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) as T | undefined) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { meta: { changes: Number(result.changes) } };
  }
}

export function createTestD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = join(process.cwd(), "migrations");
  for (const file of readdirSync(dir).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8"));
  }
  const api = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return api as unknown as D1Database;
}
