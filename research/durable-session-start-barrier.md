---
issue: "2521"
status: implemented
last_updated: "2026-08-25"
---

# Durable session-start barrier

## Summary

Applications sometimes need eve's minted session ID before they can persist an authorization binding. Existing lifecycle callbacks are observe-only, so the create response and first stream can outrun that write.

Add an opt-in `beforeSessionStart` callback to `eveChannel`. The workflow claims its durable session and continuation identities, then waits before dispatching the first turn. The create route runs the callback and releases the workflow only after it succeeds.

## Authoring API

```ts
eveChannel({
  auth,
  async beforeSessionStart({ auth, request, sessionId }) {
    await registerSession({ auth, request, sessionId });
  },
});
```

## Semantics

- The callback receives the session auth selected by `onMessage` and the minted durable session ID.
- The first turn and create response remain blocked until the callback succeeds.
- Failure leaves the workflow gated and returns an error without exposing the session ID.
- A create-once replay reruns the callback and releases the existing session without dispatching its first input twice.
- Callbacks must be idempotent because recovery can repeat them after a crash between the external write and gate release.

## Client recovery

The lower-level client accepts `operationId` on session creation. `useEveAgent` generates one per pending new session and retains it after a failed create, so the next create attempt addresses the same durable operation.
