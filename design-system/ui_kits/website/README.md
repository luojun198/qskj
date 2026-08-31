# UI Kit — Marketing Website

A high-fidelity recreation of the 财务洗头膏 marketing landing page, composed entirely from the design-system primitives (`window.DesignSystem_6b732f`).

## Run
Open `index.html`. It loads `styles.css`, the generated `_ds_bundle.js`, Lucide icons, then mounts the section files.

> The page reads components from the compiled bundle (`../../_ds_bundle.js`). In the live Design System tab this is served automatically. If you copy this kit elsewhere, keep the relative path to the project root correct.

## Structure
- `index.html` — assembles the page (`Nav → Hero → Features → HowItWorks → Pricing → CTA → Footer`).
- `Nav.jsx` — sticky frosted top bar with logo lockup + primary CTA.
- `Hero.jsx` — headline + copy + dual CTA, and a **live mini-dashboard mock** (StatTile / Tabs / transaction rows) showing the product.
- `Features.jsx` — 4-up feature grid, the 3-step "三步，搞定" section, and the shared `SectionHead`.
- `Pricing.jsx` — three tiers; the middle "团队版" is featured (mint border + lift + badge).
- `CTA.jsx` — closing bubble-gradient band + dark footer.

## Notes
- Sections export themselves to `window.WS*` so `index.html` can compose them across separate Babel scripts.
- All color, type, spacing, shadow, and radius values come from CSS custom properties — no hardcoded hexes.
- Copy follows the brand voice: 您-form, plain-spoken, the shampoo metaphor used sparingly, no emoji.
