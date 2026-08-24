import { jsonSchema } from "ai";
import { describe, expect, it } from "vitest";

import type { HarnessToolDefinition } from "#harness/execute-tool.js";
import {
  applyCodeModeTool,
  CODE_MODE_TOOL_NAME,
  DESCRIBE_TOOLS_NAME,
  SEARCH_TOOLS_NAME,
} from "#harness/code-mode-sandbox.js";
import { buildToolSet } from "#harness/tools.js";
import type { HarnessToolMap } from "#harness/types.js";
import { never } from "#public/tools/approval/approval-helpers.js";
import { unwrapWorkflowSandboxResult } from "#shared/workflow-sandbox.js";

const continuationSecurity = { signingKey: "code-mode-sandbox-test-key" };

function sampleTools(): HarnessToolMap {
  return new Map<string, HarnessToolDefinition>([
    [
      "get_weather",
      {
        description: "Get the weather for a city.",
        execute: async (input: { readonly city: string }) => ({ city: input.city, tempC: 21 }),
        inputSchema: jsonSchema({
          properties: { city: { type: "string" } },
          required: ["city"],
          type: "object",
        }),
        name: "get_weather",
      },
    ],
    [
      "send_email",
      {
        description: "Send an email.",
        execute: async () => "sent",
        inputSchema: jsonSchema({ type: "object" }),
        name: "send_email",
      },
    ],
    [
      "safe_write",
      {
        approval: never(),
        description: "A write that never requires approval.",
        execute: async () => "written",
        inputSchema: jsonSchema({ type: "object" }),
        name: "safe_write",
      },
    ],
    [
      "researcher",
      {
        description: "Delegate to the researcher subagent.",
        inputSchema: jsonSchema({ type: "object" }),
        name: "researcher",
        runtimeAction: {
          kind: "subagent-call",
          nodeId: "subagents/researcher",
          subagentName: "researcher",
        },
      },
    ],
    [
      "dangerous_write",
      {
        approval: () => "user-approval" as const,
        description: "A write that requires approval.",
        execute: async () => "written",
        inputSchema: jsonSchema({ type: "object" }),
        name: "dangerous_write",
      },
    ],
  ]);
}

describe("applyCodeModeTool", () => {
  it("demotes claimed tools out of the direct surface", async () => {
    const harnessTools = sampleTools();
    const flatTools = buildToolSet({ tools: harnessTools });
    const { modelTools } = await applyCodeModeTool({
      continuationSecurity,
      harnessTools,
      mode: "eager",
      tools: flatTools,
    });

    expect(modelTools[CODE_MODE_TOOL_NAME]).toBeDefined();
    // Claimed tools leave the direct model surface: sandbox-only.
    expect(modelTools.get_weather).toBeUndefined();
    expect(modelTools.send_email).toBeUndefined();
    expect(modelTools.safe_write).toBeUndefined();
    // Unclaimed tools stay direct.
    expect(modelTools.researcher).toBeDefined();
    expect(modelTools.dangerous_write).toBeDefined();

    const description =
      (modelTools[CODE_MODE_TOOL_NAME] as { description?: string }).description ?? "";
    // Plain executable tools are in the sandbox surface.
    expect(description).toContain("get_weather");
    expect(description).toContain("send_email");
    expect(description).toContain("safe_write");
    // Delegations and approval-gated tools are not.
    expect(description).not.toContain("researcher");
    expect(description).not.toContain("dangerous_write");
  });

  it("inlines signatures in eager mode", async () => {
    const harnessTools = sampleTools();
    const { modelTools } = await applyCodeModeTool({
      continuationSecurity,
      harnessTools,
      mode: "eager",
      tools: buildToolSet({ tools: harnessTools }),
    });

    const description =
      (modelTools[CODE_MODE_TOOL_NAME] as { description?: string }).description ?? "";
    expect(description).toContain("declare const tools:");
    expect(description).toContain("city");
    expect(description).not.toContain(SEARCH_TOOLS_NAME);
  });

  it("lists names only and adds discovery tools in lazy mode", async () => {
    const harnessTools = sampleTools();
    const { modelTools } = await applyCodeModeTool({
      continuationSecurity,
      harnessTools,
      mode: "lazy",
      tools: buildToolSet({ tools: harnessTools }),
    });

    const description =
      (modelTools[CODE_MODE_TOOL_NAME] as { description?: string }).description ?? "";
    expect(description).toContain(SEARCH_TOOLS_NAME);
    expect(description).toContain(DESCRIBE_TOOLS_NAME);
    expect(description).toContain("get_weather");
    // The inline per-tool signature listing is gone: no input schema details.
    expect(description).not.toContain("city");
    // Discovery tools are sandbox-internal, not direct model tools.
    expect(modelTools[SEARCH_TOOLS_NAME]).toBeUndefined();
    expect(modelTools[DESCRIBE_TOOLS_NAME]).toBeUndefined();
  });

  it("executes generated code against bridged host tools", async () => {
    const harnessTools = sampleTools();
    const { modelTools } = await applyCodeModeTool({
      continuationSecurity,
      harnessTools,
      mode: "eager",
      tools: buildToolSet({ tools: harnessTools }),
    });

    const codeModeTool = modelTools[CODE_MODE_TOOL_NAME] as {
      execute?: (input: unknown, options: unknown) => Promise<unknown>;
    };
    const raw = await codeModeTool.execute?.(
      { js: "const w = await tools.get_weather({ city: 'lisbon' }); return w.tempC + 1;" },
      {},
    );
    const result = await unwrapWorkflowSandboxResult(raw, continuationSecurity);
    expect(result).toEqual({ output: 22, status: "completed" });
  });

  it("reports nested host calls through lifecycle hooks", async () => {
    const harnessTools = sampleTools();
    const calls: Array<{ readonly input: unknown; readonly toolName: string }> = [];
    const results: Array<{ readonly output?: unknown; readonly toolName: string }> = [];
    const { modelTools } = await applyCodeModeTool({
      continuationSecurity,
      harnessTools,
      lifecycle: {
        onNestedToolCall(event) {
          calls.push({ input: event.input, toolName: event.toolName });
        },
        onNestedToolResult(event) {
          results.push({
            ...(event.status === "fulfilled" ? { output: event.output } : {}),
            toolName: event.toolName,
          });
        },
      },
      mode: "eager",
      tools: buildToolSet({ tools: harnessTools }),
    });

    const codeModeTool = modelTools[CODE_MODE_TOOL_NAME] as {
      execute?: (input: unknown, options: unknown) => Promise<unknown>;
    };
    await codeModeTool.execute?.(
      { js: "return await tools.get_weather({ city: 'lisbon' });" },
      { toolCallId: "code-mode-1" },
    );

    expect(calls).toEqual([{ input: { city: "lisbon" }, toolName: "get_weather" }]);
    expect(results).toEqual([{ output: { city: "lisbon", tempC: 21 }, toolName: "get_weather" }]);
  });

  it("supports runtime discovery from generated code in lazy mode", async () => {
    const harnessTools = sampleTools();
    const { modelTools } = await applyCodeModeTool({
      continuationSecurity,
      harnessTools,
      mode: "lazy",
      tools: buildToolSet({ tools: harnessTools }),
    });

    const codeModeTool = modelTools[CODE_MODE_TOOL_NAME] as {
      execute?: (input: unknown, options: unknown) => Promise<unknown>;
    };
    const raw = await codeModeTool.execute?.(
      {
        js: `
          const hits = await tools.${SEARCH_TOOLS_NAME}({ query: "weather" });
          const specs = await tools.${DESCRIBE_TOOLS_NAME}({ names: hits.map((h) => h.name) });
          return { hits, hasSchema: specs[0].inputSchema !== undefined };
        `,
      },
      {},
    );
    const result = await unwrapWorkflowSandboxResult(raw, continuationSecurity);
    expect(result).toEqual({
      output: {
        hasSchema: true,
        hits: [{ description: "Get the weather for a city.", name: "get_weather" }],
      },
      status: "completed",
    });
  });

  it("adds no tool when nothing is sandboxable", async () => {
    const harnessTools: HarnessToolMap = new Map<string, HarnessToolDefinition>([
      [
        "researcher",
        {
          description: "Delegate to the researcher subagent.",
          inputSchema: jsonSchema({ type: "object" }),
          name: "researcher",
          runtimeAction: {
            kind: "subagent-call",
            nodeId: "subagents/researcher",
            subagentName: "researcher",
          },
        },
      ],
    ]);
    const flatTools = buildToolSet({ tools: harnessTools });
    const { modelTools } = await applyCodeModeTool({
      continuationSecurity,
      harnessTools,
      mode: "eager",
      tools: flatTools,
    });

    expect(modelTools[CODE_MODE_TOOL_NAME]).toBeUndefined();
    expect(modelTools.researcher).toBeDefined();
  });
});
