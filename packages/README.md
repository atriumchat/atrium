# packages

Shared code for the clients, as npm workspaces. Apps import a package by its name (`@atrium/…`), only through its
`index.ts`; dependencies point down: `ui-common` ← `ui-web` / `ui-native` ← apps, `setup` ← apps.
See [ADR-001](../docs/adr/001-client-architecture.md).
