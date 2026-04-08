import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Store } from "../store";
import type { Scheduler } from "../scheduler";
import type { ActiveTask } from "../types";
import { COMPLETED_ACK, DROP_ACK } from "../prompts";
import { send } from "../send";

export async function handleCompleted(
  sdk: IMessageSDK,
  store: Store,
  scheduler: Scheduler,
  phone: string,
  task: ActiveTask
): Promise<void> {
  scheduler.cancel(phone);
  scheduler.cancel(`${phone}:repng`);

  store.patch(phone, { status: "completed" });

  await send(sdk, phone, COMPLETED_ACK(task.title));
}

export async function handleDrop(
  sdk: IMessageSDK,
  store: Store,
  scheduler: Scheduler,
  phone: string,
  task: ActiveTask
): Promise<void> {
  scheduler.cancel(phone);
  scheduler.cancel(`${phone}:repng`);

  store.patch(phone, { status: "dropped" });

  await send(sdk, phone, DROP_ACK(task.title));
}
