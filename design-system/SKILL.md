---
name: caiwu-xitougao-design
description: Use this skill to generate well-branded interfaces and assets for 财务洗头膏 (Finance Shampoo), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

财务洗头膏 ("Finance Shampoo") is a Chinese-first fintech brand — bookkeeping/tax made effortless, "washing your books squeaky clean." Warm, witty, trustworthy. Visual world: soap-bubble freshness (aqua-mint + soap-bubble blue + deep teal ink + white, soft rounded forms, gentle cool shadows). Always address the customer as 您; never use emoji; render money in tabular figures with ¥.

Key files:
- `styles.css` — link this one file; it `@import`s all tokens + fonts.
- `tokens/` — color / type / spacing / font custom properties.
- `readme.md` — full content + visual + iconography guidance (READ THIS FIRST).
- `components/` — React primitives (Button, Badge, Avatar, Card, StatTile, Input, Switch, Tabs). Load the generated `_ds_bundle.js` and read `window.DesignSystem_6b732f`.
- `ui_kits/website/` — marketing landing-page recreation to learn the look.
- `assets/` — logo mark, lockup, bubble pattern. Icons = Lucide (CDN).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
