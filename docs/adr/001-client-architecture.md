# ADR-001: Atrium client architecture — a monorepo, the Atrium Flow design system and one "Your own server"

**Status:** Accepted, done (branch `onboarding`, 2026-10-22)
**Date:** 2026-10-21
**Deciders:** the project owner (networkfreedom)

[Русская версия](001-client-architecture.ru.md)

## Context

Atrium is a self-hosted Discord-like app for a group of friends. The server (FastAPI + SQLite, LiveKit, Caddy) installs
with one command on a 1 GB VPS. The clients:
- **web:** React, HeroUI v3, Tailwind v4, Vite;
- **mobile:** Expo SDK 58, React Native;
- **desktop:** Electron, a shell around the web client plus the app's own windows.

The team is the owner and an AI assistant.

**What happened.** A new visual language came in (DESIGN.md: OLED black, type instead of plates, a scale along the
screen's edge), and "Your own server" on three platforms. Before this decision:
- **The flow layer existed three times, each different.**
  - `web/src/ui/flow/` in React DOM, `mobile/src/components/Flow.tsx` in React Native, about 700 lines of hand-built
    DOM in `desktop/onboarding.js`.
  - The APIs had drifted: `onClick` against `onPress`, `aside` on the phone only, `FlowPrimary` on the web only.
  - The scale's geometry was copied three times; the components had colours written by hand.
- **"Your own server" logic was duplicated** between `mobile/app/own.tsx` and `desktop/onboarding.js`: different
  validations, different scales, their own task lists, mocks and `TURN_NAMES`. The first-run steps duplicated
  `web/src/account/SetupWizard.tsx`.
- **No infrastructure.**
  - No root `package.json`, no linter, no web tests.
  - Code crossed between apps through `../../web/src` and copying scripts.
  - CI only built Docker images on a release.

**Forces:**
- An outside developer should see an ordinary engineering structure in the code.
- A small team: simplicity and little infrastructure.
- The product stays light: no new server processes.
- The working builds (the web's Docker image, the Expo dev client, electron-builder) must not break for long.

**How projects of this class do it:**
- **Coinbase CDS:** a workspaces monorepo with `cds-common` (tokens, types, hooks), `cds-web` and `cds-mobile`,
  Storybook and an Expo demo.
- **Discord:** store logic shared between the web and React Native; the Mana design system on every platform.
- **Bluesky, Expensify:** one React Native codebase plus react-native-web; Electron as a wrapper.
- **Expo:** supports workspaces officially since SDK 52.

## Decision

**A monorepo on npm workspaces, with a design system split the Coinbase CDS way and domain logic shared the Discord way.**

```
package.json            workspaces: packages/*, web, mobile, desktop/ui; shared scripts; ESLint
packages/ui-common      @atrium/ui-common — tokens (+tokenCss), the scale's geometry, the parts' props contract
packages/ui-web         @atrium/ui-web — the React DOM implementation + flow.css, Storybook
packages/ui-native      @atrium/ui-native — the React Native implementation, same names and props, /design catalog
packages/setup          @atrium/setup — "Your own server" and first run without UI: steps, scale, validations, the
                        installer's protocol, deSEC's answers, capacity, a made-up install
web/ mobile/ desktop/   the apps where they were; desktop/ui — the app's windows in React (Vite) on ui-web and setup
```

**Rules:**
- A package exports through its `index.ts` only.
- Dependencies point down: `ui-common` ← `ui-web` / `ui-native` ← apps; `setup` ← apps.
- ESLint checks the boundaries, deep imports and colour literals in the flow layer.
- The transport of "Your own server" stays per platform: the SSH module on the phone, Electron's main process on the
  desktop. The step model is one.
- The server stays a modular monolith.

## Options considered

### A: workspaces + CDS-style packages (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Medium: a root `package.json`, Dockerfile and Metro changes, 4 packages |
| Cost | 5–7 steps, a commit each, the builds kept working |
| Scalability | New screens and windows from ready parts; new platform packages the same way |
| Familiarity | The standard layout (Expo, Coinbase, Nx/Turborepo) any frontend developer knows |

**Pros:** one design system with a contract; one "Your own server" logic; imports by package name; showcases, tests, CI;
the desktop windows stop being hand-built DOM.

**Cons:** a transition touching three apps' configs; a root lock file; a build step (Vite) and about 150 KB of React
in the desktop's own windows.

### B: packages without workspaces, on path aliases

| Dimension | Assessment |
|---|---|
| Complexity | Low at first: `tsconfig.paths` and Vite/Metro aliases |
| Cost | A step cheaper |
| Scalability | Worse: packages have no dependencies or versions of their own; aliases in 3–4 configs |
| Familiarity | Seen, but reads as a workaround |

**Pros:** installs and Docker untouched. **Cons:** the "packages" stay folders without a `package.json`: exactly what a
developer would pick on.

### C: one React Native codebase + react-native-web (Bluesky, Expensify)

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Cost | Rewriting the whole web (HeroUI, Tailwind, LiveKit calls in the browser): months |
| Scalability | The most reuse after the move |
| Familiarity | Changes the web's stack a lot |

**Pros:** one UI code for every platform. **Cons:** a huge migration with nothing for the product now; the web loses
HeroUI; regressions in calls and screen sharing.

### D: moving the apps to FSD

| Dimension | Assessment |
|---|---|
| Complexity | High: hundreds of files moved |
| Cost | Large, with nothing a person would see |
| Scalability | Helps big teams inside one app |
| Familiarity | Popular in Russian-speaking frontend; not seen in big-tech clients of this class |

**Pros:** a formal layering inside an app. **Cons:** doesn't touch the duplication between platforms; its main value
(boundaries, public APIs) comes with option A's ESLint.

### E: microservices

| Dimension | Assessment |
|---|---|
| Complexity | Very high |
| Cost | More processes and memory on a 1 GB VPS, harder deploys and observability |
| Scalability | For hundreds of teams deploying independently, not for us |
| Familiarity | Against "one command, 120 MB" |

**Pros:** none at our size. **Cons:** goes straight against the product; the problem is in the clients, not the server.

## Trade-off analysis

- **A against B.** Workspaces cost a step of config changes and give real packages: their own dependencies, a name, an
  `index.ts`, tests. Expo supports them officially, which removes the main risk (Metro in a monorepo). B saves a day
  and leaves "folders pretending to be packages".
- **A against C.** C reuses more but rewrites a working web. A shares the design and the logic and leaves each platform
  its native UI stack: what Coinbase and Discord did.
- **A against D.** The core of FSD, boundaries and public APIs, comes from the linter without moving files. The apps
  can move to layers later if the team grows.
- **E** is out: the problem is in the clients, and the server is already a modular monolith.

## Consequences

**Easier:**
- A new screen or window is built from `@atrium/ui-*` with one API.
- A change to the scale, a token or a validation is made once and reaches every platform.
- An outside developer finds a standard monorepo, showcases, tests and CI.
- The desktop's "Your own server" has what the phone's has: mocks, the shared scale.

**Harder:**
- Installs are from the root (Node 24.3+, npm 11).
- The web's Docker build copies `packages/` and the workspace manifests.
- The desktop has a `vite build` step (`npm run ui`, run before `start` and `dist:*`).
- The contract has two implementations to keep in step: each declares `parts satisfies FlowParts`, and a test checks
  both export every part.

**To come back to:**
- Turborepo or Nx for task caching, once builds get long.
- Moving the desktop's other windows (address, picker, unreachable) into `desktop/ui`.
- A `@atrium/protocol` package for the types and dictionaries the phone app still takes from `web/src`.
- The desktop main process's own deSEC answers (`server-setup.js`) onto `@atrium/setup`, once the main process has a
  build step.
- Publishing Storybook next to DESIGN.md.

## How it went

All eight action items are done, one commit each. Where it differs from the plan:

- **Node 24.3+ and npm 11.** npm 10.8 crashes building the workspace tree (`edgesOut`), so the root `package.json` sets
  `engines` and `packageManager`, and the web's Docker stage runs on `node:24-slim`.
- **`RecoveryKeyStep` stays in the phone app.** It's a screen with the clipboard and the share sheet, not a design
  system part.
- **The parts' own words come through `FlowProvider`.** Packages don't import app code: the back button's label comes
  from the app, `Drum` takes ready rows.
- **Two rules check the boundaries.** `eslint-plugin-boundaries` catches crossings by path but takes an import by
  package name for an external one, so `no-restricted-imports` sets the direction by name, and keeps `@atrium/setup`
  free of React.
- **The desktop main process (`server-setup.js`) is untouched.** It's outside the workspaces; its transport (SSH,
  deSEC) stays its own. The shared step model runs in the window (`desktop/ui`).
- **The contract grew** `KeptRow`, `Drum`, `FlowProvider` and a `trailing` slot on `LineField` (the password's eye).

Where things are: the contract in `packages/ui-common/src/contract.ts`; the showcases in Storybook (`npm run
storybook`) and `/design` in a development build of the phone app; the checks in `npm run check` and
`.github/workflows/checks.yml`.

## Action items

1. [x] **Checkpoint:** commit the work in progress (the desktop window in the new look, `tokenCss`, the demo key fix).
2. [x] **Monorepo:** a root `package.json` with workspaces; mobile per Expo's guide (no manual `watchFolders`); the
   Dockerfile copies `packages/`; `.claude/launch.json`, docs/development.
3. [x] **`@atrium/ui-common`:** tokens from `web/src/tokens.ts`; geometry from both `EdgeTicks.tsx`, `useFlowFrame` and
   `desktop/onboarding.js ruler()`; the contract (`onPress`, `secondary`, `onSubmit`, `FlowPrimary`); tests
   (`node --test` + tsx: a `tokenCss` snapshot, the geometry, parity).
4. [x] **`@atrium/ui-web` and `@atrium/ui-native`:** move the implementations; bring the parts to parity; remove
   literals (`Settings.Primary` in the flows to `FlowPrimary`, `DinoRun` to tokens); update `SetupWizard.tsx`,
   `own.tsx`, `login.tsx`, `recovery.tsx`; Storybook and `/design` on the phone.
5. [x] **`@atrium/setup`:** the model of "Your own server" and first run from `own.tsx`, `onboarding.js`,
   `mobile/src/own/{setup,capacity,mock}.ts`, `SetupWizard.tsx`; platform differences as step configs; tests of
   transitions, validations and the installer's protocol.
6. [x] **`desktop/ui`:** Vite pages, the `onboarding` window on `ui-web` and `setup` with an adapter over
   `window.atriumSetup` (`onboarding-preload.js` and `server-setup.js` unchanged); `main.js` loads `ui-dist`,
   electron-builder's `files` include it; the old `onboarding.*`, the CSS copies and `design.js` removed.
7. [x] **Gates:** root ESLint (boundaries, hooks, no colour literals in the flow layer); `npm run check` (lint, types,
   tests, builds); `.github/workflows/checks.yml` on push and pull request, with a `pytest` job.
8. [x] **Docs:** DESIGN.md points to Storybook and the contract; this ADR in `docs/adr/001-client-architecture.md`.
