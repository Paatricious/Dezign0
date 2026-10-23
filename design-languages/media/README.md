# Media pack

Briefs for the images and motion assets a design artifact needs — hero
backgrounds, empty-state art, documentation plates, social cards, and short
UI-motion storyboards.

**This is a pack of text briefs, not a generator.** There is no generation API,
no endpoint, no key, no model call, no script that talks to a service, and no
bundled image or video file. Each entry is a prompt or storyboard you paste into
whatever image or video tool you already use, and the output is yours under that
tool's terms.

Why text and not assets: licensing and provenance stay clean, the pack stays
small, and the brief remains reviewable. A generated asset is a design decision
and gets reviewed like any other asset.

| File | Contents |
|---|---|
| [image-prompts.json](image-prompts.json) | 8 original prompts: `id`, `title`, `useCase`, `aspect`, `prompt`, `negative` |
| [video-storyboards.json](video-storyboards.json) | 5 original storyboards: `id`, `title`, `useCase`, `duration`, `format`, `scenes[]` |

Both files are original to Dezign0 and carry the pack's Apache-2.0 licence. No
third-party prompt text is copied into either file.

---

## 1. `image-prompts.json`

Top level:

```json
{
  "schema": "dezign0/media/image-prompts/v1",
  "count": 8,
  "note": "Original prompt briefs. No generation API is included.",
  "prompts": [ /* … */ ]
}
```

Each prompt has exactly six fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable kebab-case identifier, unique in the file. Use it as the asset filename stem. |
| `title` | string | Human label for the picker or the asset library. |
| `useCase` | string | When to choose this brief, and the artifact surface it fits. Written so an agent can select on it. |
| `aspect` | string | Target ratio with a recommended pixel size, e.g. `"16:9 (1920×1080)"`. Crop to it; do not let the model invent a ratio. |
| `prompt` | string | Original positive instructions: subject, composition, light, material, palette, rendering, and technical constraints. Self-contained — it must work without this README. |
| `negative` | string | Comma-separated exclusions. Always covers text, logos and watermarks; add per-brief exclusions. |

Prompt-writing rules used here, and required for new entries:

- Describe what should be **in** the frame (subject, geometry, light, palette,
  texture, finish). Do not name artists, studios, films, brands or living people.
- No request for legible text in the image. UI copy belongs in the artifact's
  HTML, not baked into a bitmap.
- No real people, faces of identifiable individuals, or trademarked characters.
- State the technical intent: sharpness, noise level, depth of field, flatness of
  colour, margin behaviour at the edges.
- Keep one idea per prompt. If a brief needs two subjects, it is two prompts.

Using an entry:

1. Pick the `id` whose `useCase` matches the surface. If none matches, write a new
   entry rather than stretching one.
2. Paste `prompt` and `negative` into the tool, set the ratio from `aspect`.
3. Place the result under `design/<slug>/assets/<id>.webp` (or the project's asset
   convention), record the crop and any focal point, and note provenance in
   `design/<slug>/MEMORY.md`: tool, model/version, date, prompt `id`.
4. Review the asset before shipping it: does it carry unintended text, logos,
   hands, duplicated objects, or a focal point that dies when cropped to the
   narrow viewport? Generated art is content, and content gets reviewed.

### The eight briefs at a glance

| `id` | Ratio | Surface |
|---|---|---|
| `hero-aurora-dawn` | 16:9 | Landing hero background, no photography |
| `empty-state-desk` | 1:1 | Empty-state illustration, calm and literal |
| `dashboard-grain-overlay` | 3:2 | Low-contrast texture behind a data surface |
| `clay-ui-maquette` | 4:5 | Editorial product-section image |
| `og-social-plate` | 1.91:1 | 1200×630 share card, text added in HTML |
| `onboarding-phone-stand` | 9:16 | Mobile onboarding art, no faces |
| `isometric-system-plate` | 4:3 | Documentation / architecture plate |
| `avatar-shape-set` | 1:1 | Non-human placeholder avatars |

## 2. `video-storyboards.json`

Top level:

```json
{
  "schema": "dezign0/media/video-storyboards/v1",
  "count": 5,
  "note": "Original motion briefs. No generation API is included.",
  "storyboards": [ /* … */ ]
}
```

Each storyboard:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable kebab-case identifier, unique in the file. |
| `title` | string | Human label. |
| `useCase` | string | The surface and moment this motion serves. |
| `duration` | string | Total runtime, e.g. `"6s"`. Must equal the sum of scene durations. |
| `format` | string | Ratio, resolution, frame rate, container/codec, loop or one-shot, and whether text is baked in. |
| `scenes` | array | Ordered scenes; this is the brief. |

Each scene:

| Field | Type | Meaning |
|---|---|---|
| `index` | number | 1-based order. |
| `start` / `end` | string | Timecodes, `"0:00"`–`"0:06"` style, inclusive start and exclusive end. |
| `duration` | string | Scene length, e.g. `"2s"`. |
| `shot` | string | Framing label: `wide`, `medium`, `close`, `element-detail`. |
| `camera` | string | Movement only: `static`, `slow push in`, `lateral drift`, `pan left→right`, `pull back`. |
| `action` | string | What changes on screen, in one sentence. |
| `onScreenText` | string | Text that must be typeset in the edit, or `none`. Never ask a video model to render legible copy. |
| `audio` | string | Cue description — pad, click, whoosh, silence. No licensed track is bundled. |

Rules:

- Duration and timecodes must add up. A storyboard whose scenes do not sum to
  `duration` is invalid; validate before handing it to an editor.
- Motion serves hierarchy or a state change. Decorative motion needs a
  `prefers-reduced-motion` counterpart in the artifact; state that in `useCase`.
- A loop storyboard's last frame must match its first frame. Say `seamless loop`
  in `format` and describe the settle in the final scene.
- UI-motion storyboards describe a transition the product can also do in code.
  If it cannot, it is a marketing film, not a UI motion spec — mark it as such.

### The five storyboards at a glance

| `id` | Duration | Ratio | Use |
|---|---|---|---|
| `hero-loop-drift` | 6s | 16:9 | Seamless hero background loop |
| `empty-to-populated` | 15s | 9:16 | Mobile list state transition |
| `redesign-wipe` | 10s | 16:9 | Before/after reveal for a redesign case study |
| `dashboard-tour-pan` | 20s | 16:9 | Slow product tour across a dashboard |
| `brand-sting-build` | 4s | 1:1 | Shape-assembly sting for a social clip |

## 3. Validation

No dependencies; run from the pack root.

```bash
node -e "for (const f of ['image-prompts.json','video-storyboards.json']) { const j=JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(f, j.schema, j.count) }"

node -e "
const fs=require('fs');
const img=JSON.parse(fs.readFileSync('image-prompts.json','utf8'));
const vid=JSON.parse(fs.readFileSync('video-storyboards.json','utf8'));
const fields=['id','title','useCase','aspect','prompt','negative'];
if(img.prompts.length!==img.count) throw new Error('image count');
for(const p of img.prompts){for(const k of fields) if(typeof p[k]!=='string'||!p[k].trim()) throw new Error('image '+p.id+' missing '+k)}
const ids=[...img.prompts.map(p=>p.id),...vid.storyboards.map(s=>s.id)];
if(new Set(ids).size!==ids.length) throw new Error('duplicate id');
const secs=(t)=>{const [m,s]=t.split(':').map(Number);return m*60+s};
for(const sb of vid.storyboards){
  const total=Number(sb.duration.replace('s',''));
  const sum=sb.scenes.reduce((a,sc)=>a+Number(sc.duration.replace('s','')),0);
  if(sum!==total) throw new Error(sb.id+' scene durations '+sum+' != '+total);
  for(const sc of sb.scenes) if(secs(sc.end)-secs(sc.start)!==Number(sc.duration.replace('s',''))) throw new Error(sb.id+' timecode '+sc.index);
}
console.log('media pack ok:', img.count, 'prompts,', vid.count, 'storyboards');
"
```

A new entry keeps the exact field set: extra keys make the file harder to consume
and are not part of this schema.

## 4. Provenance and licensing

- All prompt and storyboard text in this directory was written for Dezign0. No
  text is copied from a prompt library, a marketplace, an article or another
  product.
- The pack is Apache-2.0 with the rest of `design-languages/`. See
  `../LICENSE` and `../ATTRIBUTION.md`.
- Generated output belongs to whoever runs the generator, under that tool's
  terms. Nothing here grants rights to a model, a style, a brand or a person's
  likeness.
- Assets produced from these briefs must be recorded (brief `id`, tool, date) in
  the artifact's memory file so a later reviewer can reproduce or replace them.
- No generation API, key, endpoint, or network call ships with this pack.
  Anything that generates is supplied by the user and run outside Dezign0.

## 5. Packaging and discovery

This directory is part of the optional `dezign0-design-languages` content pack.
The pack's `package.json` lists `media/` in `files`, and `addons/index.json`
catalogs `media/image-prompts.json` and `media/video-storyboards.json` as
`media-image-prompts` and `media-video-storyboards`; the `media-brief` skill
selects from them through the `dezign0_addons` tool (`action=list|search|get`,
section `media`). Nothing here is loaded by the core `dezign0` plugin.
