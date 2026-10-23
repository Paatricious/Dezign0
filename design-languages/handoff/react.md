# React handoff

For a React 18/19 SPA or a Vite/CRA-style app. Read [`contract.md`](contract.md)
first; this file only adds React mechanics. If the project uses Next.js, use
[`next.md`](next.md) instead — the server/client boundary changes the layout.

Original Dezign0 content.

## 1. Preconditions

- `tokens.css` is copied into `src/styles/tokens.css` unmodified.
- The component tree from the contract is agreed; the port does not re-architect
  it.
- The project's TypeScript is `strict`; if it is not, say so in the handoff record
  rather than writing untyped code.
- The project already has a styling approach. Do not introduce CSS-in-JS, a
  component library or a state manager during the port.

## 2. File layout

```text
src/
  components/
    Button/
      Button.tsx
      Button.module.css
      Button.test.tsx
      index.ts
    Field/
      Field.tsx
      Field.module.css
  sections/
    PricingPage/
      PricingPage.tsx
      PricingPage.module.css
  layouts/
    RootLayout.tsx
  styles/
    tokens.css        # copied from design/<slug>/tokens.css
    base.css          # reset + element defaults only
  main.tsx
```

- One folder per component; `index.ts` re-exports the public API only.
- Sections compose components; they do not restyle them from outside with
  selectors.
- Names are role-based PascalCase; files match the component name.

## 3. Conventions

- Function components, named exports (`export function Button`), no default
  exports except route-level files where the framework requires it.
- Props are a named `interface` or `type`; no inline object types duplicated
  across files.
- Extend the native element props instead of re-declaring `disabled`, `onClick`,
  `className`.
- `forwardRef` only when a parent must reach the DOM node (focus management,
  measurement, third-party interop). Otherwise use a callback ref or `useId`.
- No `React.FC`; it adds implicit `children` and weakens inference.
- No `any`. If a third-party type forces it, isolate it and add a comment.

## 4. Artifact → React primitives

| Artifact | React |
|---|---|
| `<button class="btn btn--primary">` | `<Button variant="primary">` |
| `<a class="btn" href>` | `<Button asChild>` wrapping `<a>`, or a shared `LinkButton`; keep the anchor an anchor |
| `<input>` + `<label>` + `<p class="error">` | `<Field label error>` owning `useId`, `htmlFor`, `aria-describedby` |
| `<ul>`/`<li>` repeated rows | `List` + `ListItem` or map inside the section; keys are stable ids, never indexes for reorderable data |
| `<details>`/`<summary>` | `Disclosure` with `aria-expanded` + region, or native `<details>` if no animation is required |
| `<dialog>` | `Dialog` with a portal, focus trap, `aria-modal`, Escape handling |
| `<img>` | `<img>` with `width`/`height`/`alt`; framework image component only where the project already uses one |
| Inline SVG icon | `Icon` components with `currentColor` and `aria-hidden` by default |
| Table with sortable headers | `Table` + `aria-sort`; sorting is behavior, not a CSS class |

## 5. Component skeleton

```tsx
// components/Button/Button.tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={[styles.root, styles[variant], styles[size]].join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
}
```

```css
/* components/Button/Button.module.css */
.root {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  padding-inline: var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font: inherit;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}
.primary { background: var(--accent); color: var(--accent-on); }
.primary:hover { background: var(--accent-hover); }
.primary:active { background: var(--accent-active); }
.secondary { background: transparent; border-color: var(--border); color: var(--fg); }
.root:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.root:disabled { opacity: 0.55; cursor: not-allowed; }
.sm { min-height: 32px; padding-inline: var(--space-3); }
.lg { min-height: 48px; padding-inline: var(--space-6); }
.spinner { width: 1em; height: 1em; border: 2px solid currentColor; border-right-color: transparent; border-radius: var(--radius-pill); }
```

Notes that matter:

- `...rest` comes first so the component keeps control of `disabled`, `type` and
  `className`. Callers can still pass `onClick`, `aria-*`, `form`.
- Spread order is part of the contract; do not reorder it casually.
- `aria-busy` communicates loading; a spinner alone is not a label.
- The spinner is `aria-hidden`; the accessible name stays the label.
- No color literal appears in the module.

## 6. State

| Situation | Mechanism |
|---|---|
| Open/closed, selected tab, expanded row | `useState` in the nearest owning component |
| Reusable controlled/uncontrolled component | `value` + `onChange` props, internal `useState` fallback |
| Form values, errors, pending | Form layer (`react-hook-form`, server action, or a local `useReducer`) — one owner only |
| Async data | A discriminated union: `{status:"idle"} \| {status:"loading"} \| {status:"success",data} \| {status:"error",error}` |
| URL state | Router params/search params; never mirror into state without a sync rule |
| Persisted preference | `localStorage` read in an effect or a small store; keep first paint deterministic |

Rules:

- Derive, don't duplicate: `const isEmpty = items.length === 0`.
- `useEffect` is for external synchronisation only (subscriptions, storage,
  timers, focus). If it writes derived state, it is a bug.
- Every effect cleans up. No async effect without an abort or a mounted guard.
- Keep event handlers semantic: `onOpenChange(next)`, not `onToggleAndClose`.
- If two unrelated components need the same state, lift to their nearest common
  owner before reaching for context. Context is for theme, auth and locale —
  not for one boolean.

## 7. Accessibility mechanics

- `useId()` for `id`/`htmlFor`/`aria-describedby` pairs; ids must be unique across
  portals.
- Error text is asserted with `role="alert"` only when it appears after
  interaction; a static hint is plain text referenced by `aria-describedby`.
- Dialogs: render in a portal, set `aria-modal`, label via `aria-labelledby`,
  move initial focus, trap Tab, restore focus to the trigger on close.
- Menus and listboxes: roving tabindex or `aria-activedescendant`; arrow keys move
  the active option; Enter selects; Escape closes.
- Live regions for async status (`aria-live="polite"`), announced once.
- Do not put `onClick` on a `div` to avoid styling a button; style the button.
- Avoid `dangerouslySetInnerHTML`. If the artifact contains authored HTML copy,
  convert it to elements.

## 8. Testing

- Unit/behavior: Testing Library, user-event, one test per state transition.
- Accessibility: `jest-axe`/`vitest-axe` on each component; keyboard test for
  every interactive component.
- Visual: a screenshot per state at the project's breakpoints (Storybook or a
  Playwright snapshot).
- Minimum suite for a ported page:
  1. renders all regions in the artifact tree;
  2. primary action produces the documented behavior;
  3. every state in the handover matrix renders;
  4. keyboard-only path completes the main task;
  5. axe reports no violations on the default state.

## 9. Acceptance checklist

1. `tsc --noEmit` passes with `strict`; no new `any`.
2. No raw color, shadow or radius literals in component source.
3. Component APIs match the contract's prop table; no undocumented props.
4. Every interactive element is keyboard reachable in visual order.
5. Focus-visible is visible on every control, including icon-only buttons.
6. All states from the handover matrix are implemented and tested.
7. Lists use stable keys; no index keys for reorderable data.
8. Effects have cleanup; no state updates after unmount.
9. Images reserve space; icons are inline SVG with `currentColor`.
10. Axe clean on the page and on each stateful component.
11. Bundle delta is within the agreed budget; no new runtime dependency.
12. The handoff record in `contract.md` §10 is attached to the PR.

## 10. Migration order

1. `tokens.css` + `base.css`.
2. Primitives: `Icon`, `Button`, `Field`/`Input`, `Badge`.
3. Composites: `Card`, `ListItem`, `Disclosure`, `Dialog`.
4. Sections in reading order: header, hero, main content, footer.
5. Page/layout shell with landmarks.
6. Delete the legacy artifact markup only after parity checks pass.

Port one component, review it, then continue. A big-bang port hides regression
sources and makes the freeze rule impossible to audit.
