# 财务洗头膏 · Finance Shampoo — Design System

> 您的财务专家。把账目洗得干干净净。
> *Your finance expert. Washes your books squeaky clean.*

财务洗头膏 ("Finance Shampoo") is a **Chinese-first fintech brand** — bookkeeping, reconciliation, and tax made effortless. The name is a wink: we *wash away your financial mess*. The brand is **warmer and wittier than a bank**, but every bit as trustworthy. Visually it lives in a world of **soap-bubble freshness**: aqua-mint, soap-bubble blue, deep teal ink, lots of white, soft rounded forms, and gentle cool-tinted shadows.

This is a **greenfield brand** — there is no prior codebase, Figma, or asset library. Everything here was authored from the brand concept. The primary surface defined so far is the **marketing website**.

**Sources given:** none (concept-only brief: company = 财务洗头膏; Chinese-first; "clean & trustworthy fintech, warmer and wittier than banks"; color feel = fresh aqua/mint + soap-bubble blues; surface = marketing website; personality = 您的财务专家).

---

## How to consume this system

- Link **one** stylesheet: `styles.css` (an `@import` manifest reaching all tokens + fonts).
- Read components off the runtime namespace after loading the generated bundle:
  ```html
  <script src="/_ds_bundle.js"></script>
  <script type="text/babel">
    const { Button, Card, StatTile } = window.DesignSystem_6b732f;
  </script>
  ```
- Style everything with the CSS custom properties below — never hardcode hexes.

---

## CONTENT FUNDAMENTALS — how we write

**Language.** Chinese-first (Simplified). English appears as accents: the latin logotype (FINANCE SHAMPOO), mono labels/codes (`TXN-2026-0042`), and the occasional eyebrow (`LIVE SYNC`). Never machine-translated Chinglish.

**Address.** Always **您** (polite "you"), never 你 or 亲. We talk *to* the customer, warmly and directly. We say "我们" (we) when describing what the product does for them.

**Tone.** Plain-spoken, confident, lightly witty. We use the shampoo/washing metaphor **sparingly** and only when it lands — "把账目洗得干干净净", "洗一洗" — never forced. We sound like a sharp friend who happens to be a great accountant, not a corporate brochure and not a hyperactive marketer.

**Casing & punctuation.** Chinese uses full-width punctuation（，。！）. Keep exclamation marks rare — at most one, for genuine delight. No "！！". English overlines are UPPERCASE with wide tracking.

**Do**
- 把账目洗得干干净净。
- 需要报税时，功课我们替您做好了——您只管签字。
- 三步，搞定。

**Don't**
- 赋能您的财税数字化转型闭环。 *(empty buzzwords)*
- 本产品旨在为用户提供…… *(stiff, third-person)*
- 亲～快来体验吧！！😆 *(over-familiar, emoji spam)*

**Emoji.** Not used in product UI or marketing copy. Status is shown with the bubble mark, badges, semantic colors, and Lucide icons — never emoji.

**Numbers.** Money and metrics are first-class. Always render figures in tabular Space Grotesk with `font-variant-numeric: tabular-nums`, prefix `¥`, group thousands: `¥1,284,906.50`.

---

## VISUAL FOUNDATIONS

**Concept.** Soap-bubble freshness. Clean water, a single iridescent bubble, foam catching light. Everything should feel *rinsed*: airy, bright, weightless.

**Color.** Primary is **aqua-mint** (`--brand` = `--mint-500` `#12C7AE`) — the wash. Secondary is **soap-bubble blue** (`--secondary` = `--blue-500` `#2E84F5`) — the second bubble, used for links/info and the signature gradient. Neutrals (`--ink-*`) are **cool, teal-tinted greys**, never pure grey. A faint **iridescent lilac** (`--lilac-*`) is reserved for bubble-shimmer accents — used *very* sparingly. Backgrounds are white or the faint-mint canvas (`#F3FAF9`). Semantic: success green, amber warning, coral danger, blue info — each paired with a soft tint.

**Type.** `Noto Sans SC` carries all Chinese (UI, headings, body) — weights 400/500/700/900. `Space Grotesk` handles Latin display and **all numerals** (tabular). `Space Mono` is for ledger labels, codes, metadata, and overlines. CJK body runs a generous `1.75` line-height for breathing room. Headlines are tight (`-0.02em`), heavy (900), and confident.

**Backgrounds.** Mostly clean white / faint-mint canvas. Heroes and empty states get a soft radial **rinse** wash (`--grad-rinse`) and an optional scattered **bubble motif** (`assets/bubble-pattern.svg`) — decorative, low-opacity, never busy. No photography by default; no heavy textures. The signature gradient (`--grad-bubble`, mint→blue) appears on the primary CTA, the logo mark, and the occasional accent — used as a jewel, not wallpaper.

**Shape & corners.** Bubbly. Generous radii: cards `--radius-lg` (20px), buttons `--radius-md/lg`, pills everywhere (`--radius-pill`). Avatars and switch knobs are full circles. Nothing is sharp-cornered.

**Cards.** White surface, `1px` `--border-subtle` hairline, `--radius-lg`, soft shadow `--shadow-sm` at rest → `--shadow-lg` + 3px lift on hover (interactive cards only). Many surfaces also carry a top inner `--sheen` highlight that reads like light on a bubble.

**Shadows.** Soft and **cool teal-tinted** (`rgba(12,42,46,…)`), low-opacity, generous blur — never harsh black drop shadows. Primary CTAs and "on" switches get a colored **mint glow** (`--shadow-mint`); blue elements get `--shadow-blue`. `--sheen` is an inner-top white highlight for the bubble sheen.

**Borders & lines.** Hairline, cool. `--border-subtle` for dividers, `--border-default` for inputs, `--border-brand` (mint-300) for selected/branded edges. Focus is a `4px` soft mint ring (`--focus-ring`), never a hard outline.

**Motion.** Gentle. Default easing `--ease-out` (soft decelerate); interactive knobs/pills use `--ease-bubble` (a soft overshoot, like a bubble settling). Durations 140/240/420ms. Fades and slides, no spinning or bouncing loops. Buttons press with a tiny `translateY(1px) scale(0.98)`.

**Hover / press states.** Hover = darker fill (mint-500→600) or a soft tint wash for quiet variants; cards lift. Press = slight shrink + the glow drops. Links go `--blue-600`. No opacity-dimming as the primary hover signal.

**Transparency & blur.** Used lightly — frosted pills over imagery (`backdrop-filter: blur`), the overlay scrim `--surface-overlay`. Not a glassmorphism system.

**Imagery vibe.** Cool, bright, fresh — if photography is added later it should be airy and clean (think clear water, soft daylight), never warm/grainy/moody.

**Iconography vibe.** Rounded, friendly, consistent stroke. See ICONOGRAPHY.

---

## ICONOGRAPHY

The brand uses **Lucide** (https://lucide.dev) — rounded caps/joins, ~2px stroke — which matches the soft, fresh, bubbly feel. There is no custom icon font.

> ⚠️ **Substitution flag:** Lucide is a chosen stand-in (loaded from CDN), not a bespoke icon set. If you commission a custom icon family later, keep the rounded-stroke character and swap it in. Pin the version in production rather than `@latest`.

**Usage**
- Load: `<script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>`, place `<i data-lucide="wallet"></i>`, then call `lucide.createIcons()`.
- Default stroke `2`, size `20–24`. Use `--ink-600` for neutral icons, `--mint-600` on soft mint chips, currentColor inside buttons.
- **No emoji**, no unicode-glyph icons. Status uses badges + semantic color.
- The **soap-bubble mark** (`assets/logo-mark.svg`) is the brand's hero glyph — use it for empty states, loaders, and favicons.

**Brand assets** (`assets/`)
- `logo-mark.svg` — the soap-bubble mark (iridescent rim + specular highlight).
- `logo-lockup.svg` — mark + 财务洗头膏 wordmark + FINANCE SHAMPOO overline.
- `bubble-pattern.svg` — scattered-bubbles decorative motif for heroes / empty states.

---

## Index — what's in this folder

**Foundations**
- `styles.css` — entry point (`@import` manifest; link this).
- `tokens/colors.css` · `typography.css` · `spacing.css` · `fonts.css` — all CSS custom properties + webfont loading.
- `guidelines/*.html` — foundation specimen cards (Colors, Type, Spacing, Brand) shown in the Design System tab.
- `assets/` — logo mark, lockup, bubble pattern.

**Components** (`window.DesignSystem_6b732f`)
- `components/core/` — **Button**, **Badge**, **Avatar**, **Card**, **StatTile**
- `components/forms/` — **Input**, **Switch**
- `components/navigation/` — **Tabs**
- Each has `<Name>.jsx`, `<Name>.d.ts`, `<Name>.prompt.md`, plus one `@dsCard` HTML per directory.

**UI kits**
- `ui_kits/website/` — marketing landing page recreation (`index.html` + section JSX).

**Meta**
- `SKILL.md` — Agent-Skill manifest (works in Claude Code).
- `readme.md` — this file.

*Generated automatically (do not edit): `_ds_bundle.js`, `_ds_manifest.json`, `_adherence.oxlintrc.json`.*

---

## Caveats
- **Fonts** load from Google Fonts (`Noto Sans SC`, `Space Grotesk`, `Space Mono`) via `@import` rather than self-hosted woff2 — so the manifest reports zero bundled font binaries. Swap in self-hosted files for offline/CDN-independent builds.
- **Icons** use Lucide as a stand-in (see flag above).
- All copy, palette, and logo are invented for this greenfield brand — refine to taste.
