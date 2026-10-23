# Next.js handoff

For a Next.js App Router project (15+). Read [`contract.md`](contract.md) first;
this file covers the server/client split, routing, metadata, fonts and images.
For the Pages Router, use [`react.md`](react.md) and add `_document`/`_app`
notes yourself.

Original Dezign0 content.

## 1. Preconditions

- App Router is in use (`app/` with `layout.tsx`). If the project is Pages Router,
  stop and confirm before porting a different architecture than the repo uses.
- The artifact's regions map cleanly to routes and layouts; if the artifact is a
  single long page, keep it as one route until there is a reason to split.
- `tokens.css` is imported once in the root layout.
- The project already has a styling approach (CSS Modules or Tailwind). Do not add
  the other one.

## 2. File layout

```text
app/
  layout.tsx                 # <html>, fonts, tokens import, theme bootstrap
  globals.css                # reset + element defaults; imports tokens.css
  page.tsx                   # home route (server component)
  (marketing)/
    pricing/
      page.tsx
      loading.tsx
      error.tsx
  components/
    Button/{Button.tsx,Button.module.css}
    BillingToggle/{BillingToggle.tsx,BillingToggle.module.css}
  styles/
    tokens.css               # copied from design/<slug>/tokens.css
```

- Route groups (`(marketing)`) organise layouts without changing URLs.
- Components used by one route may be colocated under that route folder; shared
  components live in `app/components/`.
- A component folder never contains a route file.

## 3. Server first, client at the leaves

Every component is a server component until it needs the browser.

| Need | Boundary |
|---|---|
| Static markup, content, layout, data reads | Server component (default) |
| `useState`/`useReducer`, event handlers | Mark `"use client"` on that file |
| `useEffect`, refs, focus management, portals | Client |
| `window`, `document`, `localStorage`, `matchMedia` | Client-only (or a theme bootstrap script) |
| Router hooks (`usePathname`, `useSearchParams`) | Client |
| Secrets, database, server-only packages | Server only; never imported into a client file |

Rules:

- Put `"use client"` at the smallest interactive leaf (toggle, menu, dialog), not
  at the page root.
- Props crossing into a client component must be serialisable: no functions, no
  class instances, no `Date` passed casually.
- Interleave instead of marking whole trees client: a server page can pass
  server-rendered children into a client wrapper.

```tsx
// app/(marketing)/pricing/page.tsx — server
import { PlanCard } from "@/components/PlanCard/PlanCard";
import { BillingToggle } from "@/components/BillingToggle/BillingToggle";

export default async function PricingPage({
  searchParams,
}: {
  // Next 15+: searchParams is a Promise
  searchParams: Promise<{ billing?: "monthly" | "annual" }>;
}) {
  const { billing = "monthly" } = await searchParams;
  return (
    <main id="main">
      <h1>Pricing</h1>
      <BillingToggle value={billing} />
      <section aria-label="Plans">
        <PlanCard name="Starter" price={billing === "annual" ? 8 : 10} />
        <PlanCard name="Team" price={billing === "annual" ? 24 : 30} featured />
      </section>
    </main>
  );
}
```

`BillingToggle` is the only client file; it pushes the new value into the URL so
the server re-renders the prices. That keeps one source of truth and makes the
state deep-linkable.

## 4. Routing and states

- `loading.tsx` per route renders the skeleton that matches the artifact's
  loading state, not a generic spinner.
- `error.tsx` is a client component; it must offer a retry and keep the page's
  visual language.
- `not-found.tsx` uses the artifact's empty-state pattern, not browser default.
- Streaming: wrap slow sections in `<Suspense fallback={...}>`; the fallback must
  reserve the same space to avoid layout shift.
- Dynamic vs static is a data decision, not a style decision. Do not mark a page
  dynamic just to avoid a caching bug.

## 5. Metadata

The artifact's visible headings are not metadata. Set it explicitly:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Acme",
  description: "Compare plans and choose the one that fits your team.",
  alternates: { canonical: "/pricing" },
  openGraph: { title: "Pricing — Acme", description: "Compare plans." },
};
```

- One `metadata` or `generateMetadata` per route; do not duplicate in layouts
  unless it is genuinely inherited.
- `metadataBase` belongs in the root layout.
- Title/description come from the brief or the artifact copy — never invented
  marketing claims. The lint rules on invented metrics apply to metadata too.

## 6. Styling, tokens and theme

- Import tokens once: `app/globals.css` → `@import "../styles/tokens.css";` then
  base rules. CSS Modules per component.
- Theme switching: one mechanism. Set `data-theme` on `<html>` from a tiny inline
  bootstrap script so the first paint has the right mode:

```tsx
// app/layout.tsx (excerpt)
import "./globals.css";

const themeBootstrap = `try{const t=localStorage.getItem("theme");const d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.dataset.theme="dark"}catch{}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

The string is a constant, not user input. `suppressHydrationWarning` is limited to
the `<html>` element, where the class/attribute genuinely differs before
hydration.

- Tailwind projects: map tokens into the theme (`@theme` in Tailwind v4) so
  utilities emit the same `var(--*)` values. Do not hand-maintain a second palette.
- A token override is a deviation: if `next/font` must own a family token, record
  the single override in the handoff record and keep the fallback stack intact.
- Never use `useEffect` to set the theme after paint; that is the flash of wrong
  theme the artifact did not have.

## 7. Fonts

```tsx
// app/layout.tsx
import localFont from "next/font/local";

const display = localFont({
  src: "./fonts/Display.woff2",
  weight: "400 700",
  variable: "--font-display-file",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
```

- Self-host only with a licence; `next/font/local` fingerprints and preloads.
- Load only the weights the artifact uses. A `font-weight` above the loaded range
  is silently clamped.
- Match a fallback metric (`size-adjust`, `ascent-override`) when the swap is
  visible, or accept the documented CLS.
- `display: "swap"` is a decision, not a default; record it.

## 8. Images and icons

- `next/image` with explicit `width`/`height` (or `fill` plus a sized parent) and
  `sizes` when the rendered width varies.
- `priority` only for the LCP image; lazy is the default elsewhere.
- Remote images require `images.remotePatterns` — prefer exporting assets from the
  artifact into the repo instead.
- Icons stay inline SVG components with `currentColor`; `next/image` is for raster
  assets, not icons.
- Alt text decisions come from the design handover; do not derive alt text from
  filenames.

## 9. State and mutations

| State | Owner |
|---|---|
| Filters, tabs, pagination, sort | URL (`searchParams`) so the server renders the right markup |
| Ephemeral UI (open menu, hovered row) | Client component |
| Form input | Client component + server action or API route |
| Auth/session | Server (cookies) — never client storage |
| Persisted preference (theme, density) | Cookie or `localStorage` + bootstrap |

- Server actions: validate on the server, return field errors, and surface pending
  state with `useFormStatus` or an explicit pending flag. Disable the submit
  control while pending and announce the result in a live region.
- Optimistic updates are allowed only when the rollback path is visible and
  tested.
- Do not fetch in `useEffect` what the server component can read directly.

## 10. Accessibility specifics

- Server components still own semantics: landmarks, heading order, lists, tables.
- `id` generation must be hydration-safe: `useId` in client components; explicit
  ids in server components only when they are deterministic.
- Client-only widgets must render a usable server fallback (or be wrapped in
  `Suspense`) — a menu that only exists after hydration is an accessibility
  regression.
- Focus management for route changes: move focus to the `h1` or main region on
  navigation; restore focus after dialogs.
- Theme bootstrap must not break forced-colors users; test with system colours.

## 11. Acceptance checklist

1. Only leaves with real interactivity carry `"use client"`.
2. No server-only module is imported by a client file.
3. No hydration warnings in dev or production build.
4. `searchParams`/`params` are awaited where the Next version requires it.
5. Metadata is set per route and matches the artifact copy.
6. Tokens are imported once; no raw colour literals in components.
7. Theme is correct on first paint (no flash), with one switching mechanism.
8. Fonts load the used weights; fallback metrics do not shift the layout.
9. Images have dimensions, `sizes`, and alt decisions from the handover.
10. Every route has loading/error/not-found states that match the artifact.
11. Forms: pending state announced; validation errors linked with
    `aria-describedby`.
12. Keyboard-only pass completes the main task on every route.
13. Axe clean on each route and each interactive state.
14. `next build` passes; no new dependency outside the agreed budget.
15. Handoff record attached (`contract.md` §10).

## 12. Common failures

| Failure | Fix |
|---|---|
| `"use client"` on `page.tsx` | Move it to the interactive leaf; pass data as props |
| `window is not defined` | Access browser APIs in an effect or client component |
| Flash of light theme | Bootstrap script in `<head>`, not `useEffect` |
| Hydration mismatch on dates/ids | Deterministic ids; format dates on the server |
| Passing a function to a client component | Pass data + a client-side handler, or lift the interaction |
| `next/image` without dimensions | Explicit width/height or a sized `fill` parent |
| Server action without pending UI | `useFormStatus` + disabled control + live region |
| Caching personal data | Mark the route dynamic or move data to a personalised client fetch |
