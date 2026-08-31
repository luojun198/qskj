Primary action button — use for the main CTA on any surface; the `primary` variant carries the signature mint glow, so keep it to one per view.

```jsx
<Button variant="primary" size="lg" onClick={save}>开始清洗</Button>
<Button variant="secondary" icon={<i data-lucide="refresh-cw"></i>}>同步</Button>
<Button variant="ghost" size="sm">取消</Button>
```

Variants: `primary` (mint glow), `secondary` (soap-blue), `soft` / `ghost` / `outline` (quiet), `danger` (coral). Sizes `sm | md | lg`. Props: `icon`, `iconRight`, `fullWidth`, `disabled`.
