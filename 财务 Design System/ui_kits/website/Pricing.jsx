// Marketing site — pricing tiers
const { Card, Button, Badge } = window.DesignSystem_6b732f;

const TIERS = [
  { name: "个人版", price: "0", unit: "永久免费", desc: "自由职业者与小本经营", feats: ["1 个账户连接", "自动归类记账", "月度报表", "社区支持"], cta: "免费开始", variant: "soft", featured: false },
  { name: "团队版", price: "199", unit: "/ 月", desc: "成长中的小团队", feats: ["无限账户连接", "智能对账 + 查重", "一键报税", "5 名成员协作", "优先客服"], cta: "免费试用 14 天", variant: "primary", featured: true },
  { name: "企业版", price: "定制", unit: "", desc: "多主体、多账套的公司", feats: ["多公司合并报表", "审批流与权限", "API 与对接", "专属财务顾问"], cta: "联系我们", variant: "outline", featured: false },
];

function Pricing() {
  return (
    <section style={{ background: "var(--surface-card)", padding: "96px 32px" }}>
      <div style={{ maxWidth: "var(--container)", margin: "0 auto" }}>
        {window.WSSectionHead({ eyebrow: "PRICING", title: "明码标价，洗得放心", sub: "不绑卡、不套路，随时可退。" })}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22, alignItems: "stretch" }}>
          {TIERS.map((t) => (
            <Card key={t.name} padding={32} style={{
              display: "flex", flexDirection: "column", gap: 20,
              border: t.featured ? "2px solid var(--mint-400)" : "1px solid var(--border-subtle)",
              boxShadow: t.featured ? "var(--shadow-lg)" : "var(--shadow-sm)",
              transform: t.featured ? "translateY(-8px)" : "none", position: "relative",
            }}>
              {t.featured ? <div style={{ position: "absolute", top: 20, right: 20 }}><Badge tone="solid">最受欢迎</Badge></div> : null}
              <div>
                <div style={{ font: "var(--w-bold) 18px var(--font-sans)", color: "var(--text-strong)" }}>{t.name}</div>
                <div style={{ font: "var(--w-regular) 13px var(--font-sans)", color: "var(--text-muted)", marginTop: 4 }}>{t.desc}</div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, minHeight: 52 }}>
                {t.price !== "定制" ? <span style={{ font: "var(--w-medium) 20px var(--font-num)", color: "var(--text-muted)" }}>¥</span> : null}
                <span style={{ font: `var(--w-black) ${t.price === "定制" ? 34 : 44}px var(--font-num)`, color: "var(--text-strong)", letterSpacing: "var(--ls-tight)", whiteSpace: "nowrap" }}>{t.price}</span>
                <span style={{ font: "var(--w-regular) 14px var(--font-sans)", color: "var(--text-muted)" }}>{t.unit}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, flex: 1 }}>
                {t.feats.map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--w-regular) 14px var(--font-sans)", color: "var(--text-body)" }}>
                    <i data-lucide="check" style={{ width: 17, height: 17, color: "var(--mint-600)" }}></i> {f}
                  </div>
                ))}
              </div>
              <Button variant={t.variant} fullWidth>{t.cta}</Button>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
window.WSPricing = Pricing;
