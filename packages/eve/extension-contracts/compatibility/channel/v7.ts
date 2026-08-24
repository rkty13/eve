import { defineChannel, POST } from "#public/channels/index.js";

export default defineChannel({
  state: { threadId: null as string | null },
  metadata(state) {
    return { audience: "private", threadId: state.threadId };
  },
  events: {
    "actions.requested"(event) {
      for (const action of event.actions) {
        if (action.kind === "tool-call") {
          console.info("tool requested", { callId: action.callId, toolName: action.toolName });
        }
      }
    },
  },
  routes: [
    POST("/input", async (_request, { from }) => {
      await from("thread-1").respond([{ optionId: "approve", requestId: "approval-1" }], {
        auth: null,
      });
      return new Response("ok");
    }),
  ],
  turnPolicy: "queue",
});
