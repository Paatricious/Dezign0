# Anti-AI-slop rules

Concrete, checkable patterns that make generated work read as a default model
output instead of a designed product. P0 items are mechanical failures. P1/P2
are judgment unless a linter catches them. `tools/design-lint.mjs` implements
the mechanically checkable subset.

## P0: the seven cardinal sins

1. **Default indigo as the accent.** Exactly `#6366f1`, `#4f46e5`, `#4338ca`,
   `#3730a3`, `#8b5cf6`, `#7c3aed`, `#a855f7`, or `indigo-500` as a solid
   accent. Use the brand `--accent`. If the brand itself is indigo, declare it as
   a token so it reads as intentional; the ban is on the default.
2. **Two-stop "trust" gradients.** purple→blue, blue→cyan, indigo→pink on a
   hero, CTA, or card. A flat surface plus hierarchy beats it.
3. **Emoji as feature or UI icons.** `✨🚀🎯⚡🔥💡` inside headings, buttons, list
   items, or icon classes. Use monoline SVG at 1.6–1.8px stroke with
   `currentColor`.
4. **Sans-serif display face when the brand binds a serif.** Headings must use
   the declared display token, not a hardcoded Inter/Roboto/system stack.
5. **Rounded card with a colored left-border accent.** Drop the radius or the
   border. It is the canonical AI dashboard tile.
6. **Invented metrics.** "10× faster", "99.9% uptime", "3× more productive",
   "trusted by 10,000 teams". Use a real source or a labelled placeholder.
7. **Filler copy.** Lorem ipsum, "Feature one / two / three", "Placeholder
   text", "Sample content". An empty section is a composition problem, not a
   reason to invent words.

## P1: soft tells

- The default sequence hero → three features → pricing → FAQ → CTA with no
  product-specific variation. Introduce at least one unexpected section or
  layout family.
- External placeholder image CDNs (`unsplash.com`, `placehold.co`,
  `picsum.photos`, `placekitten.com`) in a shipped artifact. Use a real local
  asset, a generated asset, or a clearly labelled placeholder slot.
- More than ~12 raw hex values outside the token block. Tokens were not honored.
- More than ~6 inline uses of `var(--accent)` in the rendered body. Cap visible
  accent use at two per screen for actual design work.
- Sections without a stable inspectable ID, so review comments cannot target
  them.
- `transition: all`; transitions on layout properties; animation without a
  reduced-motion guard.
- Generic display type: using the same system sans for display and body when the
  brand system specifies a display face.

## P2: polish

- Decorative blobs, waves, crosshair grids, scroll cues, locale/weather strips,
  version footers, section-number eyebrows, `·`-separated metadata strings,
  photo-credit captions, and pill labels overlaid on images.
- Perfectly symmetric layouts with no visual tension. Alternate density: one
  tight section, one breathing section.
- Identical three-card rows. Use two-up, asymmetric grids, horizontal rails,
  full-bleed quotes, or a real product demo instead.

## The 80/20 rule for soul

Aim for ~80% proven patterns + ~20% distinctive choice. Put the 20% in:

- one bold visual move: a type choice, a color decision, an unexpected
  proportion;
- voice and microcopy: "Start tracking" beats "Get started";
- one memorable micro-interaction (a 2px press, a number that counts up);
- one detail only someone who used the product would add (a keyboard hint, a
  product-specific status phrase).

Test: if a reviewer screenshots the artifact, can someone outside the project
identify which product it is from? If not, it is still a template.

## Exceptions

A brief can explicitly call for a banned pattern: brutalist poster, a
deliberate indigo brand, a giant display hero, an emoji-native product. In that
case, document the exception in one line and make every other decision support
it. An exception is not a default.

**Documentation and wayfinding.** A state board, spec sheet or design-system
document may use the accent systematically for orientation: section numbers,
state tags, pins, the current step. This is one navigation system, not the
product's two-visible-uses budget. The exception requires: one accent only,
one role per use, and a note in the artifact saying the accent is wayfinding.
It does not license accent decoration on a product surface.
