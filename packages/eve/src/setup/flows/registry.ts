import type { RegistryCatalogItem } from "#cli/commands/registry.js";
import type { Prompter, SelectOption } from "#setup/prompter.js";
import { WizardCancelledError } from "#setup/step.js";
import { withSpinner } from "#setup/with-spinner.js";

import { createRegistrySession, type RegistrySessionResult } from "./registry-session.js";

type Item = RegistryCatalogItem;
export interface RegistryFlowDeps {
  browseRegistryCatalog: (typeof import("#cli/commands/registry.js"))["browseRegistryCatalog"];
  installRegistryItem: (typeof import("#cli/commands/registry.js"))["installRegistryItem"];
  detectDeployment: (typeof import("#setup/project-resolution.js"))["detectDeployment"];
  runDeployFlow: (typeof import("./deploy.js"))["runDeployFlow"];
}
const SECTIONS = {
  channels: {
    title: "Where should people reach your agent?",
    description: "You can add more later with /add.",
    featured: ["channel/web", "channel/slack", "channel/github", "channel/linear-agent"],
    includes: (item: Item) => item.name.startsWith("channel/"),
  },
  integrations: {
    title: "What should your agent be able to work with?",
    featured: [
      "extension/github-tools",
      "connection/linear",
      "connection/notion",
      "connection/vercel",
      "extension/agent-browser",
    ],
    includes: (item: Item) =>
      !item.name.startsWith("channel/") && !item.name.startsWith("experimental/"),
  },
} as const;

function label(item: Item): string {
  return item.title ?? item.name.split("/").at(-1) ?? item.name;
}

function sectionRows(
  section: keyof typeof SECTIONS,
  catalog: readonly Item[],
): SelectOption<string>[] {
  const featured = new Set<string>(SECTIONS[section].featured);
  return catalog.filter(SECTIONS[section].includes).map((item) => ({
    value: item.address,
    label: label(item),
    hint: item.description,
    ...(featured.has(item.name) ? { featured: true } : {}),
  }));
}

function selectedInSection(
  section: keyof typeof SECTIONS,
  catalog: readonly Item[],
  selected: ReadonlySet<string>,
): string[] {
  return catalog
    .filter((item) => SECTIONS[section].includes(item) && selected.has(item.address))
    .map((item) => item.address);
}

async function editSection(input: {
  section: keyof typeof SECTIONS;
  prompter: Prompter;
  catalog: readonly Item[];
  selected: Set<string>;
}): Promise<void> {
  const { section, catalog, prompter, selected } = input;
  const selectedAddresses = await prompter.select({
    message: SECTIONS[section].title,
    ...(section === "channels" ? { description: SECTIONS.channels.description } : {}),
    multiple: true,
    search: true,
    placeholder: section === "channels" ? "Search channels" : "Search integrations",
    initialValues: selectedInSection(section, catalog, selected),
    options: sectionRows(section, catalog),
  });
  for (const item of catalog) {
    if (!SECTIONS[section].includes(item)) continue;
    selected.delete(item.address);
  }
  for (const address of selectedAddresses) selected.add(address);
}

async function editPlan(input: {
  prompter: Prompter;
  catalog: readonly Item[];
  selected: Set<string>;
}): Promise<"install" | "cancelled"> {
  await editSection({ ...input, section: "channels" });
  await editSection({ ...input, section: "integrations" });
  if (input.selected.size === 0) return "install";
  const review = await input.prompter.select({
    message: "Review your agent",
    metadata: [...input.selected].map((address) => {
      const item = input.catalog.find((candidate) => candidate.address === address)!;
      return {
        label: item.name.startsWith("channel/") ? "Channel" : "Integration",
        value: label(item),
      };
    }),
    options: [
      { value: "install", label: "Install and set up" },
      { value: "back", label: "Start over" },
    ],
  });
  if (review === "install") return "install";
  input.selected.clear();
  return editPlan(input);
}

/** Collects a channel and integration plan, then installs every chosen item in order. */
export async function runRegistryFlow(input: {
  appRoot: string;
  prompter: Prompter;
  signal?: AbortSignal;
  onItemStart?: (item: Item, index: number, total: number) => void;
  deps?: Partial<RegistryFlowDeps>;
}): Promise<{ kind: "done"; result: RegistrySessionResult } | { kind: "cancelled" }> {
  try {
    const browseRegistryCatalog =
      input.deps?.browseRegistryCatalog ??
      (await import("#cli/commands/registry.js")).browseRegistryCatalog;
    const catalog = await withSpinner(input.prompter, "Loading registry…", () =>
      browseRegistryCatalog(input.appRoot),
    );
    const selected = new Set<string>();
    if (
      (await editPlan({ prompter: input.prompter, catalog: catalog.items, selected })) !== "install"
    )
      return { kind: "cancelled" };
    const detectDeployment =
      input.deps?.detectDeployment ??
      (await import("#setup/project-resolution.js")).detectDeployment;
    const runDeployFlow = input.deps?.runDeployFlow ?? (await import("./deploy.js")).runDeployFlow;
    const session = createRegistrySession({ detectDeployment, runDeployFlow });
    const install =
      input.deps?.installRegistryItem ??
      (await import("#cli/commands/registry.js")).installRegistryItem;
    const items = [...selected].map((address) =>
      catalog.items.find((item) => item.address === address)!,
    );
    for (const [index, item] of items.entries()) {
      input.onItemStart?.(item, index, items.length);
      try {
        const installed = await (input.prompter.withExclusiveTerminal?.(() =>
          install(input.appRoot, item.address, {
            silent: true,
            prompter: input.prompter,
            signal: input.signal,
          }),
        ) ??
          install(input.appRoot, item.address, {
            silent: true,
            prompter: input.prompter,
            signal: input.signal,
          }));
        session.add(item.address, label(item), installed.output, installed.setup);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail = message.split("\n").find((line) => line.trim() !== "");
        const fullDetail = error instanceof Error ? (error.stack ?? message) : message;
        const action = await input.prompter.select({
          message: `Couldn't add ${label(item)}`,
          ...(detail === undefined ? {} : { description: detail }),
          options: [
            { value: "skip", label: `Skip ${label(item)}` },
            { value: "cancel", label: "Cancel setup" },
          ],
        });
        session.addFailure(item.address, label(item), detail ?? "Installation failed.", fullDetail);
        if (action === "cancel") return { kind: "done", result: session.result() };
      }
    }
    const result = await session.continueAfterInstall({
      appRoot: input.appRoot,
      prompter: input.prompter,
      signal: input.signal,
    });
    return { kind: "done", result };
  } catch (error) {
    if (error instanceof WizardCancelledError) return { kind: "cancelled" };
    throw error;
  }
}
