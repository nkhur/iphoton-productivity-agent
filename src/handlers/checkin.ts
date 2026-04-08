import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Store } from "../store";
import type { Scheduler } from "../scheduler";
import type { ActiveTask } from "../types";
import { CHECK_IN, REping, FINAL_ESCALATION } from "../prompts";
import { send } from "../send";

const RE_PING_DELAY_MS = 30 * 60 * 1000;    // 30 minutes
const LONG_SILENCE_MS  = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Fires when the scheduled check-in timer expires.
 * Sends the check-in message and increments attempts.
 */
export async function doCheckin(
  sdk: IMessageSDK,
  store: Store,
  scheduler: Scheduler,
  phone: string,
  doCheckinCallback: (phone: string) => void
): Promise<void> {
  const task = store.getTask(phone);
  if (!task) return;

  const now = new Date();
  const newAttempts = task.attempts + 1;
  const tone = task.tone_level;

  store.patch(phone, {
    attempts: newAttempts,
    last_checkin: now.toISOString(),
  });

  await send(sdk, phone, CHECK_IN[tone](task.title));

  // Schedule a re-ping if user goes silent
  const rePingAt = new Date(now.getTime() + RE_PING_DELAY_MS);
  scheduler.schedule(`${phone}:repng`, rePingAt, () =>
    handleSilence(sdk, store, scheduler, phone, doCheckinCallback)
  );
}

/**
 * Fires if user does not respond 30 minutes after a check-in.
 */
async function handleSilence(
  sdk: IMessageSDK,
  store: Store,
  scheduler: Scheduler,
  phone: string,
  doCheckinCallback: (phone: string) => void
): Promise<void> {
  const task = store.getTask(phone);
  if (!task) return;

  const tone = task.tone_level;
  const lastCheckin = task.last_checkin ? new Date(task.last_checkin) : null;
  const elapsed = lastCheckin ? Date.now() - lastCheckin.getTime() : 0;

  if (elapsed >= LONG_SILENCE_MS) {
    // 2h silence — final escalation
    await send(sdk, phone, FINAL_ESCALATION(task.title));
    // Escalate tone and reschedule far-off check-in (2h from now)
    const newTone = Math.min(4, tone + 1) as 1 | 2 | 3 | 4;
    const nextAt = new Date(Date.now() + LONG_SILENCE_MS);
    store.patch(phone, {
      tone_level: newTone,
      checkin_time: nextAt.toISOString(),
    });
    scheduler.schedule(phone, nextAt, doCheckinCallback);
  } else {
    // 30-min re-ping
    await send(sdk, phone, REping[tone](task.title));
  }
}
