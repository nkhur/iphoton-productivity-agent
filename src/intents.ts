import Anthropic from "@anthropic-ai/sdk";
import type { ActiveTask, Intent } from "./types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_INTENTS = new Set<Intent>([
  "NEW_TASK",
  "SET_COMMITMENT",
  "COMPLETED",
  "NOT_STARTED",
  "EXCUSE",
  "MICRO_COMMITMENT",
  "PUSH_TIME",
  "DROP",
  "UNKNOWN",
]);

function buildPrompt(message: string, task: ActiveTask | null): string {
  const taskContext = task
    ? `The user has an active task: "${task.title}" (status: ${task.status}, attempts: ${task.attempts}).`
    : "The user has NO active task.";

  return `You are classifying a user message for an accountability agent.
${taskContext}

Categories:
- NEW_TASK: user defines a new task they want to track
- SET_COMMITMENT: user names a start time or duration (e.g. "5pm", "in 30 minutes", "after dinner")
- COMPLETED: user says they finished the task (e.g. "done", "finished", "I did it")
- NOT_STARTED: user admits they haven't started yet (e.g. "no", "not yet", "nope")
- EXCUSE: user gives a reason for not doing it (e.g. "tired", "busy", "I forgot")
- MICRO_COMMITMENT: user offers to do a small piece right now (e.g. "20 min now", "just 10 minutes")
- PUSH_TIME: user asks to reschedule to a later time (e.g. "push to 8pm", "tomorrow morning")
- DROP: user wants to cancel/abandon the task (e.g. "drop it", "cancel", "forget it")
- UNKNOWN: none of the above

Message: "${message}"

Respond with ONLY the category name, nothing else.`;
}

export async function classifyIntent(
  message: string,
  task: ActiveTask | null
): Promise<Intent> {
  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [{ role: "user", content: buildPrompt(message, task) }],
    });

    const raw = (res.content[0].type === "text" ? res.content[0].text : "")
      .trim()
      .toUpperCase() as Intent;

    return VALID_INTENTS.has(raw) ? raw : "UNKNOWN";
  } catch (err) {
    console.error("[intents] classification failed:", err);
    return "UNKNOWN";
  }
}

/**
 * Generate a tone-aware excuse response using Claude.
 * Returns the assistant reply to send to the user.
 */
export async function generateExcuseResponse(
  excuse: string,
  task: ActiveTask,
  toneInstruction: string
): Promise<string> {
  const prompt = `The user is trying to complete a task: "${task.title}".
They gave this excuse for not doing it: "${excuse}".
Attempts so far: ${task.attempts}.

${toneInstruction}

Offer exactly two options in your reply:
1. Push the task to a later time
2. Do a small version right now (e.g. "20 min")

Keep the entire reply under 2 sentences. Do not use bullet points.`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0].type === "text"
      ? res.content[0].text.trim()
      : "Fair. Do you want to push it, or do 20 min now?";
  } catch {
    return "Fair. Do you want to push it, or do 20 min now?";
  }
}

/**
 * Use Claude to extract a Date from a free-form time expression when chrono-node fails.
 * Returns ISO string or null.
 */
export async function extractTimeWithClaude(
  expression: string
): Promise<string | null> {
  const now = new Date().toISOString();
  const prompt = `Current time: ${now}
Time expression: "${expression}"

Extract the absolute date and time this expression refers to.
Respond with ONLY an ISO 8601 datetime string (e.g. "2026-04-06T17:00:00") or "null" if unresolvable.`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 30,
      messages: [{ role: "user", content: prompt }],
    });
    const text =
      res.content[0].type === "text" ? res.content[0].text.trim() : "null";
    if (text === "null") return null;
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}
