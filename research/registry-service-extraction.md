---
issue: TBD
status: proposed
last_updated: "2026-08-21"
---

# Registry service extraction

## Goal

Give registry discovery one eve-owned implementation that can be reused by:

- `eve registry list/search/view`;
- `eve add`;
- the dev TUI's `/add` flow;
- `@eve/self-modification` discovery; and
- a development-only self-modification tool that installs a registry item after
  explicit user approval.

`@eve/self-modification` is a separately published package, so it needs a narrow
public entrypoint rather than private CLI imports or its own parser for the
official index. The public surface should serve these concrete read and tool
adapter use cases without exposing a general project-mutation API.

This extraction is not required for the initial guided self-modification
handoff. Until it lands, self-modification can search the official index and ask
the developer to type `/add <address>` manually.

## Current architecture

Most registry behavior lives in `packages/eve/src/cli/commands/registry.ts`.

The module currently combines:

1. address and source resolution for the official registry, configured
   namespaces, direct URLs, the built-in skills registry, and the development
   official-registry override;
2. multi-registry search, partial errors, metadata enrichment, sorting, and
   limits;
3. manifest interpretation, component selection, eve version requirements, and
   setup metadata;
4. project mutation through the vendored shadcn registry client; and
5. CLI-specific prompting, logging, NDJSON, terminal detection, and exit state.

The setup flow and package helpers add TUI rendering, confirmation, setup fact
aggregation, project preparation, and deployment follow-up.

## Thin wrapper over shadcn registries

eve uses the shadcn registry protocol and vendored client. The client already
provides the core address-oriented operations:

```ts
searchRegistries(sources, options);
getRegistryItems(addresses, options);
addRegistryItems(addresses, options);
```

The extracted code should remain a thin eve-specific wrapper around those
operations. eve adds only behavior the generic client cannot know:

- built-in and project registry configuration;
- official-source classification;
- eve metadata, version requirements, and package components;
- official-only setup eligibility;
- project preparation required by eve items; and
- adaptation to CLI, TUI, and tool interaction.

`addRegistryItems` means “install these addressed items into a project”; it does
not publish an item to a registry and is not itself a public eve API.

## Proposed boundary

### Public discovery

Add a narrow `eve/registry` package export for the separately published
self-modification package:

```ts
import { searchRegistryItems } from "eve/registry";

const result = await searchRegistryItems({
  appRoot,
  query: "browser",
  category: "extension",
  limit: 10,
  signal,
});
```

The self-modification caller searches the official registry only.

## Development self-modification tools

The extension exposes two narrow tools:

- `selfmod__search_registry` searches the official catalog through the public
  read API; and
- `selfmod__add_registry` accepts an official registry address and installs it
  into the current development project after mandatory tool approval.

### Why not expose the eve binary

The self-modification sandbox deliberately cannot execute host binaries. Giving
it raw access to `eve` would expose much more than registry operations,
including project configuration, linking, deployment, and other commands. Even
`eve add` accepts flags and sources that can install third-party files and
packages, run setup, or weaken an informed approval boundary.

The typed adapter instead exposes one address, applies source and flag policy in
trusted code, derives the application root from runtime state, and returns a
bounded structured result. It reuses the same underlying registry behavior as
`eve add` without making the complete CLI a model capability.

### Tool lifecycle

The development add flow is:

1. The model finds an official item with `selfmod__search_registry` and calls
   `selfmod__add_registry({ address })`.
2. eve requests standard tool approval. The user sees the tool name and registry
   address; the model cannot approve its own call.
3. The adapter reports installed addresses, known changed paths, partial failure,
   and whether interactive setup remains.

## Interactive setup handoff

The tool never runs registry-declared setup. This avoids trying to drive setup
questions, project selection, browser authentication, device codes, or external
actions inside an active model tool call.

When an installed item declares setup, the result instructs the user to run:

```text
/add <address> --skip-install
```

For example, after installing Slack, the TUI shows that the item was added but
still requires setup and prompts the developer to run:

```text
/add channel/slack --skip-install
```

That command enters the existing TUI-owned interactive setup flow, which can
open the browser, show authentication instructions, collect answers, handle
cancellation, and report deployment follow-up. Extend `/add` argument parsing to
recognize `--skip-install` and route it to setup without reinstalling files or
packages. The model must not invoke the continuation itself or claim setup is
complete before the developer finishes it.

Items without declared setup complete in the original tool call. Clients that
cannot present tool approval retain the manual `/add <address>` handoff and do
not expose `selfmod__add_registry`.

## Future TUI-mediated setup

A later development flow may keep the self-modification tool call open while the
TUI conducts setup on its behalf. This would support setup that requires several
answers, browser authentication, a device code, project selection, or another
external action.

Treat this as a host interaction protocol rather than registry logic or direct
TUI access for the subagent:

1. The approved add tool installs the item and emits a correlated setup request.
2. The harness parks the tool call and forwards trusted setup events to a client
   that advertised the corresponding capability.
3. The TUI renders questions and external actions through its existing setup
   components. Browser URLs and device codes come from trusted setup execution,
   not model-authored text.
4. Authenticated user responses route back to the pending setup operation. The
   model cannot answer, alter, or mark a request complete.
5. Completion, cancellation, timeout, disconnect, or partial failure settles the
   original tool call, after which the development host refreshes as needed.

The protocol must use versioned request identities, reject stale or duplicate
responses, preserve delegated-session routing, serialize setup with source edits
and other project mutation, and recheck the responding principal. Capability
negotiation is required because remote clients and older TUIs may not support
these interactions; they continue to receive the explicit
`/add <address> --skip-install` handoff.

Do not add these hooks to the initial tool adapter. Design them when a concrete
setup flow shows that the manual continuation is insufficient, and keep setup
rendering and browser behavior in the TUI rather than `eve/registry` or
`@eve/self-modification`.

## Future production API

A production executor would apply an approved item to an isolated proposal
checkout without a connected TUI. That may require a public mutation surface
supporting an explicit application root, noninteractive policy, stronger
content binding, cancellation, and structured changed-path and partial-failure
results.

Do not finalize that surface here. Production authorization, sandboxing,
egress, package lifecycle policy, integrity, diff validation, and pull request
publication must be designed with the executor. First decide whether the
executor can remain inside eve and reuse internal operations.

## Completion criteria

This extraction is complete when:

- registry source, search, manifest, and installation semantics are not
  reimplemented by each adapter;
- `eve registry`, `eve add`, and `/add` preserve their existing behavior;
- self-modification discovery uses the public read API rather than a private
  catalog parser;
- the development add tool installs official items only after explicit user
  approval and never exposes the raw eve binary;
- interactive setup is resumed explicitly through
  `/add <address> --skip-install`;
- the internal layer remains a thin wrapper over the vendored shadcn client; and
- no general public mutation API is introduced without a concrete production
  caller.
