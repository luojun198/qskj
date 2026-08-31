// Marketing site — closing CTA band + footer
const { Button } = window.DesignSystem_6b732f;

function CTA() {
  return (
    <section style={{ padding: "32px 32px 96px", background: "var(--surface-canvas)" }}>
      <div style={{ position: "relative", overflow: "hidden", maxWidth: "var(--container)", margin: "0 auto", borderRadius: "var(--radius-2xl)", background: "var(--grad-bubble)", boxShadow: "var(--shadow-mint)", padding: "72px 48px", textAlign: "center" }}>
        <img src="../../assets/bubble-pattern.svg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.25, mixBlendMode: "screen" }} />
        <div style={{ position: "relative" }}>
          <h2 style={{ margin: 0, font: "var(--w-black) 40px/1.2 var(--font-sans)", color: "#ffffff", letterSpacing: "var(--ls-tight)" }}>您的财务专家，随叫随到</h2>
          <p style={{ margin: "16px auto 0", maxWidth: 460, font: "var(--w-regular) 17px/1.7 var(--font-sans)", color: "rgba(255,255,255,0.92)" }}>
            今天就把账目洗干净。无需绑卡，14 天免费试用。
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 30 }}>
            <Button size="lg" variant="soft" icon={<i data-lucide="sparkles"></i>} style={{ background: "#ffffff", color: "var(--mint-700)" }}>免费开始清洗</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    { h: "产品", items: ["记账", "对账", "报税", "团队协作", "价格"] },
    { h: "公司", items: ["关于我们", "博客", "招聘", "联系"] },
    { h: "资源", items: ["帮助中心", "API 文档", "安全", "状态"] },
  ];
  return (
    <footer style={{ background: "var(--surface-inverse)", color: "var(--text-on-dark)", padding: "64px 32px 40px" }}>
      <div style={{ maxWidth: "var(--container)", margin: "0 auto", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 40 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="../../assets/logo-mark.svg" alt="" style={{ width: 30, height: 30 }} />
            <span style={{ font: "var(--w-black) 19px var(--font-sans)", color: "#fff" }}>财务洗头膏</span>
          </div>
          <p style={{ marginTop: 14, maxWidth: 260, font: "var(--w-regular) 14px/1.7 var(--font-sans)", color: "rgba(234,246,244,0.6)" }}>
            把账目洗得干干净净。您的财务专家。
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.h}>
            <div style={{ font: "var(--w-bold) 13px var(--font-sans)", color: "#fff", marginBottom: 14 }}>{c.h}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {c.items.map((i) => (
                <a key={i} href="#" style={{ font: "var(--w-regular) 14px var(--font-sans)", color: "rgba(234,246,244,0.62)", textDecoration: "none" }}>{i}</a>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: "var(--container)", margin: "40px auto 0", paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", font: "var(--w-regular) 13px var(--font-sans)", color: "rgba(234,246,244,0.5)" }}>
        <span>© 2026 财务洗头膏 Finance Shampoo</span>
        <span>京ICP备 0000000 号</span>
      </div>
    </footer>
  );
}

window.WSCTA = CTA;
window.WSFooter = Footer;
