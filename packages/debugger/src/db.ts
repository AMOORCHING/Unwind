import type { RunStatus, UnwindEvent, UnwindRun } from "./types";

// sql.js types (minimal interface we use)
interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  close(): void;
}

interface SqlJsStatement {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(params?: unknown): Record<string, unknown>;
  free(): void;
}

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}

const SQL_JS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.js";
const SQL_JS_WASM_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.wasm";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (sqlJsPromise) return sqlJsPromise;

  sqlJsPromise = new Promise<SqlJsStatic>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SQL_JS_CDN;
    script.onload = () => {
      const initSqlJs = (window as unknown as Record<string, unknown>)[
        "initSqlJs"
      ] as (config: { locateFile: (f: string) => string }) => Promise<SqlJsStatic>;

      if (!initSqlJs) {
        reject(new Error("sql.js did not load correctly"));
        return;
      }

      initSqlJs({ locateFile: () => SQL_JS_WASM_CDN })
        .then(resolve)
        .catch(reject);
    };
    script.onerror = () => reject(new Error("Failed to load sql.js from CDN"));
    document.head.appendChild(script);
  });

  return sqlJsPromise;
}

let db: SqlJsDatabase | null = null;

export async function initDB(file: File | ArrayBuffer): Promise<void> {
  const SQL = await loadSqlJs();

  const buffer =
    file instanceof File
      ? new Uint8Array(await file.arrayBuffer())
      : new Uint8Array(file);

  if (db) {
    db.close();
  }

  db = new SQL.Database(buffer);
}

export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function isOpen(): boolean {
  return db !== null;
}

function getDB(): SqlJsDatabase {
  if (!db) throw new Error("Database not loaded");
  return db;
}

export function getRuns(filter?: { status?: string }): UnwindRun[] {
  const d = getDB();
  let query = "SELECT * FROM runs";
  const params: string[] = [];

  if (filter?.status) {
    query += " WHERE status = ?";
    params.push(filter.status);
  }

  query += " ORDER BY created_at DESC";

  const stmt = d.prepare(query);
  if (params.length) stmt.bind(params);

  const runs: UnwindRun[] = [];

  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    runs.push({
      id: row.id as string,
      agentId: row.agent_id as string,
      parentRunId: (row.parent_run_id as string) || undefined,
      forkFromStep:
        row.fork_from_step != null ? Number(row.fork_from_step) : undefined,
      status: row.status as RunStatus,
      events: [],
      createdAt: row.created_at as string,
      completedAt: (row.completed_at as string) || undefined,
    });
  }

  stmt.free();

  for (const run of runs) {
    run.events = getEvents(run.id);
  }

  return runs;
}

export function getRun(id: string): UnwindRun | null {
  const d = getDB();
  const stmt = d.prepare("SELECT * FROM runs WHERE id = ?");
  stmt.bind([id]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();

  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    parentRunId: (row.parent_run_id as string) || undefined,
    forkFromStep:
      row.fork_from_step != null ? Number(row.fork_from_step) : undefined,
    status: row.status as RunStatus,
    events: getEvents(id),
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) || undefined,
  };
}

export function getEvents(runId: string): UnwindEvent[] {
  const d = getDB();
  const stmt = d.prepare(
    "SELECT data FROM events WHERE run_id = ? ORDER BY step_index ASC"
  );
  stmt.bind([runId]);

  const events: UnwindEvent[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { data: string };
    events.push(JSON.parse(row.data) as UnwindEvent);
  }

  stmt.free();
  return events;
}

export function getRunCount(filter?: { status?: string }): number {
  const d = getDB();
  let query = "SELECT COUNT(*) as cnt FROM runs";
  const params: string[] = [];

  if (filter?.status) {
    query += " WHERE status = ?";
    params.push(filter.status);
  }

  const stmt = d.prepare(query);
  if (params.length) stmt.bind(params);
  stmt.step();
  const row = stmt.getAsObject() as { cnt: number };
  stmt.free();
  return row.cnt;
}
