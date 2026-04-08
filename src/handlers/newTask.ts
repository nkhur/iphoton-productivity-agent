import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Store } from "../store";
import type { ActiveTask } from "../types";
import { ASK_COMMITMENT, TASK_CONFLICT } from "../prompts";
import { send } from "../send";
import { extractDurationHours } from "../intents";

export async function handleNewTask(
  sdk: IMessageSDK,
  store: Store,
  phone: string,
  messageText: string,
  existingTask: ActiveTask | null
): Promise<void> {
  if (existingTask) {
    // Conflict — user already has an active task
    await send(sdk, phone, TASK_CONFLICT(existingTask.title));
    return;
  }

  const now = new Date().toISOString();
  const estimatedHours = await extractDurationHours(messageText.trim());

  const task: ActiveTask = {
    phone,
    title: messageText.trim(),
    status: "pending",
    commitment_time: null,
    checkin_time: null,
    attempts: 0,
    last_excuse: null,
    tone_level: 1,
    last_checkin: null,
    estimated_hours: estimatedHours,
    created_at: now,
    updated_at: now,
  };

  store.upsertTask(task);
  await send(sdk, phone, `got it — ${task.title}. ${ASK_COMMITMENT()}`);
}
