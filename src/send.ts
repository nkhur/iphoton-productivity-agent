import type { IMessageSDK } from "@photon-ai/imessage-kit";

/** All outgoing messages go through here — enforces lowercase. */
export async function send(sdk: IMessageSDK, phone: string, text: string): Promise<void> {
  await sdk.send(phone, text.toLowerCase());
}
