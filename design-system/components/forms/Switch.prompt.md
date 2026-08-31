Controlled toggle — for binary settings (自动同步, 邮件通知). Knob slides with a soft overshoot.

```jsx
const [on, setOn] = React.useState(true);
<Switch checked={on} onChange={setOn} label="自动对账" />
```

Props: `checked`, `onChange(next)`, `disabled`, `label`.
