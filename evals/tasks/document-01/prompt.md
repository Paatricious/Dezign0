# Brief: incident postmortem report

Build a self-contained `report.html` postmortem for a 47-minute API outage. It
will be read on screen and printed to PDF for a compliance file. No frameworks,
no external assets.

Required content and structure:

- A `main` with one `h1`, a metadata block (severity, date, owner, status), and
  an executive summary of at most 150 words that states impact, cause and the one
  decision required from the reader.
- A table of contents in a `nav` linking to each section by id.
- Sections: summary, timeline, impact, root cause, detection, what went well,
  what went badly, action items, sources.
- The timeline is a table with a `<caption>`, time ranges using `<time datetime>`.
- Action items are a table with owner, due date and status; no invented owners.
- A sources section with `id="sources"` listing the evidence actually used
  (dashboards, logs, incident channel), each with a real label (not a URL
  placeholder).
- Body measure between 50 and 75 characters: set a `max-width` in `ch` on the
  prose container.

Constraints:

- Print stylesheet: page breaks before major sections, no clipped tables, TOC not
  printed as a page of links.
- Semantic headings in order; tables have captions and scoped headers; link text
  is descriptive.
- No placeholder copy, no TODO markers, no invented percentages, no dead links.

Write the file to the exact output path the harness gave you.
