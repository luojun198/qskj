Segmented pill tabs — switch between a few sibling views (全部 / 收入 / 支出). Controlled.

```jsx
const [tab, setTab] = React.useState("all");
<Tabs
  value={tab}
  onChange={setTab}
  tabs={[
    { value: "all", label: "全部" },
    { value: "in", label: "收入", count: 12 },
    { value: "out", label: "支出", count: 30 },
  ]}
/>
```

Each tab: `{ value, label, icon?, count? }`.
