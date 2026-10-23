# Motion

Motion exists to explain state change, hierarchy or the result of an action. It
is not decoration. If removing an animation loses no information, remove it.

## Duration

| Interaction | Duration |
|---|---|
| Press / small feedback | 50–100ms |
| Default UI transition | 150ms |
| Enter / appear | 200–300ms |
| Exit / dismiss | ~140–200ms (slightly faster than enter) |
| Cross-screen / large surface | 300–500ms |
| Staged or cinematic | >500ms only when deliberately staged |
| Microinteraction | <500ms total |

Frequent interactions (dozens per session) stay under ~200ms. Mobile can be
20–30% shorter. The 150ms default matches Material 3 `short3`, Carbon
`moderate-01`, Polaris 150 and Tailwind defaults.

## Curves

- Default UI ease-out: `cubic-bezier(0.23, 1, 0.32, 1)` or the Material 3
  standard `cubic-bezier(0.2, 0, 0, 1)`.
- Enter: ease-out. Exit: ease-in or a faster ease-out. `ease-in` on a UI element
  feels sluggish.
- Avoid the browser default `ease`; it is too weak for UI.
- Springs: keep damping high enough that nothing visibly oscillates for more
  than one bounce. Respect reduced motion.
- Animate transform and opacity. Do not animate width, height, top/left,
  box-shadow, filter (per-frame blur), or layout properties.

## The frequency gate

Ask how often the user will see this:

- Dozens of times per session: ≤150–200ms, no choreography, no delay.
- A few times per session: up to 300ms, minimal stagger.
- Once or twice: 300–500ms and a richer entrance is defensible.

If an animation plays on every render or every scroll by default, delete it.
Ambient idle motion is usually decoration.

## Rules

- Never animate from `scale(0)`. Start at `scale(0.95)` or higher with
  `opacity: 0`.
- Popovers scale from their trigger origin; modals stay centered.
- Asymmetric enter/exit: enter ~200ms, exit ~140ms. Exit feels decisive because
  the user already chose.
- Accordion expand/collapse can use `grid-template-rows: 0fr → 1fr` plus
  opacity; keep the transition on a wrapper, not the text.
- Keep conditional elements mounted and toggle a class when an exit transition
  matters; unmounting skips the exit.
- Do not animate the focus ring.
- Do not use hover lift as the only affordance.
- Scroll-driven animation: pin only when the narrative needs it; never hijack
  scroll or block the page. Provide a static reduced-motion path.
- Do not animate large background images or blurs continuously.

## Reduced motion

`prefers-reduced-motion: reduce` is mandatory:

- Remove translate, scale, rotate, parallax, camera and multi-step choreography.
- Keep opacity/color changes and instant state swaps.
- Ensure the reduced path is defined before any observer/timer is armed, not
  after.
- View Transitions does not automatically respect reduced motion; gate it.

WCAG 2.2.2 (pause, stop, hide) is Level A. 2.3.3 (animation from interactions)
is AAA; do not conflate them. Large motion that can trigger vestibular symptoms
should be removable regardless.

## Performance

- Prefer CSS transforms/opacity. Use `will-change` sparingly and remove it after.
- Avoid animating filters, backdrop-filter, large box-shadows, or canvas at full
  resolution without need.
- Keep DOM cost bounded; do not create a node per particle.
- Avoid layout thrash in JS animations; batch reads and writes.
- Test on a mid-range device, not just the dev machine.

## Common failures

- Animation as the only state signal (e.g. color flash with no label).
- `transition: all`.
- Hero choreography in a productivity tool.
- Infinite looping animations in a dashboard.
- Spring that visibly bounces twice in a menu.
- Reduced motion handled only by cutting durations to 0.001ms, leaving the
  layout jump.
- Skeleton shimmer that never stops.
- Carousel auto-advance with no pause.
- Exit animation longer than entry.
