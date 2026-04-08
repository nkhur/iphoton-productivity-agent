import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { ActiveTask, TaskStatus, ToneLevel } from "./types";

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        phone           TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        commitment_time TEXT,
        checkin_time    TEXT,
        attempts        INTEGER DEFAULT 0,
        last_excuse     TEXT,
        tone_level      INTEGER DEFAULT 1,
        last_checkin    TEXT,
        estimated_hours REAL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      )
    `);
    // Backfill column for databases created before estimated_hours was added
    try {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN estimated_hours REAL`);
    } catch {
      // Column already exists — ignore
    }
  }

  /** Returns the active task for a phone number (excludes completed/dropped). */
  getTask(phone: string): ActiveTask | null {
    const row = this.db
      .prepare(
        "SELECT * FROM tasks WHERE phone = ? AND status NOT IN ('completed', 'dropped')"
      )
      .get(phone) as ActiveTask | undefined;
    return row ?? null;
  }

  /** Insert or fully replace a task row. */
  upsertTask(task: ActiveTask): void {
    this.db
      .prepare(
        `INSERT INTO tasks
           (phone, title, status, commitment_time, checkin_time, attempts,
            last_excuse, tone_level, last_checkin, estimated_hours, created_at, updated_at)
         VALUES
           (@phone, @title, @status, @commitment_time, @checkin_time, @attempts,
            @last_excuse, @tone_level, @last_checkin, @estimated_hours, @created_at, @updated_at)
         ON CONFLICT(phone) DO UPDATE SET
           title           = excluded.title,
           status          = excluded.status,
           commitment_time = excluded.commitment_time,
           checkin_time    = excluded.checkin_time,
           attempts        = excluded.attempts,
           last_excuse     = excluded.last_excuse,
           tone_level      = excluded.tone_level,
           last_checkin    = excluded.last_checkin,
           estimated_hours = excluded.estimated_hours,
           updated_at      = excluded.updated_at`
      )
      .run(task);
  }

  /** Patch specific fields on an existing task row. */
  patch(
    phone: string,
    fields: Partial<
      Pick<
        ActiveTask,
        | "status"
        | "commitment_time"
        | "checkin_time"
        | "attempts"
        | "last_excuse"
        | "tone_level"
        | "last_checkin"
        | "estimated_hours"
        | "title"
      >
    >
  ): void {
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...fields, updated_at: now, phone };
    const setClauses = Object.keys(updates)
      .filter((k) => k !== "phone")
      .map((k) => `${k} = @${k}`)
      .join(", ");
    this.db.prepare(`UPDATE tasks SET ${setClauses} WHERE phone = @phone`).run(updates);
  }

  /** All tasks that have a scheduled check-in and are not yet done. */
  getPendingTasks(): ActiveTask[] {
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE status IN ('committed', 'in_progress') AND checkin_time IS NOT NULL"
      )
      .all() as ActiveTask[];
  }

  close(): void {
    this.db.close();
  }
}
