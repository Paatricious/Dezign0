# Brief: seven-slide investor update deck

Build a self-contained `deck.html` presentation for a Series A investor update.
It must present in a browser at 16:9 and print to PDF without breaking. No
external assets or frameworks.

Required content and structure:

- Exactly seven slides. Each slide is an element with `class="slide"`, a slide
  number visible on the slide, and a takeaway headline as an `h2`.
- Narrative order: title and ask, context, what changed, evidence, unit
  economics, plan for the next two quarters, explicit ask.
- The title slide has an `h1`; the other slides use `h2` takeaways.
- One idea per slide, maximum seven lines of body copy. No slide is a paragraph.
- A slide counter in the footer, updated by keyboard navigation.
- Keyboard navigation: ArrowRight/ArrowLeft move between slides; Home/End jump to
  the first/last; the current slide is the only visible one during presentation.
- Print styles: every slide prints on its own page, chrome hidden.
- Footer on every slide with the company name and page number.

Constraints:

- Readable at presentation size; body text never below 18px.
- One accent color; no gradient text; no emoji as icons.
- Print/PDF must not clip content; test at 1280×720 and A4 landscape.
- No placeholder copy, no invented metrics beyond those stated in the narrative
  examples, no dead links.

Write the file to the exact output path the harness gave you.
