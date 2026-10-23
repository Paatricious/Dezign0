# Brief: product update email

Build a self-contained `email.html` product update email for existing customers
of a project-management tool. It must survive Outlook, Gmail and Apple Mail
reasonably intact. No frameworks, no external CSS, no JavaScript.

Required content and structure:

- A 600px-wide table-based layout: nested `<table>` elements with
  `role="presentation"` and inline `style` attributes on layout cells. Do not use
  flexbox or grid for the outer layout.
- A hidden preheader line (class `preheader`) that previews the email in the
  inbox.
- Header with the product name, one `h1` headline, a short intro paragraph, three
  update items with short descriptions, one primary CTA button implemented as a
  styled link, and a closing note from the team.
- A footer with the company address placeholder that is clearly labelled, an
  unsubscribe link, and a preference link.
- Conditional MSO comment for Outlook (`<!--[if mso]>`) to fix the button or
  table width.
- A mobile media query that keeps padding comfortable at 360px.

Constraints:

- All colors, font sizes and spacing inline; no `<link rel="stylesheet">`, no
  `<script>`, no remote images.
- One accent color; readable contrast on white; body text at least 14px.
- Links have destinations other than `#`; the unsubscribe link uses a real
  example action path.
- No placeholder copy, no TODO markers, no invented metrics.

Write the file to the exact output path the harness gave you.
