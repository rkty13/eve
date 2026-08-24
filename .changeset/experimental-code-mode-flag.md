---
"eve": patch
---

Add `experimental.codeMode` to the agent config. Setting it to `"eager"` or `"lazy"` runs the agent's ordinary executable tools through a `code_mode` sandbox tool instead of direct tool calls: the model writes JavaScript that calls them as `tools.name(input)` inside an isolated sandbox, and the sandboxed tools leave the direct model surface. `"eager"` inlines every sandboxed tool signature in the tool description; `"lazy"` lists names only and generated code discovers signatures at runtime via in-sandbox `search_tools`/`describe_tools`. Subagent delegations, approval-gated tools, background tools, and control-plane tools never enter the sandbox and stay directly callable.
