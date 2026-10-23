# Visual review

Most real design feedback is a screenshot plus "this bit". Make that input
explicit instead of hoping the model guesses.

## Point, then describe

Ask the user for, or infer from their message:

1. **The target** — a screenshot, a region, a `data-od-id`, a selector, or a
   Figma node ID.
2. **The intent** — what should change, what must stay, and why.
3. **The accepted tradeoff** — what may get worse.

If the target is only "the page", ask one narrowing question. Do not review the
whole page from a 200px thumbnail.

## Screenshot and annotation intake

- Treat a screenshot as **evidence of a render**, not proof that the current
  source produces it. Say which file/commit was likely captured.
- Map an annotation to the smallest element or region it touches. If the mapping
  is ambiguous, say so and cite the closest selector or `data-od-id`.
- Ask for the viewport width and DPR when layout or type is in question.
- If the user supplies a Figma frame, run `figma-context` and keep the node ID.

## Before / after

For a redesign, capture both states at the same width and DPR:

```text
design/<slug>/shots/
  before-1440.png
  after-1440.png
  before-390.png
  after-390.png
  manifest.json
```

`measure-artifact.mjs --shots=design/<slug>/shots` writes full-page PNGs. Record
the command, viewport, date and commit in the manifest or `REDESIGN.md`. Do not
compare screenshots taken at different widths or platforms and call it a
regression.

## Review packet

The critique output should name:

- the artifact and exact revision;
- the viewport(s) and browser;
- what was compared (source, render, screenshot, Figma);
- what was **not** available;
- the accepted risks and who accepted them.

## Do not

- Do not claim a screenshot proves interaction, focus or console state.
- Do not use a screenshot to override measured geometry without saying so.
- Do not compare across operating systems, browsers or DPR and report pixel drift
  as a defect.
- Do not let an annotation hide a broader accessibility failure.
