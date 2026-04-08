import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Store } from "../store";
import type { ActiveTask } from "../types";
import { TONE_SYSTEM } from "../prompts";
import { generateExcuseResponse } from "../intents";
import { send } from "../send";

/**
 * User gave an excuse OR said "not yet" — skip asking why and immediately
 * offer options: push time or start a small version now.
 */
export async function handleExcuse(
  sdk: IMessageSDK,
  store: Store,
  phone: string,
  excuse: string,
  task: ActiveTask
): Promise<void> {
  // Cancel the re-ping since user is responding
  store.patch(phone, { last_excuse: excuse });

  const toneInstruction = TONE_SYSTEM[task.tone_level];
  const reply = await generateExcuseResponse(excuse, task, toneInstruction);

  await send(sdk, phone, reply);
}

/**
 * User committed to a micro-task right now (e.g. "20 min").
 * Parse the duration and schedule a short check-in.
 */
export async function handleMicroCommitment(
  sdk: IMessageSDK,
  store: Store,
  scheduler: import("../scheduler").Scheduler,
  phone: string,
  messageText: string,
  task: ActiveTask,
  doCheckin: (phone: string) => void
): Promise<void> {
  // Extract the number of minutes from the message
  const match = messageText.match(/(\d+)\s*min/i);
  const minutes = match ? parseInt(match[1], 10) : 20;
  const checkinAt = new Date(Date.now() + minutes * 60 * 1000);

  store.patch(phone, {
    status: "in_progress",
    checkin_time: checkinAt.toISOString(),
  });

  scheduler.schedule(phone, checkinAt, doCheckin);

  const { MICRO_START } = await import("../prompts");
  await send(sdk, phone, MICRO_START(minutes));
}
