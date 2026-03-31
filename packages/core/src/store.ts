import Database from "better-sqlite3";
import type { RunStatus, UnwindEvent, UnwindRun } from "./types.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EventStore {
  createRun(run: Omit<UnwindRun, "events">): void;
  appendEvent(runId: string, event: UnwindEvent): void;
  getRun(runId: string): UnwindRun | null;
  getEvents(runId: string): UnwindEvent[];
  listRuns(filter?: { status?: RunStatus }): UnwindRun[];
  updateRunStatus(runId: string, status: RunStatus): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// SQLite implementation
// ---------------------------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id            TEXT PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    parent_run_id TEXT,
    fork_from_step INTEGER,
    status        TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    completed_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    event_id   TEXT PRIMARY KEY,
    run_id     TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    timestamp  TEXT NOT NULL,
    data       TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
  CREATE INDEX IF NOT EXISTS idx_events_step   ON events(run_id, step_index);
  CREATE INDEX IF NOT EXISTS idx_runs_status   ON runs(status);
`;

export class SQLiteEventStore implements EventStore {
  private db: Database.Database;

  constructor(path: string = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  createRun(run: Omit<UnwindRun, "events">): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, agent_id, parent_run_id, fork_from_step, status, created_at, completed_at)
         VALUES (@id, @agentId, @parentRunId, @forkFromStep, @status, @createdAt, @completedAt)`
      )
      .run({
        id: run.id,
        agentId: run.agentId,
        parentRunId: run.parentRunId ?? null,
        forkFromStep: run.forkFromStep ?? null,
        status: run.status,
        createdAt: run.createdAt,
        completedAt: run.completedAt ?? null,
      });
  }

  appendEvent(runId: string, event: UnwindEvent): void {
    this.db
      .prepare(
        `INSERT INTO events (event_id, run_id, step_index, timestamp, data)
         VALUES (@eventId, @runId, @stepIndex, @timestamp, @data)`
      )
      .run({
        eventId: event.eventId,
        runId,
        stepIndex: event.stepIndex,
        timestamp: event.timestamp,
        data: JSON.stringify(event),
      });
  }

  getRun(runId: string): UnwindRun | null {
    const row = this.db
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(runId) as RunRow | undefined;

    if (!row) return null;

    return {
      ...rowToRun(row),
      events: this.getEvents(runId),
    };
  }

  getEvents(runId: string): UnwindEvent[] {
    const rows = this.db
      .prepare("SELECT data FROM events WHERE run_id = ? ORDER BY step_index ASC")
      .all(runId) as { data: string }[];

    return rows.map((r) => JSON.parse(r.data) as UnwindEvent);
  }

  listRuns(filter?: { status?: RunStatus }): UnwindRun[] {
    let query = "SELECT * FROM runs";
    const params: unknown[] = [];

    if (filter?.status) {
      query += " WHERE status = ?";
      params.push(filter.status);
    }

    query += " ORDER BY created_at DESC";

    const rows = this.db.prepare(query).all(...params) as RunRow[];
    return rows.map((row) => ({ ...rowToRun(row), events: [] }));
  }

  updateRunStatus(runId: string, status: RunStatus): void {
    const completedAt =
      status === "completed" || status === "failed" || status === "compensated" || status === "partially_compensated"
        ? new Date().toISOString()
        : null;

    this.db
      .prepare("UPDATE runs SET status = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?")
      .run(status, completedAt, runId);
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  agent_id: string;
  parent_run_id: string | null;
  fork_from_step: number | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

function rowToRun(row: RunRow): Omit<UnwindRun, "events"> {
  return {
    id: row.id,
    agentId: row.agent_id,
    parentRunId: row.parent_run_id ?? undefined,
    forkFromStep: row.fork_from_step ?? undefined,
    status: row.status as RunStatus,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}
