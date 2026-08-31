// Marketing site — hero with a live mini-dashboard mock
const { Button, Badge, StatTile, Tabs, Card } = window.DesignSystem_6b732f;

function HeroDashboard() {
  const [tab, setTab] = React.useState("out");
  const rows = [
    { name: "顺丰速运", cat: "物流", amt: "-128.00", tone: "neutral" },
    { name: "阿里云 · 服务器", cat: "技术", amt: "-1,280.00", tone: "neutral" },
    { name: "客户回款 · 蓝湖", cat: "收入", amt: "+18,000.00", tone: "success" },
    { name: "美团 · 团队午餐", cat: "餐饮", amt: "-326.50", tone: "neutral" },
  ];
  return (
    <Card padding={0} style={{ overflow: "hidden", boxShadow: "var(--shadow-xl)" }}>
      <div style={{ padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="../../assets/logo-mark.svg" alt="" style={{ width: 26, height: 26 }} />
          <span style={{ font: "var(--w-bold) 16px var(--font-sans)", color: "var(--text-strong)" }}>本月概览</span>
        </div>
        <Badge tone="success" dot>已实时同步</Badge>
      </div>
      <div style={{ padding: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <StatTile label="本月支出" value="12,480.00" delta="+8.2%" icon={<i data-lucide="trending-down"></i>} />
        <StatTile label="本月收入" value="38,900.00" delta="+15%" icon={<i data-lucide="wallet"></i>} />
      </div>
      <div style={{ padding: "0 22px 8px" }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "all", label: "全部" }, { value: "out", label: "支出" }, { value: "in", label: "收入" }]} />
      </div>
      <div style={{ padding: "6px 12px 16px" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderRadius: "var(--radius-md)" }}>
            <span style={{ width: 34, height: 34, borderRadius: "var(--radius-sm)", background: "var(--mint-50)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--mint-600)" }}>
              <i data-lucide={r.tone === "success" ? "arrow-down-left" : "arrow-up-right"}></i>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ font: "var(--w-medium) 14px var(--font-sans)", color: "var(--text-strong)" }}>{r.name}</div>
              <div style={{ font: "var(--w-regular) 12px var(--font-sans)", color: "var(--text-muted)" }}>{r.cat}</div>
            </div>
            <span style={{ font: "var(--w-bold) 15px var(--font-num)", fontVariantNumeric: "tabular-nums", color: r.tone === "success" ? "var(--success)" : "var(--text-strong)" }}>
              ¥{r.amt}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Hero() {
  return (
    <section style={{ position: "relative", overflow: "hidden", background: "var(--grad-rinse)" }}>
      <img src="../../assets/bubble-pattern.svg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.5, pointerEvents: "none" }} />
      <div style={{ position: "relative", maxWidth: "var(--container)", margin: "0 auto", padding: "84px 32px 96px", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 56, alignItems: "center" }}>
        <div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: "var(--radius-pill)", background: "var(--white)", boxShadow: "var(--shadow-sm)", font: "var(--w-bold) 12px var(--font-mono)", letterSpacing: "0.08em", color: "var(--mint-700)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            <i data-lucide="sparkles" style={{ width: 14, height: 14 }}></i> 您的财务专家
          </span>
          <h1 style={{ margin: "22px 0 0", font: "var(--w-black) 58px/1.08 var(--font-sans)", letterSpacing: "var(--ls-tight)", color: "var(--text-strong)" }}>
            把账目<br />洗得干干净净
          </h1>
          <p style={{ margin: "22px 0 0", maxWidth: 440, font: "var(--w-regular) 18px/1.75 var(--font-sans)", color: "var(--text-body)", textWrap: "pretty" }}>
            连接银行账户，自动归类每一笔收支，月底一键生成报表。需要报税时，功课我们替您做好了——您只管签字。
          </p>
          <div style={{ display: "flex", gap: 14, marginTop: 32 }}>
            <Button size="lg" icon={<i data-lucide="sparkles"></i>}>免费开始清洗</Button>
            <Button size="lg" variant="outline" icon={<i data-lucide="play"></i>}>看演示</Button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 24, font: "var(--w-regular) 14px var(--font-sans)", color: "var(--text-muted)" }}>
            <i data-lucide="shield-check" style={{ width: 18, height: 18, color: "var(--mint-600)" }}></i>
            银行级加密 · 无需绑卡即可试用 14 天
          </div>
        </div>
        <HeroDashboard />
      </div>
    </section>
  );
}
window.WSHero = Hero;
