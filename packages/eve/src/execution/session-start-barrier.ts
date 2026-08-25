import { createHook, type Hook } from "#compiled/@workflow/core/index.js";

import { claimHookOwnership } from "#execution/hook-ownership.js";

export type SessionStartBarrierPayload = { readonly ready: true };

export function sessionStartBarrierToken(sessionId: string): string {
  return `${sessionId}:start`;
}

/** Blocks the first turn until the channel finishes its required session setup. */
export async function waitForSessionStart(sessionId: string): Promise<void> {
  const barrier: Hook<SessionStartBarrierPayload> = createHook({
    token: sessionStartBarrierToken(sessionId),
  });
  const iterator = barrier[Symbol.asyncIterator]();
  await claimHookOwnership(barrier);
  await iterator.next();
}
