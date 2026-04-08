# Unfinished Business — Implementation Spec

An iMessage-native accountability agent built on the Photon iMessage Kit. One active task per user, commitment-driven check-ins, escalating tone, and micro-task fallbacks until the work is done.

---

## Platform: Photon iMessage Kit

This agent runs on **macOS** using `@photon-ai/imessage-kit` (open-source, zero-dep on Bun) or `@photon-ai/advanced-imessage-kit` for production.

- All messaging goes through Photon's SDK — no direct AppleScript or sqlite access.
- Message watching uses the polling-based `startWatching()` listener (~2s interval).
- Scheduling is done in-process with `setTimeout`/`node-cron` since Photon has no built-in scheduler.
- State is persisted in a local SQLite database (separate from iMessage's own db).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Bun (zero-dep for iMessage Kit) |
| Language | TypeScript |
| Messaging | `@photon-ai/imessage-kit` |
| Intent parsing | Claude API (`claude-haiku-4-5-20251001` for speed) |
| State store | SQLite via `bun:sqlite` |
| Scheduler | `node-cron` |
| Time parsing | `chrono-node` (natural language → Date) |

---

## Project Structure

```
iphoton_application/
├── src/
│   ├── index.ts              # Entry point — init SDK, start watcher
│   ├── agent.ts              # Core message router
│   ├── intents.ts            # Intent classification via Claude
│   ├── handlers/
│   │   ├── newTask.ts        # Handle new task creation
│   │   ├── commitment.ts     # Handle time commitment parsing
│   │   ├── checkin.ts        # Handle check-in responses
│   │   ├── excuse.ts         # Handle excuse + micro-task offer
│   │   └── completion.ts     # Handle task completion
│   ├── scheduler.ts          # Schedule and cancel check-ins
│   ├── store.ts              # SQLite state layer
│   ├── prompts.ts            # Response copy, tone levels
│   └── types.ts              # Shared TypeScript types
├── data/
│   └── tasks.db              # SQLite file (gitignored)
├── .env                      # API keys
├── package.json
├── tsconfig.json
└── IMPLEMENTATION.md
```

---

## Data Model

One row per user in `tasks` table, keyed by phone number (normalized E.164).

```sql
CREATE TABLE tasks (
  phone         TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'committed' | 'in_progress' | 'completed' | 'dropped'
  commitment_time TEXT,           -- ISO 8601 UTC
  checkin_time    TEXT,           -- ISO 8601 UTC, when next ping fires
  attempts        INTEGER DEFAULT 0,
  last_excuse     TEXT,
  tone_level      INTEGER DEFAULT 1,  -- 1 (warm) → 4 (blunt)
  last_checkin    TEXT,           -- ISO 8601 UTC
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
```

JSON equivalent (for reference in code):

```ts
interface ActiveTask {
  phone: string;
  title: string;
  status: "pending" | "committed" | "in_progress" | "completed" | "dropped";
  commitment_time: string | null;   // ISO 8601
  checkin_time: string | null;      // ISO 8601
  attempts: number;
  last_excuse: string | null;
  tone_level: 1 | 2 | 3 | 4;
  last_checkin: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Intent Classification

Each incoming message is classified into one of these intents by calling Claude haiku with a short system prompt. Classification is cheap and fast (<100ms target).

| Intent | Example Inputs |
|---|---|
| `NEW_TASK` | "finish OS homework", "go to the gym today" |
| `SET_COMMITMENT` | "5pm", "in 30 minutes", "after dinner" |
| `COMPLETED` | "done", "finished", "completed it", "I did it" |
| `NOT_STARTED` | "no", "not yet", "haven't started" |
| `EXCUSE` | "tired", "busy", "I forgot", "something came up" |
| `MICRO_COMMITMENT` | "20 min now", "just 10 minutes", "small version" |
| `PUSH_TIME` | "push to 8pm", "later tonight", "tomorrow morning" |
| `UNKNOWN` | anything else |

**Classification prompt** (sent to Claude):

```
You are classifying a user message into one intent category for an accountability agent.
The user has an active task: "{task_title}" (status: {status}).

Categories:
- NEW_TASK: user is defining a new task to track
- SET_COMMITMENT: user is naming a time or duration to start
- COMPLETED: user says they finished the task
- NOT_STARTED: user says they haven't started yet
- EXCUSE: user gives a reason for not doing it
- MICRO_COMMITMENT: user offers to do a small piece now
- PUSH_TIME: user asks to reschedule to a specific later time
- UNKNOWN: none of the above

Message: "{message}"

Respond with ONLY the category name, nothing else.
```

If the user has no active task, `SET_COMMITMENT`/`NOT_STARTED`/`EXCUSE`/etc. default to `NEW_TASK`.

---

## Message Flow

### 1. New Task

```
User  → "finish OS homework"
Agent ← "Got it — finish OS homework. When are you starting?"

[status: pending, tone_level: 1]
```

### 2. Set Commitment

```
User  → "5pm"
Agent ← "Locked in for 5:00 PM. I'll check in then."

[status: committed, commitment_time: today@17:00, checkin fires at 17:00]
```

### 3. Check-in fires (scheduler calls agent)

```
Agent → "Hey — it's 5. Did you start on finish OS homework?"
[status: committed → in_progress check pending, attempts++]
```

### 4a. Completed

```
User  → "done"
Agent ← "Done. That's it — finish OS homework checked off."

[status: completed, task cleared]
```

### 4b. Not started

```
User  → "not yet"
Agent ← "What got in the way?"

[status unchanged, waiting for excuse]
```

### 5. Excuse

```
User  → "tired"
Agent ← "Fair. Do you want to push it, or just do 20 min now?"

[tone_level++, last_excuse saved]
```

### 6a. Micro-commitment

```
User  → "20 min now"
Agent ← "Start now. I'll check back in 20 minutes."

[checkin scheduled in 20min, status: in_progress]
```

### 6b. Push time

```
User  → "push to 8pm"
Agent ← "Alright. 8:00 PM then. No more pushes."

[commitment_time updated, checkin rescheduled, tone_level++]
```

### Escalation (tone_level 3–4)

```
[attempts >= 3, tone_level: 3]
Agent → "You've pushed this twice. 20 minutes. That's it. Starting now?"

[attempts >= 4, tone_level: 4]
Agent → "You set this task. It's not going away. Start now or drop it."
```

---

## Tone Levels

| Level | Tone | Used When |
|---|---|---|
| 1 | Warm, supportive | First interaction, first check-in |
| 2 | Direct, no-fluff | First miss / first excuse |
| 3 | Firm, minimal empathy | 2nd+ miss |
| 4 | Blunt, binary | 3rd+ miss or 3+ hours elapsed |

Tone level is injected into Claude's system prompt for response generation. Copy variants for each tone are also available as static strings in `prompts.ts` for common messages (check-in pings, commitment confirmations) to avoid LLM latency on simple responses.

---

## Scheduler

The scheduler manages a map of `phone → TimeoutHandle`. On server restart, all `committed` and `in_progress` tasks are reloaded from SQLite and their check-ins are rescheduled relative to the stored `checkin_time`.

```ts
// scheduler.ts
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleCheckin(phone: string, at: Date, agent: Agent) {
  cancelCheckin(phone);
  const delay = at.getTime() - Date.now();
  if (delay <= 0) {
    agent.doCheckin(phone);
    return;
  }
  pending.set(phone, setTimeout(() => agent.doCheckin(phone), delay));
}

export function cancelCheckin(phone: string) {
  const t = pending.get(phone);
  if (t) clearTimeout(t);
  pending.delete(phone);
}
```

For tasks with commitments far in the future (>24h), use `node-cron` to periodically re-evaluate rather than a single long `setTimeout`.

---

## Photon SDK Integration

### Initialization (`src/index.ts`)

```ts
import { IMessageKit } from "@photon-ai/imessage-kit";
import { Agent } from "./agent";
import { Store } from "./store";
import { Scheduler } from "./scheduler";

const kit = new IMessageKit({ logLevel: "info" });
const store = new Store("./data/tasks.db");
const scheduler = new Scheduler();
const agent = new Agent(kit, store, scheduler);

// Restore pending check-ins after restart
await agent.restoreSchedules();

kit.startWatching({
  onMessage: async (message) => {
    if (message.isGroupChat) return;        // DMs only
    if (!message.isUnread) return;          // skip already-read
    await agent.handleMessage(message);
  },
});
```

### Sending messages

All outbound messages go through a single `send()` wrapper in `agent.ts` so we can log, rate-limit, and add typing delay in one place:

```ts
async function send(phone: string, text: string) {
  await kit.send(phone, text);
}
```

Use `sendReaction()` for immediate acknowledgment on receipt (thumbs-up tapback) before the agent processes and replies — makes the interaction feel snappier.

---

## Claude API Integration

Used for:
1. **Intent classification** — haiku, ~50 tokens, <100ms
2. **Response generation** — haiku (tone levels 1–2) or sonnet (tone 3–4 for more nuanced escalation)
3. **Time parsing fallback** — when `chrono-node` can't parse the commitment string

```ts
// intents.ts
import Anthropic from "@anthropic-ai/sdk";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function classifyIntent(
  message: string,
  task: ActiveTask | null
): Promise<Intent> {
  const res = await claude.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 20,
    messages: [{ role: "user", content: buildClassifyPrompt(message, task) }],
  });
  return parseIntent(res.content[0].text.trim());
}
```

---

## Environment Variables

```
# .env
ANTHROPIC_API_KEY=sk-ant-...
PHOTON_LOG_LEVEL=info         # debug | info | warn | error
DB_PATH=./data/tasks.db
```

---

## Implementation Steps

### Phase 1 — Scaffold

1. `bun init` in project root
2. Install deps: `@photon-ai/imessage-kit`, `@anthropic-ai/sdk`, `chrono-node`, `node-cron`
3. Create `src/types.ts` — `ActiveTask`, `Intent`, `Message` types
4. Create `src/store.ts` — SQLite init, CRUD for `tasks` table
5. Smoke-test: `kit.send(yourPhone, "hello")` fires successfully

### Phase 2 — Core Loop

6. `src/intents.ts` — Claude haiku classifier, tested against all 8 intent types
7. `src/handlers/newTask.ts` — create row, reply asking for commitment
8. `src/handlers/commitment.ts` — parse time with chrono-node, schedule check-in
9. `src/scheduler.ts` — setTimeout-based scheduler with cancel/restore
10. `src/agent.ts` — wire up `startWatching` → classify → dispatch to handler

### Phase 3 — Check-in Loop

11. `src/handlers/checkin.ts` — `doCheckin()` sends ping, increments `attempts`
12. `src/handlers/excuse.ts` — empathetic reply + offer push/micro-task
13. `src/handlers/completion.ts` — mark complete, clear task, send ack
14. Tone escalation — inject `tone_level` into response prompts, increment on each miss

### Phase 4 — Polish

15. `src/prompts.ts` — static copy for common messages (avoids LLM on simple cases)
16. Restart recovery — on boot, load all non-completed tasks, reschedule
17. `PUSH_TIME` handler — re-parse time, reschedule, increment tone
18. Drop/abandon path — after tone_level 4 with no response for 12h, send final message and mark `dropped`
19. Rate-limiting guard — debounce rapid messages from same user

---

## Edge Cases

| Scenario | Handling |
|---|---|
| User sends new task while one is active | Ask: "You still have X. Done with that?" |
| Commitment time already passed | Reply: "That's in the past. When can you actually start?" |
| chrono-node can't parse time | Fallback to Claude to extract time, or ask user to clarify |
| No response to check-in for 30 min | Re-ping once with short escalation |
| No response to re-ping for 2h | Escalate tone, reschedule to next natural window (e.g. evening) |
| Server restart mid-task | Restore from SQLite on boot, recalculate delays |
| User says "drop it" / "cancel" | Mark `dropped`, clear active task, brief ack |

---

## Tone Copy Examples (`prompts.ts`)

```ts
export const CHECK_IN: Record<number, (title: string) => string> = {
  1: (t) => `Hey — it's time. Did you start on "${t}"?`,
  2: (t) => `Check-in: "${t}" — started?`,
  3: (t) => `You said you'd do "${t}". Did you?`,
  4: (t) => `"${t}". Did you do it. Yes or no.`,
};

export const COMMITMENT_ACK = (time: string) =>
  `Locked in for ${time}. I'll check in then.`;

export const COMPLETED_ACK = (title: string) =>
  `Done. ${title} — checked off.`;

export const MICRO_START = (minutes: number) =>
  `Start now. I'll check back in ${minutes} minutes.`;
```

---

## Non-Goals (v1)

- No group chat support (DMs only)
- No multi-task tracking (one active task per user)
- No web dashboard or admin UI
- No push notifications or rich iMessage extensions (plain text only)
- No persistent history / analytics beyond current task state
