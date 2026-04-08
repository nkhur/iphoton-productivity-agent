# Unfinished Business

An iMessage-native accountability agent built with [Photon iMessage Kit](https://github.com/photon-hq/imessage-kit).

Text it a task. Commit to a time. It checks in on you — and doesn't let go until you're done.

---

## How it works

One active task per user. The agent tracks it through a commitment loop:

```
You:   "finish my thesis outline"
Bot:   "got it — finish my thesis outline. when are you starting?"

You:   "6pm"
Bot:   "locked in for 6:00 pm. i'll check in then."

[6pm]
Bot:   "hey — it's time. did you start on "finish my thesis outline"?"

You:   "not yet"
Bot:   "okay — push it or do a bit now?"

You:   "20 min now"
Bot:   "start now. i'll check back in 20 minutes."

[20 min later]
Bot:   "check-in: "finish my thesis outline" — started?"

You:   "done"
Bot:   "done. finish my thesis outline — checked off."
```

If you go silent for 2 hours after a check-in, it pings once more. Tone escalates with each missed check-in. Tasks with a duration (e.g. "study for 2 hours") get an advance reminder before the committed time.

---

## Setup

**Requirements**
- macOS with Messages signed into iMessage
- Node.js 18+
- An Anthropic API key

**Install**

```bash
git clone <repo>
cd iphoton_application
npm install
```

**Configure**

```bash
cp .env.example .env
```

Edit `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
DB_PATH=./data/tasks.db
```

**Run**

```bash
npm start
```

The agent starts watching for incoming iMessages on whatever account is signed into the Mac's Messages app. Anyone who texts that iMessage address gets their own independent task loop.

---

## Deploying persistently

Use `pm2` to keep the process alive across restarts:

```bash
npm install -g pm2
pm2 start "npx ts-node src/index.ts" --name ub-agent
pm2 save
pm2 startup
```

---

## Architecture

```
src/
├── index.ts          # entry point — Photon watcher setup
├── agent.ts          # message router — classifies intent, dispatches handlers
├── intents.ts        # Claude haiku intent classifier + time/duration extraction
├── store.ts          # SQLite state — one row per user, keyed by phone/email
├── scheduler.ts      # setTimeout-based check-in scheduler
├── send.ts           # send wrapper (enforces lowercase on all outgoing messages)
├── prompts.ts        # static copy, tone-level variants
├── types.ts          # shared TypeScript types
└── handlers/
    ├── newTask.ts     # creates task, extracts estimated duration
    ├── commitment.ts  # parses time, schedules check-in + advance reminder
    ├── checkin.ts     # fires check-in, schedules 2h re-ping
    ├── excuse.ts      # handles "not yet" + excuses, offers push/micro-task
    └── completion.ts  # marks task done or dropped
```

**Intent classification** — every incoming message is classified into one of 9 intents by Claude haiku before routing. Static copy handles common responses; Claude generates excuse responses with tone scaling.

**Tone system** — 4 levels (warm → blunt), escalates on each missed check-in. Injected into Claude's system prompt for generated responses.

**Multi-user** — task state is keyed by `message.sender`. Any number of users can run simultaneous independent loops against the same bot address.

---

## Stack

| | |
|---|---|
| Messaging | `@photon-ai/imessage-kit` |
| Intent / response | Claude API (`claude-haiku-4-5-20251001`) |
| State | SQLite via `better-sqlite3` |
| Time parsing | `chrono-node` + Claude fallback |
| Language | TypeScript / Node.js |
