import "dotenv/config";
import { IMessageSDK, loggerPlugin } from "@photon-ai/imessage-kit";
import { Store } from "./store";
import { Scheduler } from "./scheduler";
import { Agent } from "./agent";

const DB_PATH = process.env.DB_PATH ?? "./data/tasks.db";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Copy .env.example → .env and fill it in.");
    process.exit(1);
  }

  const sdk = new IMessageSDK({
    debug: process.env.NODE_ENV !== "production",
    plugins: [loggerPlugin({ level: "info", logNewMessage: true })],
    watcher: {
      pollInterval: 2000,
      unreadOnly: false,
      excludeOwnMessages: false,
    },
  });

  const store = new Store(DB_PATH);
  const scheduler = new Scheduler();
  const agent = new Agent(sdk, store, scheduler);

  // Restore any check-ins that were scheduled before a restart
  await agent.restoreSchedules();

  // Start listening for incoming DMs
  await sdk.startWatching({
    onDirectMessage: async (message) => {
      try {
        console.log("RAW MESSAGE:", message);
        await agent.handleMessage(message);
      } catch (err) {
        console.error("[index] unhandled error in handleMessage:", err);
      }
    },
    onError: (err) => {
      console.error("[index] watcher error:", err);
    },
  });

  console.log("Unfinished Business agent is running. Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    scheduler.cancelAll();
    await sdk.close();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
