# Project Visual Discovery

Read this before creating a `ui-html` prototype.

The goal is not to draw a pretty generic screen. The goal is to create a
runnable review artifact that feels like the current project.

## Required Discovery

Collect direct evidence before writing `artifact/index.html`:

- current app screenshots or live route screenshots;
- existing shell structure such as sidebar, top bar, tabs, tenant selector,
  user menu, language switcher, theme switcher, notifications, and page chrome;
- route or navigation names relevant to the feature;
- UI framework and component library conventions;
- design tokens from `openspec/specs/ui-design/design.md` and project CSS;
- reusable components, hooks, utilities, and services from the component
  architecture spec and code evidence;
- real business fields, labels, actions, table columns, empty states, loading
  states, error states, permissions, and role language;
- theme support and i18n support exactly as approved by requirements.

If these inputs are missing, stop with an explicit blocker. Do not replace
missing project evidence with a generic dashboard, marketing layout, or
illustrated process diagram.

## Required Artifact

Write `prototype/visual-inventory.json` for every `ui-html` prototype. It must
name the evidence sources used to build the prototype and the project shell
elements that must be visible in the HTML.

The prototype HTML must expose:

- `data-specnav-screen` on each reviewable screen root;
- `data-specnav-project-shell` on the shell root that mirrors the project;
- `data-specnav-component` on major reused or proposed components;
- `data-specnav-state` on loading, empty, error, disabled, permission, and
  populated regions when relevant;
- `data-specnav-variant` on meaningful visual or workflow variants;
- `data-specnav-theme-control` only when the approved manifest says a theme
  toggle exists;
- `data-specnav-locale-control` only when the approved manifest says a locale
  switcher exists.

## Review Standard

A reviewer should be able to identify the target project from the artifact
without reading the file path. The shell, labels, density, states, and business
surface must come from project evidence, not from the agent's default taste.
