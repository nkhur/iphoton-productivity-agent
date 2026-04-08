import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Store } from "../store";
import type { Scheduler } from "../scheduler";
import { CHECK_IN, REping } from "../prompts";
import { send } from "../send";

const RE_PING_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours

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

  // Schedule one re-ping if user goes silent for 2 hours
  const rePingAt = new Date(now.getTime() + RE_PING_DELAY_MS);
  scheduler.schedule(`${phone}:repng`, rePingAt, () =>
    handleSilence(sdk, store, phone)
  );
}

/**
 * Fires if user does not respond 2 hours after a check-in.
 * One re-ping, tone escalates, then silence until next natural check-in.
 */
async function handleSilence(
  sdk: IMessageSDK,
  store: Store,
  phone: string
): Promise<void> {
  const task = store.getTask(phone);
  if (!task) return;

  const newTone = Math.min(4, task.tone_level + 1) as 1 | 2 | 3 | 4;
  store.patch(phone, { tone_level: newTone });

  await send(sdk, phone, REping[newTone](task.title));
}
