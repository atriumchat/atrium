# Gomex design

**English** · [Русский](DESIGN.ru.md)

Gomex keeps Discord's structure and habits (server rail, channel list, voice rooms, controls where people expect
them), so someone switching over finds their way at once. It does not keep Discord's look. This file is the look we
are moving to. The first screen built in it is "Your own server" on the phone (`mobile/app/own.tsx`). Its parts are
the design system Gomex Flow, one package per platform with one contract (docs/adr/001-client-architecture.md):
`@gomex/ui-common` (tokens, the scale's geometry, the parts' props), `@gomex/ui-web` (React DOM, shown in Storybook:
`npm run storybook -w @gomex/ui-web`) and `@gomex/ui-native` (React Native, shown at `/design` in a development build).

## Principles

- **Type is the material.** Hierarchy comes from size and weight, not from plates, cards and tints. Nothing gets a
  background just to look like a block.
- **OLED black.** The page is `#000`. White for what matters, grey (`colors.muted`) for what explains it.
- **One thing per screen.** A title that asks one question, the fields for it, one main action.
- **Every control shows how to use it.** A field has a line and a hint in it, a choice has a radio, a text action is
  underlined, a disabled button is grey. If it can be tapped and doesn't look like it, it's a bug.
- **Concentric with the screen.** Spacing follows the display's rounded corners (Apple's rule: inner radius = outer
  radius − gap).

## Layout

| What | Value |
| --- | --- |
| Side and bottom margin | display corner radius − 24 (38 on an iPhone 17 Pro), never under 32 |
| Top | safe area + 8, never closer to the edge ticks than their width + 22 |
| Inside a block | 8 |
| Between blocks | 32 |
| Between a step's parts (heading, content, buttons) in a window wider than a phone | 48 |
| Field label → field | 0 (label sits right on it) |
| The buttons | on a phone at the bottom, in the thumb's reach; in a window wider than a phone right under the content, 48 below it (the column at the top, the title in place from step to step) |

`useFlowFrame()` computes these for the current screen, so nothing is hard-coded per device.

## Type (Onest)

| Role | Size / line | Colour |
| --- | --- | --- |
| Part of the flow ("Address (2/5)") | 15 / 20 | muted |
| Title | 34 / 40, regular, −0.8 tracking | white |
| Line under the title | 17 / 23 | muted |
| Field text, choice title | 20–22 | white |
| Field label, hints, notes | 14–15 | muted |
| Big numbers (capacity) | 64 / 64, −3 tracking | white |

Content is always quieter than the title. Numbers are never put in fixed-width columns (they leave holes).

## Colour

All values live in one package, `@gomex/ui-common` (`packages/ui-common/src/tokens.ts`), with the scale's geometry
next to them (`geometry.ts`): the web turns the tokens into `--gx-` CSS variables at start-up (`applyTokens`, also read
by the HeroUI theme), the phone app imports them (`mobile/src/theme.ts`). Never write a colour, size or radius by hand
in a flow; add a token.

- Page true black on a phone (OLED: the pixels go dark), near-black `#0c0c0e` in a window wider than a phone (a
  monitor's backlight shows `#000` as glowing grey). Text white on a phone, `#ededef` on a monitor (white on black
  halates over a long read). Secondary `muted`, errors `danger`.
- No accent colour in flows: no green buttons, links, radios or ticks. White carries the emphasis.
- The only filled shape on a screen is the main button (white pill, dark text); disabled it turns graphite.

## Parts (`packages/ui-web`, `packages/ui-native`; props in `packages/ui-common/src/contract.ts`)

- **FlowShell**: the black page, the part line over the step, `EdgeTicks` drawn last, and an optional `bottom` laid
  edge to edge and kept inside the ticks (fades into black towards them).
- **EdgeTicks**: progress as ticks along the screen's own rounded edge, from the right of the camera island,
  clockwise. One scale for the whole flow; it continues from step to step, never restarts. In a window wider than a
  phone (the web, the desktop app) the same scale is unrolled into a ruler over the column (`TickRuler`): the edge of a
  monitor is too far from the reading and would take a thousand ticks.
- **FlowStep**: title, line, content, then back as an outlined 48 circle 2 points from the main button: at the bottom on
  a phone (thumb reach), right under the content in a wider window. General errors and notes stand over the buttons; a field's own error goes under the field.
- **LineField**: label, big text on a hairline (white while typing, red when wrong), placeholder always, error under it.
- **RadioRow**: a choice between hairlines, radio on the right (as iOS marks a choice). One option preselected.
- **FlowPrimary**: the main button, the white pill; `busy` shows a spinner on it, disabled it turns graphite.
- **FlowSecondary**: a small outlined button 2 points right of the main one, for the way round it (skip, later).
- **TextAction**: white underlined text for other paths and small actions (forgot password, copy).
- **KeptRow**: something remembered from before, with its action underlined on the right.
- **Drum**: a long job's steps (the install), the running one in the middle, the done ones fading above.
- **FlowProvider**: the app's words for what the parts say themselves (the back button's label).

## Motion

- Next step slides in from the right (320 ms), the old one slides out left (160 ms); going back fades.
- The edge sweeps tick by tick to its new value; the next tick breathes.
- While waiting (an install) give people something to do or watch, and never take it away mid-way: finish the round,
  then offer "Next".

## Words

Short, plain, human. Say what is happening and what to do ("Waiting for the address to start working. Usually a
couple of minutes; you can close the app"). Not marketing, not jargon: people see "20 people in a call", not
"1 vCPU, 1.9 GB".

## Don't

- Centred glowing icon discs over centred bold titles (the stock "AI" look).
- Grey plates and cards around content; several background tones.
- Green or any accent in flows.
- Line art or glass-sphere illustrations in flows.
- Metro's idioms: pivots of section names, lowercase gimmicks. Its principles (type first, black, no chrome) stay.
- Stage names running along the top; a second progress bar next to the edge ticks.
- Fixed-width number columns, errors far from their field, a back button alone at the bottom with nothing beside it.

## Working on it

- Design on mocks in a browser, at iPhone 17 Pro size (402 × 874): `npx expo start`, then
  `localhost:8081/own?mock=1`; `&step=address` (or `free`, `mail`, `own`, `install`, `ready`, `name`, `admin`, `key`,
  `invite`) opens a step, `&fast=1` hurries the install. Sign-in: `localhost:8081/login?mock=1` (add
  `&invite=7F3K9QAB` for the invite branch). The web build stubs LiveKit and the Keychain (`mobile/web-stubs`).
- Done on these parts: "Your own server", sign-in, invite and the recovery key on the phone (`RecoveryKeyStep`); the
  server's setup wizard, the sign-in, the recovery key, the reset link and "where to use Gomex" on the web and in the desktop app (`@gomex/ui-web`; `#signin`, `#key`, `#reset`, `#where=ios`, `#step=server`
  and the like open a step on made-up answers in development); the desktop app's own "Your own server" window
  (`desktop/ui`, `npm run desktop-ui` and `onboarding.html?lang=ru#step=install` on made-up answers). Next: settings. The main screens (rail, channels, chat, call) last,
  drawn in Figma first.
