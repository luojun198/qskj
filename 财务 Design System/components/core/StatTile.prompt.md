Dashboard metric tile — a labelled KPI with a big tabular figure and optional up/down delta.

```jsx
<StatTile label="本月支出" value="12,480.00" delta="+8.2%" icon={<i data-lucide="trending-up"></i>} />
<StatTile label="待对账" value="3" unit="" delta="-2" />
```

Props: `label`, `value` (pre-formatted), `unit` (default ¥), `delta`, `icon`.
