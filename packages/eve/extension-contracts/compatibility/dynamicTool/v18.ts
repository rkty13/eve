import { z as z3 } from "zod/v3";

import { defineDynamic, defineTool } from "#public/tools/index.js";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      defineTool({
        description: "Echo the tool call identifiers.",
        inputSchema: z3.object({ note: z3.string() }),
        execute: ({ note }, toolCtx) => ({
          callId: toolCtx.callId,
          note,
          sessionId: ctx.session.id,
          toolName: toolCtx.toolName,
        }),
      }),
  },
});
