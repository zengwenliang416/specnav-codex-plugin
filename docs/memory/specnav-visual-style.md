# SpecNav Visual Style Memory

Status: active project memory

Use this file before generating, replacing, or extending SpecNav README diagrams,
stage diagrams, component diagrams, workflow posters, or stakeholder-facing
visual explanations.

## Canonical Style

The accepted visual language is the combined B+D style chosen during the README
image pass:

- B: isometric engineering workbench.
- D: route-map journey diagram.

The result should feel like a careful illustrated technical map: approachable
and slightly cartoon-like, but still rigorous, structured, and suitable for
explaining a developer workflow.

## Stable Image Contract

- Aspect ratio: 16:9.
- Preferred production size: 2560 x 1440 PNG.
- Composition: isometric or elevated map view with connected station nodes.
- Narrative: every image shows a clear path from START to GOAL or from input to
  artifact.
- Surface language: workbench platforms, gates, checkpoints, lighthouses,
  docks, factories, fortresses, dashboards, folders, terminals, scrolls,
  shields, checklists, evidence boxes.
- Palette: warm parchment or cream map background, teal and dark navy
  infrastructure, muted green landscape, restrained coral/gold highlights.
- Linework: crisp illustrated outlines, soft paper texture, subtle shadows,
  clean technical labels.
- Density: information-rich but readable; no tiny illegible paragraphs.
- Mood: calm, serious, explainable, workshop-like, not playful mascot art.

## Negative Constraints

Do not generate:

- flat SaaS dashboard cards;
- generic PowerPoint infographic cards;
- stock-photo or photorealistic scenes;
- pure gradient backgrounds;
- deterministic SVG/vector diagrams that replace the approved B+D illustrated
  map style merely to make localization easier;
- decorative blobs, bokeh, or unrelated abstract orbs;
- cyberpunk, neon, glassmorphism, or purple-blue dominated palettes;
- one-note beige-only or blue-only palettes;
- dense walls of text that require zooming to understand;
- unrelated characters, mascots, or comic panels unless the specific task asks
  for them.

## Base Prompt

Use this base prompt for every new SpecNav image:

```text
Create a 16:9 illustrated technical explainer image in SpecNav's canonical B+D
style: a blend of isometric engineering workbench and route-map journey diagram.
Use a warm parchment/cream map background, teal and dark navy infrastructure,
muted green landscape details, restrained coral/gold highlights, crisp ink-like
outlines, subtle paper texture, and soft shadows. The scene should be slightly
cartoon-like but rigorous and professional, suitable for explaining a developer
workflow.

Show the process as connected stations on a route from START to GOAL. Each
station should look like a small workbench, gate, dock, factory, fortress,
lighthouse, terminal, evidence folder, shield, checklist, or dashboard. Use
clear numbered station labels, short bilingual-friendly labels, and visible
artifact/evidence cards. Keep text short and readable. Avoid flat SaaS cards,
generic PowerPoint infographics, photorealism, neon/cyberpunk styling,
decorative blobs, and overly dense paragraphs.
```

## Stage Diagram Template

```text
Create a 16:9 SpecNav B+D style stage diagram for:

Stage: <stage number and stage name>
Subtitle: <one short phrase that explains the stage>
Goal: <what this stage proves or unlocks>

Render five connected stations from START to GOAL:
1. <station one>
2. <station two>
3. <station three>
4. <station four>
5. <station five>

Include bottom gate markers:
- <gate one>
- <gate two>
- <gate three>

Make it consistent with the existing SpecNav README diagrams:
isometric/elevated map view, workbench platforms, route arrows, teal/navy
structures, warm parchment map, muted landscape, crisp outlines, subtle shadows,
short readable labels, and a serious technical-explainer tone.
```

## Component Diagram Template

```text
Create a 16:9 SpecNav B+D style component diagram for:

Component or subsystem: <name>
Purpose: <why it exists>
Inputs: <important inputs>
Outputs: <important outputs>
Contracts: <state, evidence, validation, or integration contracts>

Show the component as an isometric workshop island connected to neighboring
systems by labeled routes. Include reusable subcomponents as smaller benches or
modules. Include evidence/check gates where data or control flow crosses a
boundary. Use the canonical B+D style and avoid flat dashboard/card-only
composition.
```

## Current Reference Assets

The current accepted base images are stored in:

```text
docs/assets/readme/specnav-overview-bd-2k.png
docs/assets/readme/stage-1-bootstrap-bd-2k.png
docs/assets/readme/stage-2-discovery-bd-2k.png
docs/assets/readme/stage-3-requirements-bd-2k.png
docs/assets/readme/stage-4-prototype-bd-2k.png
docs/assets/readme/stage-5-development-bd-2k.png
docs/assets/readme/stage-6-verification-bd-2k.png
docs/assets/readme/stage-7-operations-bd-2k.png
```

README pages must not share one language-bearing image across English and
Chinese documentation. Maintain two native image sets:

```text
docs/assets/readme/en/*.png
docs/assets/readme/zh-CN/*.png
```

English README files must reference `docs/assets/readme/en/`. Simplified
Chinese README files must reference `docs/assets/readme/zh-CN/`.

The Chinese set is the accepted native Chinese B+D visual set. The English set
must be generated or edited as native English B+D bitmap images that follow the
Chinese set's style, structure, route rhythm, station count, color palette, and
visual language.

When the goal is high bilingual parity, use AI reference-image editing against
the accepted B+D master image: preserve the same map, route, buildings,
platforms, icons, colors, camera angle, and parchment texture, and replace only
the visible copy. This is allowed because it preserves the B+D illustrated
medium. Do not use deterministic local text overlay as the final asset, and do
not replace the image system with SVG/vector/dashboard/flat infographic output.

When adding new images, inspect these references first and keep the same
composition language, color temperature, route rhythm, label density, and
technical-map tone.

## Bilingual Edit Workflow

The accepted high-parity workflow is:

1. Treat the Simplified Chinese B+D image as the current visual master, unless a
   newer approved neutral master exists.
2. Use AI reference-image editing to translate visible copy while preserving the
   master composition, not independent text-to-image generation.
3. Visually review the English and Chinese outputs side by side.
4. Reject outputs that change the map composition, route geometry, buildings,
   stage count, palette, perspective, or B+D illustrated-map medium.
5. Upscale only after the reference-image edit is complete, and keep the final
   README assets at 2560 x 1440 PNG.

The 2026-06-30 English README stage images were regenerated with this workflow:
each English image was edited from the matching `zh-CN` B+D master, then
upscaled back to 2560 x 1440. The older independently generated English set was
replaced because it drifted in layout and scene details.

## Update Rule

Do not change this canonical style or replace the reference images without
explicit user approval. New diagrams should extend this style rather than
reinterpreting it.

Style continuity is a hard gate. Do not solve bilingual consistency by
switching the illustration system to a flatter deterministic SVG, dashboard, or
generic infographic style. If localized pairs drift, regenerate or edit within
the approved B+D illustrated-map language instead of changing the medium.

For bilingual documentation, do not use a deterministic text-overlay pipeline on
top of one language's image. Generate a native image for each language using the
same stage prompt, same layout constraints, and translated visible copy. Review
the English and Chinese sets together before publishing so style drift is caught
early.
