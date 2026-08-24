export const VERCEL_CONNECT_MANIFEST_FILENAME = "vercel-connect-manifest.json";
export const VERCEL_CONNECT_MANIFEST_KIND = "vercel-connect-manifest";
export const VERCEL_CONNECT_MANIFEST_SCHEMA_VERSION = 1;

export interface VercelConnectRequirement {
  readonly target: { readonly mode: "direct"; readonly locator: string };
  readonly connector: { readonly type: string };
  readonly resource?: { readonly protocol: "mcp" | "openapi"; readonly url: string };
  readonly access: { readonly principalTypes: readonly ("app" | "user")[] };
  readonly triggers?: readonly { readonly method: string; readonly path: string }[];
  readonly uses: readonly {
    readonly kind: "channel" | "connection";
    readonly name: string;
    readonly logicalPath: string;
  }[];
}

export interface VercelConnectManifest {
  readonly kind: typeof VERCEL_CONNECT_MANIFEST_KIND;
  readonly schemaVersion: typeof VERCEL_CONNECT_MANIFEST_SCHEMA_VERSION;
  readonly generator: { readonly name: "eve"; readonly version: string };
  readonly requirements: readonly VercelConnectRequirement[];
}

import type { CompiledAgentManifest, CompiledChannelDefinition } from "#compiler/manifest.js";

export function buildVercelConnectRequirements(
  manifest: CompiledAgentManifest,
): readonly VercelConnectRequirement[] {
  return [
    ...manifest.connections.flatMap((connection) => {
      if (connection.vercelConnect === undefined) return [];
      return [
        {
          target: { mode: "direct" as const, locator: connection.vercelConnect.connector },
          connector: { type: connection.vercelConnect.connectorType },
          resource: { protocol: connection.protocol, url: connection.url },
          access: { principalTypes: connection.vercelConnect.principalTypes },
          uses: [
            {
              kind: "connection" as const,
              name: connection.connectionName,
              logicalPath: connection.logicalPath,
            },
          ],
        },
      ];
    }),
    ...manifest.channels.flatMap((channel) => toChannelRequirement(channel)),
  ];
}

function toChannelRequirement(
  channel:
    | CompiledChannelDefinition
    | Exclude<CompiledAgentManifest["channels"][number], CompiledChannelDefinition>,
): readonly VercelConnectRequirement[] {
  if (channel.kind !== "channel" || channel.vercelConnect === undefined) return [];
  return [
    {
      target: { mode: "direct", locator: channel.vercelConnect.connector },
      connector: { type: channel.vercelConnect.connectorType },
      access: { principalTypes: channel.vercelConnect.principalTypes },
      triggers: [{ method: channel.method, path: channel.urlPath }],
      uses: [{ kind: "channel", name: channel.name, logicalPath: channel.logicalPath }],
    },
  ];
}

export async function emitVercelConnectManifest(input: {
  readonly generatorVersion: string;
  readonly manifest: CompiledAgentManifest;
  readonly outputDirectory: string;
}): Promise<void> {
  const manifest = createVercelConnectManifest({
    generatorVersion: input.generatorVersion,
    requirements: buildVercelConnectRequirements(input.manifest),
  });
  if (manifest === undefined) return;
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(input.outputDirectory, { recursive: true });
  await writeFile(
    join(input.outputDirectory, VERCEL_CONNECT_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

export function createVercelConnectManifest(input: {
  readonly generatorVersion: string;
  readonly requirements: readonly VercelConnectRequirement[];
}): VercelConnectManifest | undefined {
  if (input.requirements.length === 0) return undefined;
  return {
    kind: VERCEL_CONNECT_MANIFEST_KIND,
    schemaVersion: VERCEL_CONNECT_MANIFEST_SCHEMA_VERSION,
    generator: { name: "eve", version: input.generatorVersion },
    requirements: input.requirements,
  };
}
