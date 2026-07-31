---
version: alpha
name: SpecNav Verification Report Design System
description: Visual contract for SpecNav stakeholder verification reports, review artifacts, and documentation surfaces.
colors:
  primary: "#171717"
  secondary: "#4d4d4d"
  tertiary: "#0f766e"
  neutral: "#f3efe6"
  background-100: "#fffdf8"
  background-200: "#f7f2e8"
  gray-100: "#f3f1ec"
  gray-200: "#e8e3d9"
  gray-300: "#d8d1c5"
  gray-400: "#c8bfb1"
  gray-500: "#a69d90"
  gray-600: "#81796f"
  gray-700: "#625c55"
  gray-800: "#45413d"
  gray-900: "#302d2a"
  gray-1000: "#171717"
  blue-700: "#2563eb"
  red-800: "#c2413b"
  amber-700: "#b7791f"
  green-700: "#23845b"
typography:
  heading-32:
    fontFamily: Geist Sans
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: 0
  heading-24:
    fontFamily: Geist Sans
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: 0
  label-14:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0
  copy-14:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0
  mono-13:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0
  button-14:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 40px
rounded:
  sm: 6px
  md: 8px
  lg: 8px
components:
  button-primary:
    backgroundColor: "{colors.gray-1000}"
    textColor: "{colors.background-100}"
    typography: "{typography.button-14}"
    rounded: "{rounded.sm}"
    height: 40px
  button-secondary:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.primary}"
    typography: "{typography.button-14}"
    rounded: "{rounded.sm}"
    height: 40px
  input:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.primary}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
    height: 40px
  status-pass:
    backgroundColor: "{colors.green-700}"
    textColor: "{colors.background-100}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
  status-fail:
    backgroundColor: "{colors.red-800}"
    textColor: "{colors.background-100}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
  status-blocked:
    backgroundColor: "{colors.amber-700}"
    textColor: "{colors.background-100}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
---

# SpecNav Verification Report Design System

## Overview

This design system applies to generated verification HTML, prototype review
artifacts, and repository documentation. The primary experience is a compact,
evidence-first engineering report, not a marketing page. It must remain useful
for green, red, blocked, flaky, and pass-after-fix states.

## Colors

- Primary text uses `colors.primary`; supporting text uses
  `colors.secondary`.
- Report surfaces use `background-100` and `background-200` with
  `gray-200` borders.
- Pass, fail, blocked, warning, and informational states use semantic tokens.
- Status is always paired with text and an icon; color alone is not evidence.
- Evidence paths, commands, hashes, and identifiers use neutral surfaces and
  mono typography.

## Typography

- Page titles use `heading-32`; section titles use `heading-24`.
- Dense tables, filters, and status controls use `label-14` and `copy-14`.
- Commands, file paths, hashes, case ids, run ids, and attempt ids use
  `mono-13`.
- Report cards and table panels must not use hero-scale type.
- Letter spacing remains `0` for all production report styles.

## Layout

- Maximum content width: `1440px`; minimum readable gutter: `16px`.
- Desktop uses a fixed summary rail only when it improves scanning; mobile
  collapses to a single column.
- The three report pages share one header, filter model, status legend, and
  evidence-link treatment.
- Tables use stable columns, horizontal overflow when necessary, and no
  content-driven layout shifts.
- Cards are reserved for individual repeated case summaries or evidence items;
  page sections remain unframed.

## Elevation & Depth

- Use borders and background hierarchy before shadows.
- Dialogs and popovers may use one soft shadow; ordinary report panels do not.
- Focus rings must be visible against both report surfaces.
- Overlays must preserve access to the originating case, run, and evidence id.

## Motion

- Motion is limited to filter transitions, disclosure panels, and progress
  indicators.
- Default duration is `120ms` to `180ms`.
- Reduced-motion mode removes nonessential transitions.
- Test results, evidence status, and gate verdicts must never animate in a way
  that delays or obscures their final state.

## Shapes

- Controls use `rounded.sm`.
- Repeated evidence items and dialogs use at most `rounded.md`.
- Pills are limited to compact statuses and domain labels.
- Nested cards and decorative rounded page sections are forbidden.

## Components

- Required shared components: report shell, stage summary, domain status table,
  case catalog table, case result row, attempt timeline, evidence viewer,
  blocker panel, integrity badge, freshness badge, repair-loop timeline,
  filter bar, empty state, and print header.
- Every interactive icon has a tooltip and accessible name.
- Filters use checkboxes, segmented controls, or menus according to the value
  type.
- Green, red, and blocked reports use the same information architecture.
- Screenshot, trace, video, log, assertion, and human-signoff evidence use
  distinct icons and labels.

## Voice & Content

- Copy is factual, concise, and auditable.
- Prefer exact terms: `PASS`, `FAIL`, `BLOCKED`, `FLAKY`, `PASS AFTER FIX`,
  `STALE`, and `NOT APPLICABLE`.
- `NOT APPLICABLE` must show approval and evidence; it is never rendered as an
  implicit skip.
- Errors name the missing dependency, command, file, case, run, or evidence id.
- README documentation is maintained as separate English and Simplified Chinese
  files. Generated reports use the language of their source artifacts; there is
  no runtime locale switch.

## Theme & Internationalization

- Theme capability: `light-only`.
- Theme toggle: `none`; prototypes and reports must not invent a dark/light
  switch.
- Internationalization runtime: `none`.
- Supported runtime locales: `none`.
- Default locale: `none`.
- Documentation locale policy: separate `README.md` and `README.zh-CN.md`
  files, with matched structure and visuals.
- Prototype rule: show the light report theme only and omit theme and locale
  controls.

## Accessibility

- Meet WCAG AA contrast for text and interactive controls.
- All report navigation, filters, disclosures, and evidence links are keyboard
  operable.
- Tables expose headers and row relationships.
- Status and domain information has text equivalents.
- Print output preserves verdict, case ids, evidence references, and blockers.

## Do's and Don'ts

- Do render the complete verification state even when execution is blocked.
- Do keep evidence paths and integrity information visible from case results.
- Do reuse the shared report components across all three report pages.
- Do preserve a compact, warm editorial visual treatment without sacrificing
  engineering density.
- Don't add a verification light mode.
- Don't use decorative gradients, floating page cards, or generic dashboard
  filler.
- Don't hide retries, failed attempts, stale evidence, or repair history.
- Don't invent theme switching or runtime i18n.
