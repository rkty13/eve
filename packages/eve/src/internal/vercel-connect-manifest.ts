export const VERCEL_CONNECT_MANIFEST_FILENAME = "vercel-connect-manifest.json";
export const VERCEL_CONNECT_MANIFEST_KIND = "vercel-connect-manifest";
export const VERCEL_CONNECT_MANIFEST_SCHEMA_VERSION = 1;

export interface VercelConnectRequirement {
  readonly target: { readonly mode: "direct"; readonly locator: string };
  readonly connector: { readonly type: string };
  readonly resource?: { readonly protocol: "mcp" | "openapi"; readonly url: string };
  readonly access: { readonly principalTypes: readonly ("app" | "user")[] };
  readonly triggers?: readonly { readonly method: string; readonly path: string }[];
  readonly uses: readonly { readonly kind: "channel" | "connection"; readonly name: string; readonly logicalPath: string }[];
}

export interface VercelConnectManifest {
  readonly kind: typeof VERCEL_CONNECT_MANIFEST_KIND;
  readonly schemaVersion: typeof VERCEL_CONNECT_MANIFEST_SCHEMA_VERSION;
  readonly generator: { readonly name: "eve"; readonly version: string };
  readonly requirements: readonly VercelConnectRequirement[];
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
