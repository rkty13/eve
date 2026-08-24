/**
 * Framework-shipped endpoint behind `createWebhook()` in authored workflow
 * bodies.
 *
 * `createWebhook()` mints `<deployment>/.well-known/workflow/v1/webhook/<token>`,
 * the Workflow SDK's conventional path, so external systems a tool hands the
 * URL to can call back without knowing anything about eve. The handler resumes
 * the hook with the request itself; the SDK serializes it so the body reads a
 * `Request` and owns the response semantics.
 */

import { HookNotFoundError } from "#compiled/@workflow/errors/index.js";

import { resumeWebhook } from "#internal/workflow/runtime.js";
import type { ChannelMethod, RouteContext } from "#public/definitions/channel.js";
import type { ResolvedChannelDefinition } from "#runtime/types.js";
import { walkCauseChain } from "#shared/errors.js";

export const WORKFLOW_WEBHOOK_ROUTE_PATTERN = "/.well-known/workflow/v1/webhook/:token";

const WORKFLOW_WEBHOOK_CHANNEL_NAME_PREFIX = "workflow/webhook";

const HANDLED_METHODS: readonly ChannelMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function getWorkflowWebhookChannelDefinitions(): readonly ResolvedChannelDefinition[] {
  return HANDLED_METHODS.map((method) => {
    const name = `${WORKFLOW_WEBHOOK_CHANNEL_NAME_PREFIX}/${method.toLowerCase()}`;
    return {
      name,
      method,
      urlPath: WORKFLOW_WEBHOOK_ROUTE_PATTERN,
      fetch: handleWorkflowWebhookRequest,
      logicalPath: `framework://channels/${name}`,
      sourceId: `eve:framework:workflow-webhook-${method.toLowerCase()}`,
      sourceKind: "module",
    };
  });
}

export function getWorkflowWebhookChannelNames(): ReadonlySet<string> {
  return new Set(getWorkflowWebhookChannelDefinitions().map((definition) => definition.name));
}

export async function handleWorkflowWebhookRequest(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const token = ctx.params.token;
  if (typeof token !== "string" || token.length === 0) {
    return Response.json({ error: "Missing webhook token.", ok: false }, { status: 400 });
  }

  try {
    return await resumeWebhook(token, request);
  } catch (error) {
    for (const candidate of walkCauseChain(error)) {
      if (HookNotFoundError.is(candidate)) {
        return Response.json({ error: "Webhook not pending.", ok: false }, { status: 404 });
      }
    }
    throw error;
  }
}
