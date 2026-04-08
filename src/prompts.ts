import type { ToneLevel } from "./types";

/** Static check-in pings by tone level. */
export const CHECK_IN: Record<ToneLevel, (title: string) => string> = {
  1: (t) => `Hey — it's time. Did you start on "${t}"?`,
  2: (t) => `Check-in: "${t}" — started?`,
  3: (t) => `You said you'd do "${t}". Did you?`,
  4: (t) => `"${t}". Did you do it. Yes or no.`,
};

/** Re-ping when user doesn't respond within 30 min. */
export const REping: Record<ToneLevel, (title: string) => string> = {
  1: (t) => `Still here. "${t}" — any progress?`,
  2: (t) => `Checking back — did you start "${t}"?`,
  3: (t) => `No response. "${t}" — done or not?`,
  4: (t) => `"${t}". Answer.`,
};

export const COMMITMENT_ACK = (time: string): string =>
  `Locked in for ${time}. I'll check in then.`;

export const COMPLETED_ACK = (title: string): string =>
  `Done. ${title} — checked off.`;

export const MICRO_START = (minutes: number): string =>
  `Start now. I'll check back in ${minutes} minutes.`;

export const PUSH_ACK: Record<ToneLevel, (time: string) => string> = {
  1: (t) => `Alright. ${t} then.`,
  2: (t) => `Pushed to ${t}. That's it.`,
  3: (t) => `${t}. Last push.`,
  4: (t) => `${t}. No more after this.`,
};

export const ASK_COMMITMENT = (): string => `When are you starting?`;

export const ASK_WHY = (): string => `What got in the way?`;

export const NO_TASK_PROMPT = (): string =>
  `No active task. What do you need to get done?`;

export const TASK_CONFLICT = (existingTitle: string): string =>
  `You still have "${existingTitle}" going. Done with that, or replacing it?`;

export const DROP_ACK = (title: string): string =>
  `"${title}" dropped. What's next?`;

export const PAST_TIME_PROMPT = (): string =>
  `That time has already passed. When can you actually start?`;

export const UNPARSEABLE_TIME = (): string =>
  `I didn't get that time. Try something like "5pm", "in 30 minutes", or "9am tomorrow".`;

export const FINAL_ESCALATION = (title: string): string =>
  `"${title}" has been sitting for a while. You can either commit to a time right now, or drop it. What's it going to be?`;

/** System prompt fragment injected into Claude calls based on tone level. */
export const TONE_SYSTEM: Record<ToneLevel, string> = {
  1: "You are supportive and warm. Empathize briefly, then offer options concisely.",
  2: "You are direct and no-nonsense. Skip empathy, get to the point in one sentence.",
  3: "You are firm. Minimal empathy. Two options only: push the time or do a small version now.",
  4: "You are blunt. Binary framing only. One short sentence.",
};
