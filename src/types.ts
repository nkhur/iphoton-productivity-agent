export type TaskStatus =
  | "pending"       // task set, no commitment yet
  | "committed"     // commitment time set, waiting for check-in
  | "in_progress"   // micro-commitment active
  | "completed"
  | "dropped";

export type ToneLevel = 1 | 2 | 3 | 4;

export type Intent =
  | "NEW_TASK"
  | "SET_COMMITMENT"
  | "COMPLETED"
  | "NOT_STARTED"
  | "EXCUSE"
  | "MICRO_COMMITMENT"
  | "PUSH_TIME"
  | "DROP"
  | "UNKNOWN";

export interface ActiveTask {
  phone: string;
  title: string;
  status: TaskStatus;
  commitment_time: string | null;   // ISO 8601
  checkin_time: string | null;      // ISO 8601 — when next ping fires
  attempts: number;
  last_excuse: string | null;
  tone_level: ToneLevel;
  last_checkin: string | null;      // ISO 8601
  created_at: string;
  updated_at: string;
}
