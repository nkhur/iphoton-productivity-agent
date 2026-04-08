import type { IMessageSDK, Message } from "@photon-ai/imessage-kit";
import type { Store } from "./store";
import type { Scheduler } from "./scheduler";
import { classifyIntent } from "./intents";
import { handleNewTask } from "./handlers/newTask";
import { handleSetCommitment, handlePushTime } from "./handlers/commitment";
import { handleNotStarted, handleExcuse, handleMicroCommitment } from "./handlers/excuse";
import { handleCompleted, handleDrop } from "./handlers/completion";
import { doCheckin as _doCheckin } from "./handlers/checkin";
import { NO_TASK_PROMPT, TASK_CONFLICT } from "./prompts";
import { send } from "./send";

export class Agent {
  private sdk: IMessageSDK;
  private store: Store;
  private scheduler: Scheduler;

  // Debounce: track last-handled message timestamp per phone to avoid double-processing
  private lastHandled = new Map<string, number>();

  constructor(sdk: IMessageSDK, store: Store, scheduler: Scheduler) {
    this.sdk = sdk;
    this.store = store;
    this.scheduler = scheduler;
  }

  /**
   * Entry point called by the Photon watcher for every incoming DM.
   */
  async handleMessage(message: Message): Promise<void> {
    if (message.isFromMe) return;
    if (message.isReaction) return;
    if (!message.text?.trim()) return;

    const phone = message.sender;
    const text = message.text.trim();
    const msgTime = message.date.getTime();

    // Debounce: skip if we handled a message from this user in the last 500ms
    const last = this.lastHandled.get(phone) ?? 0;
    if (msgTime - last < 500) return;
    this.lastHandled.set(phone, msgTime);

    const task = this.store.getTask(phone);
    const intent = await classifyIntent(text, task);

    console.log(`[agent] ${phone} | intent=${intent} | text="${text}"`);

    // Cancel any outstanding re-ping since user is actively responding
    this.scheduler.cancel(`${phone}:repng`);

    switch (intent) {
      case "NEW_TASK":
        await handleNewTask(this.sdk, this.store, phone, text, task);
        break;

      case "SET_COMMITMENT":
        if (!task) {
          await send(this.sdk, phone, NO_TASK_PROMPT());
        } else {
          await handleSetCommitment(
            this.sdk,
            this.store,
            this.scheduler,
            phone,
            text,
            task,
            (p) => this.doCheckin(p)
          );
        }
        break;

      case "COMPLETED":
        if (!task) {
          await send(this.sdk, phone, NO_TASK_PROMPT());
        } else {
          await handleCompleted(this.sdk, this.store, this.scheduler, phone, task);
        }
        break;

      case "NOT_STARTED":
        if (!task) {
          await send(this.sdk, phone, NO_TASK_PROMPT());
        } else {
          await handleNotStarted(this.sdk, phone);
        }
        break;

      case "EXCUSE":
        if (!task) {
          await send(this.sdk, phone, NO_TASK_PROMPT());
        } else {
          await handleExcuse(this.sdk, this.store, phone, text, task);
        }
        break;

      case "MICRO_COMMITMENT":
        if (!task) {
          await send(this.sdk, phone, NO_TASK_PROMPT());
        } else {
          await handleMicroCommitment(
            this.sdk,
            this.store,
            this.scheduler,
            phone,
            text,
            task,
            (p) => this.doCheckin(p)
          );
        }
        break;

      case "PUSH_TIME":
        if (!task) {
          await send(this.sdk, phone, NO_TASK_PROMPT());
        } else {
          await handlePushTime(
            this.sdk,
            this.store,
            this.scheduler,
            phone,
            text,
            task,
            (p) => this.doCheckin(p)
          );
        }
        break;

      case "DROP":
        if (!task) {
          await send(this.sdk, phone, NO_TASK_PROMPT());
        } else {
          await handleDrop(this.sdk, this.store, this.scheduler, phone, task);
        }
        break;

      case "UNKNOWN":
      default:
        if (!task) {
          await send(this.sdk, phone, NO_TASK_PROMPT());
        } else {
          // Nudge: still waiting for a response in context
          await this.sdk.send(
            phone,
            `Still tracking "${task.title}". Started, done, or need to push?`
          );
        }
        break;
    }
  }

  /**
   * Proactive check-in fired by the scheduler.
   * Called with only the phone number — looks up the task internally.
   */
  async doCheckin(phone: string): Promise<void> {
    await _doCheckin(
      this.sdk,
      this.store,
      this.scheduler,
      phone,
      (p) => this.doCheckin(p)
    );
  }

  /**
   * On startup: reload all tasks that had pending check-ins and reschedule them.
   */
  async restoreSchedules(): Promise<void> {
    const tasks = this.store.getPendingTasks();
    let restored = 0;

    for (const task of tasks) {
      if (!task.checkin_time) continue;

      const at = new Date(task.checkin_time);
      this.scheduler.schedule(task.phone, at, (p) => this.doCheckin(p));
      restored++;
    }

    if (restored > 0) {
      console.log(`[agent] restored ${restored} pending check-in(s)`);
    }
  }
}
