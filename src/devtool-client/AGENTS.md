# DevTool Agent entrypoint

Applies to this browser subtree. Before editing, read the [frontend README](README.md) for structure, route/state ownership, i18n and styling; root instructions continue to apply.

- For component/API/theme work, use the existing [Ant Design Skill](../../.agents/skills/antd/SKILL.md) with the version installed in this project. Query APIs before coding and lint changed component files afterward.
- For RPC changes, follow the [dependency rules](../../docs/architecture.md#dependency-and-state-rules) and trace [server definitions](../devtool.ts), the owning hook/controller and presentation.
- Follow the [validation matrix](../../docs/development.md#validation). Include browser interaction evidence for UI behavior; build/RPC tests alone do not prove it. Update the frontend README when its documented behavior changes.
