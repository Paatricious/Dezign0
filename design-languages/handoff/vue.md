# Vue handoff

For Vue 3.4+ with `<script setup lang="ts">` and Single-File Components. Read
[`contract.md`](contract.md) first; this file adds Vue mechanics. Nuxt projects
follow the same component rules plus the framework's routing rules.

Original Dezign0 content.

## 1. Preconditions

- Vue 3.4+ (3.5+ if the project wants `useId()`), Composition API, TypeScript.
- Vite or Nuxt build; no Options API for new components unless the repo already
  standardises on it.
- `tokens.css` is imported once globally; components consume CSS variables.
- The project's styling approach is fixed (scoped CSS, CSS Modules or Tailwind).
  Do not add another.

## 2. File layout

```text
src/
  components/
    DzButton/
      DzButton.vue
      DzButton.test.ts
      index.ts
    DzField/
      DzField.vue
  sections/
    PricingPage/
      PricingPage.vue
  composables/
    useDisclosure.ts
    useFocusTrap.ts
  styles/
    tokens.css        # copied from design/<slug>/tokens.css
    base.css
  App.vue
  main.ts
```

- One SFC per component folder, plus its test and `index.ts` re-export.
- Prefix shared primitives with a short project prefix (`DzButton`) so they are
  distinguishable from domain components.
- Composables hold reusable behavior; components hold markup and layout.

## 3. Conventions

- `<script setup lang="ts">` first, then `<template>`, then `<style scoped>`.
- Props and emits are type-only declarations; no runtime object duplicates.
- `withDefaults` for defaults; never mutate props.
- Emit names are kebab-case in templates, camelCase in `defineEmits` types.
- One root element per component when attribute fallthrough matters; otherwise set
  `inheritAttrs: false` and bind `$attrs` intentionally.
- `v-html` is banned unless the project has a sanitised, reviewed use case.
- No `$refs` chains for behavior; use `ref`/`computed` and composables.

## 4. Artifact → Vue primitives

| Artifact | Vue |
|---|---|
| `<button class="btn btn--primary">` | `<DzButton variant="primary">` |
| `<a class="btn" href>` | `<DzButton as="a" href>` or a `DzLink` that keeps the anchor |
| `<input>` + `<label>` + error text | `<DzField label :error>` owning ids and `aria-describedby` |
| Repeated list rows | `v-for` with `:key="item.id"`; never the index for reorderable data |
| `<details>`/`<summary>` | `useDisclosure` + `aria-expanded`, or native `<details>` if no animation |
| `<dialog>` | `<Teleport to="body">` + focus trap + `aria-modal` |
| `<img>` | `<img>` with `width`, `height`, `alt`; no lazy-load above the fold |
| Inline SVG icon | Icon component with `currentColor` and `aria-hidden` |
| Tabs, menu, combobox | Headless component or composable with full ARIA wiring; do not hand-roll roving focus twice |

## 5. Component skeleton

```vue
<!-- src/components/DzButton/DzButton.vue -->
<script setup lang="ts">
import { computed } from "vue";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  { variant: "primary", size: "md", loading: false, disabled: false, type: "button" },
);

const emit = defineEmits<{ click: [event: MouseEvent] }>();

const classes = computed(() => [
  "dz-button",
  `dz-button--${props.variant}`,
  `dz-button--${props.size}`,
]);
const isDisabled = computed(() => props.disabled || props.loading);

function handleClick(event: MouseEvent) {
  if (isDisabled.value) return;
  emit("click", event);
}
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    @click="handleClick"
  >
    <span v-if="loading" class="dz-button__spinner" aria-hidden="true" />
    <slot v-else name="icon" />
    <span><slot /></span>
  </button>
</template>

<style scoped>
.dz-button {
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
.dz-button--primary { background: var(--accent); color: var(--accent-on); }
.dz-button--primary:hover { background: var(--accent-hover); }
.dz-button--primary:active { background: var(--accent-active); }
.dz-button--secondary { background: transparent; border-color: var(--border); color: var(--fg); }
.dz-button--sm { min-height: 32px; padding-inline: var(--space-3); }
.dz-button--lg { min-height: 48px; padding-inline: var(--space-6); }
.dz-button:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.dz-button:disabled { opacity: 0.55; cursor: not-allowed; }
.dz-button__spinner {
  width: 1em; height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-pill);
}
</style>
```

Notes:

- `class` is not a declared prop; attribute fallthrough merges it with `:class`.
- `@click` on a native `disabled` button does not fire; the guard exists for the
  `aria-disabled` variant some projects use instead.
- Scoped styles keep the token names; no colour literal appears in the SFC.
- Emitting `click` duplicates the native event. Only do it when the parent should
  not have to know the internal element; otherwise let `@click` fall through.

## 6. State

| Situation | Mechanism |
|---|---|
| Open/closed, selected tab, expanded row | `ref` in the owning component; extract `useDisclosure` after the second use |
| Two-way bound value | `defineModel<T>()` (3.4+) with a required/optional contract |
| Derived values | `computed`, never a `watch` that writes state |
| Watch | External side effects only (storage, media query, focus) with `{ flush: "post" }` where DOM is needed |
| Form state | One owner: local `reactive` form or a form library; not both |
| Async data | Discriminated state (`idle`/`loading`/`success`/`error`) in a composable |
| URL state | Vue Router params/query; do not mirror into local state without a sync rule |
| Cross-tree state | `provide`/`inject` for theme/auth/locale; Pinia only if the project already uses it |

Rules:

- Keep `watch` callbacks small and single-purpose; deep watching a large object is
  a performance and correctness risk.
- Do not `watch` a prop to copy it into `ref`. Use the prop directly or
  `defineModel`.
- Composables return state and actions, not DOM nodes. They may own listeners and
  must clean up in `onScopeDispose`/`onUnmounted`.
- Props down, events up. `provide/inject` is for context, not for passing page data.

## 7. Accessibility mechanics

- Label/control association: `:id` + `for`, error and hint text referenced with
  `aria-describedby`; generate ids with a provided prefix or `useId()` on 3.5+.
  A module-level counter breaks SSR hydration — do not use one.
- Dialog: `<Teleport to="body">`, `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby`, initial focus, Tab trap, Escape close, focus restored to the
  trigger.
- Menus/listboxes: roving tabindex or `aria-activedescendant`; arrows move,
  Home/End jump, Enter selects, Escape closes.
- Async status: a polite live region; do not rely on a toast that disappears.
- `v-html` never receives design copy from the artifact; convert it to elements.
- Attribute fallthrough is a feature, not a licence to style internals:
  `:deep()` is allowed only for third-party markup, never to reach into a sibling
  component.

## 8. Testing

- Vitest + `@vue/test-utils`; one test per state transition.
- Accessibility: `vitest-axe` on each component; a keyboard test for every
  interactive control.
- Visual: screenshot per state at the project's breakpoints.
- Minimum page suite: regions render, primary action behaves, all handover states
  render, keyboard-only path completes the task, axe clean.

```ts
// DzButton.test.ts (sketch)
import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import DzButton from "./DzButton.vue";

test("exposes busy state while loading", () => {
  const w = mount(DzButton, { props: { loading: true }, slots: { default: "Save" } });
  expect(w.get("button").attributes("aria-busy")).toBe("true");
  expect(w.get("button").attributes("disabled")).toBeDefined();
});
```

## 9. Acceptance checklist

1. `<script setup lang="ts">` everywhere; no Options API in new code.
2. Props/emits typed; defaults via `withDefaults` or `defineModel`.
3. No prop mutation; no `watch` that copies props into state.
4. No raw colour, shadow or radius literals in SFC styles.
5. Scoped styles only; `:deep()` limited to third-party internals.
6. `v-for` keys are stable ids.
7. Every interactive control is keyboard reachable in visual order.
8. Focus-visible visible on every control; dialogs trap and restore focus.
9. All handover states implemented and tested.
10. Async updates announced in a live region.
11. Teleported layers are labelled and modal-appropriate.
12. Hydration-safe ids (no module counters in SSR).
13. Axe clean on the page and each stateful component.
14. Bundle delta within budget; no new dependency.
15. Handoff record attached (`contract.md` §10).

## 10. Migration order

1. `tokens.css` + `base.css`, imported in `main.ts`.
2. Primitives: icon, button, field/input, badge.
3. Composites: card, list item, disclosure, dialog (with Teleport + focus trap).
4. Sections in reading order; page shell with landmarks.
5. Remove legacy markup after parity checks.

## 11. Common mistakes

| Mistake | Fix |
|---|---|
| Styling child internals with `:deep()` | Expose a prop or slot; keep the boundary |
| `watch` writing derived state | Use `computed` |
| Index keys in `v-for` | Use the item id |
| Declaring `class`/`style` as props | Let attributes fall through |
| Module counter for ids | `useId()` (3.5+) or a provided prefix |
| Dialog without Teleport | Portal to `body` to escape stacking contexts |
| Disabled via CSS class only | `disabled`/`aria-disabled` + real behavior |
| Deep watcher on a whole form | Watch specific fields or use form-library state |
