# BRIEF.md template

Copy this file, fill it in before designing, and keep it next to the artifact.
A brief with no numbers is not ready. Delete sections only when they genuinely do
not apply.

---

# <Project> — design brief

## 1. What this is

- Product / feature:
- User complaint or goal, in the user's words:
- Who this is for (audience, context of use):
- What success looks like (one measurable sentence):

## 2. Physical constraints (hard)

- Surface / platform:
- Container / cell / viewport:
- Grid / columns / gutters:
- Min size / max size:
- Default size:
- Target sizes (enumerate every one):
  - e.g. 2×2 = 246×148
  - e.g. 18×2 = 2310×148
- Existing tokens / design system:
- Frameworks / build constraints:
- Dependencies allowed: none / self-hosted / list

## 3. Visual system

- Brand system (`DESIGN.md` path) or "propose one":
- Color roles to use:
- Type pairing:
- Spacing / radius / elevation:
- What must not be invented:
- Reference images / URLs:

## 4. Content

- Real copy supplied:
- Copy rules:
- Data that must not be invented:
- Sample data policy:
- Names / locales:

## 5. Accessibility and states

- Required states (default: loading, empty, error, populated, edge):
- Keyboard requirements:
- Target size floor:
- Contrast floor: 4.5:1 body, 3:1 large/UI
- Reduced motion:
- Other (screen reader, RTL, forced colors):

## 6. What to explore

Name the axes for a multi-direction study (delete if single direction):

- Axis 1:
- Axis 2:
- Axis 3:
- Axis 4:
- Axis 5:

Every direction must be credible at every target size, not only the widest.

## 7. Deliverables (numbered)

1. `<file>` — comparison gallery at 1:1 real sizes, theme toggle, edit toggle.
2. `<file>` — standalone direction A at primary size.
3. `<file>` — standalone direction B at primary size.
4. `README.md` — per-direction thesis, 3–4 rationale bullets, metrics table.
5. `TOKENS.md` / `tokens.css` — if the design system is new or changed.

- Format: single-file HTML / framework / other
- Do not port to a framework unless asked.
- Do not add unrequested deliverables.

## 8. Acceptance

- The artifact opens and the primary flow works.
- Every target size tested; no horizontal scroll; nothing clipped.
- All states exist.
- Tokens only; no raw hex outside the token block.
- All controls keyboard reachable with visible focus.
- Contrast measured.
- Known limits listed.

## 9. Assumptions

List every assumption made for a missing field. One line each, with the risk.

---

## Filled example (abbreviated)

> **Widget slot:** 18-column grid, 129px columns, 80px rows, 6px cell padding,
> 8px radius. Default 2×2 (246×148 inner). Five targets: 2×2, 3×2, 4×2, 6×2,
> 9×2.
> **System:** Space Grotesk; tokens 16/13/11/10; card/background/border from the
> existing theme; one accent; exact values in `tokens.css`.
> **Explore:** density model, tile anatomy, icon treatment, label typography,
> add affordance. Each must work at all five sizes.
> **Deliverables:** one gallery at 1:1, five standalone files, README with tile
> metrics; HTML only; no new dependencies.
