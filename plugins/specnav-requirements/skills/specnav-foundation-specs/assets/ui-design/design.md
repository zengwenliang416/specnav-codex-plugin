---
version: alpha
name: Project Design System
description: Project UI design system. Replace this skeleton with the user-supplied design.md when available.
colors:
  primary: "#171717"
  secondary: "#4d4d4d"
  tertiary: "#006bff"
  neutral: "#f2f2f2"
  background-100: "#ffffff"
  background-200: "#fafafa"
  gray-100: "#f2f2f2"
  gray-200: "#ebebeb"
  gray-300: "#e6e6e6"
  gray-400: "#eaeaea"
  gray-500: "#c9c9c9"
  gray-600: "#a8a8a8"
  gray-700: "#8f8f8f"
  gray-800: "#7d7d7d"
  gray-900: "#4d4d4d"
  gray-1000: "#171717"
  blue-700: "#006bff"
  red-800: "#ea001d"
  amber-700: "#ffae00"
  green-700: "#28a948"
typography:
  heading-32:
    fontFamily: Geist Sans
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: -1.28px
  heading-24:
    fontFamily: Geist Sans
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.96px
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
  md: 12px
  lg: 16px
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
---

# Project Design System

## Overview

Record the project-specific UI design decisions here. If the user provides a
formal design file, replace this template with that file and preserve this
frontmatter-plus-sections structure.

## Colors

Use tokenized colors. Describe semantic usage for primary text, secondary text,
page surfaces, borders, focus, success, warning, destructive, and disabled
states. Do not introduce ad hoc colors in feature work.

## Typography

Use typography tokens instead of hand-setting size, weight, line height, or
letter spacing. Record heading, label, copy, mono/data, and button rules here.

## Layout

Define page width, responsive breakpoints, section rhythm, panel spacing, grid
rules, and mobile behavior. Every layout requirement should be usable by a
prototype and by production implementation.

## Elevation & Depth

Define border, shadow, overlay, popover, modal, and focus depth rules. Prefer
surface and border hierarchy before heavy shadows.

## Motion

Define when motion is allowed, expected durations, easing, reduced-motion
behavior, and states where animation is forbidden.

## Shapes

Define radius families for controls, cards, menus, dialogs, avatars, and pills.
Avoid mixing unrelated radius systems in one view.

## Components

Define visual rules for buttons, inputs, tables, cards, dialogs, navigation,
empty states, toasts, tooltips, tabs, segmented controls, menus, and loading
states.

## Voice & Content

Define labels, button copy, error copy, empty states, toasts, loading text, and
whether the product uses Chinese, English, or bilingual copy.

## Theme & Internationalization

- Theme capability: `light-only` until the project proves otherwise.
- Theme toggle: `none` unless an existing theme switcher or requirement is recorded.
- Internationalization: `none` unless an existing i18n runtime, dictionaries, or locale routing is recorded.
- Supported locales: `none` until the project language list is recorded.
- Default locale: `none` until the project default language is recorded.
- Prototype rule: include a theme toggle or locale switcher only when this spec says it exists or is required; otherwise prototypes must explicitly omit those controls.

## Do's and Don'ts

- Do use the token names above in prototypes and production code.
- Do require accessible focus states and body text contrast.
- Do record theme modes and locale coverage before starting a UI prototype.
- Do pair color state with icon or text.
- Don't add one-off colors, spacing, shadows, or radii without updating this spec.
- Don't invent dark mode, a theme toggle, i18n, or a language switcher when the project does not support it.
- Don't hide important state with color alone.
