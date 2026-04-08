import * as chrono from "chrono-node";
import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Store } from "../store";
import type { Scheduler } from "../scheduler";
import type { ActiveTask } from "../types";
import {
  COMMITMENT_ACK,
  PAST_TIME_PROMPT,
  UNPARSEABLE_TIME,
  ASK_COMMITMENT,
} from "../prompts";
import { extractTimeWithClaude } from "../intents";
import { send } from "../send";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export async function handleSetCommitment(
  sdk: IMessageSDK,
  store: Store,
  scheduler: Scheduler,
  phone: string,
  messageText: string,
  task: ActiveTask,
  doCheckin: (phone: string) => void
): Promise<void> {
  if (!task) {
    // No active task — ask them to set one first
    await send(sdk,phone, `No active task. What do you need to get done?`);
    return;
  }

  // Try chrono-node first
  let commitDate: Date | null = chrono.parseDate(messageText, new Date(), {
    forwardDate: true,
  });

  // Fallback to Claude
  if (!commitDate) {
    const iso = await extractTimeWithClaude(messageText);
    commitDate = iso ? new Date(iso) : null;
  }

  if (!commitDate) {
    await send(sdk,phone, UNPARSEABLE_TIME());
    return;
  }

  if (commitDate.getTime() <= Date.now()) {
    await send(sdk,phone, PAST_TIME_PROMPT());
    return;
  }

  store.patch(phone, {
    status: "committed",
    commitment_time: commitDate.toISOString(),
    checkin_time: commitDate.toISOString(),
  });

  scheduler.schedule(phone, commitDate, doCheckin);
  scheduleAdvanceReminder(sdk, scheduler, phone, task, commitDate);

  await send(sdk, phone, COMMITMENT_ACK(formatTime(commitDate)));
}

/**
 * Handles a PUSH_TIME request — reschedule an existing commitment.
 */
export async function handlePushTime(
  sdk: IMessageSDK,
  store: Store,
  scheduler: Scheduler,
  phone: string,
  messageText: string,
  task: ActiveTask,
  doCheckin: (phone: string) => void
): Promise<void> {
  let newDate: Date | null = chrono.parseDate(messageText, new Date(), {
    forwardDate: true,
  });

  if (!newDate) {
    const iso = await extractTimeWithClaude(messageText);
    newDate = iso ? new Date(iso) : null;
  }

  if (!newDate || newDate.getTime() <= Date.now()) {
    await send(sdk,
      phone,
      newDate
        ? PAST_TIME_PROMPT()
        : UNPARSEABLE_TIME()
    );
    return;
  }

  const newTone = Math.min(4, task.tone_level + 1) as 1 | 2 | 3 | 4;

  store.patch(phone, {
    commitment_time: newDate.toISOString(),
    checkin_time: newDate.toISOString(),
    tone_level: newTone,
    status: "committed",
  });

  scheduler.schedule(phone, newDate, doCheckin);
  scheduleAdvanceReminder(sdk, scheduler, phone, task, newDate);

  const PUSH_MSGS: Record<number, (t: string) => string> = {
    1: (t) => `Alright. ${t} then.`,
    2: (t) => `Pushed to ${t}. That's it.`,
    3: (t) => `${t}. Last push.`,
    4: (t) => `${t}. No more after this.`,
  };

  await send(sdk, phone, PUSH_MSGS[newTone](formatTime(newDate)));
}

/**
 * If the task has an estimated duration, schedule a heads-up reminder
 * that many hours before the commitment time.
 */
function scheduleAdvanceReminder(
  sdk: IMessageSDK,
  scheduler: Scheduler,
  phone: string,
  task: ActiveTask,
  commitDate: Date
): void {
  if (!task.estimated_hours || task.estimated_hours <= 0) return;

  const reminderAt = new Date(
    commitDate.getTime() - task.estimated_hours * 60 * 60 * 1000
  );

  if (reminderAt.getTime() <= Date.now()) return; // not enough lead time

  scheduler.schedule(`${phone}:remind`, reminderAt, async () => {
    const label =
      task.estimated_hours === 1
        ? "1 hour"
        : `${task.estimated_hours}h`;
    await send(
      sdk,
      phone,
      `heads up — "${task.title}" is at ${formatTime(commitDate)}. you said it takes ~${label}. time to start.`
    );
  });
}
