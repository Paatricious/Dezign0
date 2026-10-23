---
name: media-brief
description: Write image and short-video asset briefs from the addon prompt and storyboard packs, with aspect ratios, negative prompts and delivery specs. Use when a design needs original media assets instead of placeholder images.
---

# Media brief

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

This skill produces briefs, not generated media. The kit has no image or video
model: a prompt pack is an input to the user's own tool. Never claim an asset was
generated when it was only described.

## 1. Brief the need

Read the project brief and the section the asset serves. Name: the message, the
audience, the placement, the aspect ratio, the crop behaviour, the colour and
type context, and the alt text the asset must support. If the section has no
real copy yet, write the brief around the actual message; do not invent claims.

## 2. Load the pack

Call `dezign0_addons`:

- `{ "action": "list", "section": "media" }` for the two packs;
- `{ "action": "search", "section": "media", "query": "product" }` to narrow by
  use case (product, editorial, abstract, motion);
- `{ "action": "get", "id": "media-image-prompts" }` for the eight image briefs;
- `{ "action": "get", "id": "media-video-storyboards" }` for the five storyboards.

In a source checkout these are `design-languages/media/image-prompts.json` and
`design-languages/media/video-storyboards.json`. If the addon pack is missing,
say so and write the brief from the project's own art direction; do not copy
third-party prompt text.

## 3. Adapt, do not paste

Pick the closest prompts or storyboards and rewrite them for this brand and
section, keeping the pack's schema exactly:

- image brief: `id`, `title`, `useCase`, `aspect` (ratio plus recommended size),
  `prompt`, `negative`; no artist, studio, brand or person's name, and no request
  for legible text in the image;
- video brief: `id`, `title`, `useCase`, `duration`, `format` (ratio,
  resolution, frame rate, codec, loop or one-shot), and `scenes[]` with `index`,
  `start`, `end`, `duration`, `shot`, `camera`, `action`, `onScreenText`,
  `audio`. Scene durations and timecodes must sum to `duration`.

Write `design/<slug>/MEDIA.md` with the selected briefs, the asset slots they
fill, and the expected alt text. Keep every brief self-contained so it can be
handed to a generation tool or a photographer.

## 4. Deliver and label

- Place assets the user supplies or generates in `design/<slug>/assets/` as
  `<id>.webp` (or the project's convention), with a licence and source line per
  file. Record the prompt `id`, tool, model/version and date in
  `design/<slug>/MEMORY.md` so a later reviewer can reproduce or replace it.
- Review generated art like any other content: unintended text, logos, hands,
  duplicated objects, or a focal point that dies when cropped narrow.
- A slot with no asset stays a labelled placeholder in the artifact, not a
  stock-photo hotlink.
- Record which brief produced which asset, and which briefs are still open.

## Evidence

Report: addon ids and paths used, prompt/storyboard ids, aspect ratios, negative
prompts, which assets exist versus are proposed, licences and sources, and
whether anything was generated, downloaded or rendered. An ungenerated brief is
labelled "brief only".

## Anti-patterns

- Claiming images or video were generated when only a prompt exists.
- Hotlinking placeholder CDNs or stock images without a licence.
- Fake product screenshots or invented brand assets.
- Copying third-party prompt text verbatim.
- Cropping a content-bearing asset into a decorative strip.
- Leaving alt text until after the asset is chosen.

## When not to use

Do not use when the user supplied real brand imagery; use it directly with the
licence recorded. Do not use when the design needs no media (`frontend-design`
alone). Do not use for a design-system or token task; use
`design-system-extract` or `design-language`.
