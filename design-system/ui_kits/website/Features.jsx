// Marketing site — features grid + 3-step "how it works"
const { Card, Badge } = window.DesignSystem_6b732f;

const FEATURES = [
  { icon: "link", title: "一键连接", body: "安全连接 200+ 家银行与支付平台，流水自动流入，再不用手动导表。" },
  { icon: "wand-sparkles", title: "智能归类", body: "每一笔收支自动打标签、配科目。错了？改一次，以后它就记住了。" },
  { icon: "file-check-2", title: "报税无忧", body: "增值税、个税、季度报表，提前算好。到点提醒您，您只管签字。" },
  { icon: "users", title: "多人协作", body: "老板看大盘，会计管细账，权限分得清清楚楚，留痕可追溯。" },
];

function SectionHead({ eyebrow, title, sub }) {
  return (
    <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto 48px" }}>
      <span style={{ font: "var(--w-bold) 12px var(--font-mono)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--mint-600)" }}>{eyebrow}</span>
      <h2 style={{ margin: "14px 0 0", font: "var(--w-black) 38px/1.2 var(--font-sans)", letterSpacing: "var(--ls-tight)", color: "var(--text-strong)" }}>{title}</h2>
      {sub ? <p style={{ margin: "14px 0 0", font: "var(--w-regular) 17px/1.7 var(--font-sans)", color: "var(--text-muted)" }}>{sub}</p> : null}
    </div>
  );
}

function Features() {
  return (
    <section style={{ background: "var(--surface-card)", padding: "96px 32px" }}>
      <div style={{ maxWidth: "var(--container)", margin: "0 auto" }}>
        <SectionHead eyebrow="WHY 财务洗头膏" title="把繁琐的财务，洗成一件小事" sub="不是又一个记账 App。是一位随叫随到、永不下班的财务专家。" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
          {FEATURES.map((f) => (
            <Card key={f.title} interactive padding={26}>
              <span style={{ display: "inline-flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-md)", background: "var(--grad-foam)", border: "1px solid var(--border-brand)", color: "var(--mint-600)" }}>
                <i data-lucide={f.icon}></i>
              </span>
              <h3 style={{ margin: "18px 0 8px", font: "var(--w-bold) 19px var(--font-sans)", color: "var(--text-strong)" }}>{f.title}</h3>
              <p style={{ margin: 0, font: "var(--w-regular) 14px/1.7 var(--font-sans)", color: "var(--text-muted)", textWrap: "pretty" }}>{f.body}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { n: "01", title: "连接账户", body: "登录即连。我们只读流水，不碰您的钱。" },
  { n: "02", title: "自动洗账", body: "归类、对账、查重，几秒钟洗得干干净净。" },
  { n: "03", title: "签字了事", body: "报表与税表备好，确认无误，一键提交。" },
];

function HowItWorks() {
  return (
    <section style={{ background: "var(--surface-canvas)", padding: "96px 32px" }}>
      <div style={{ maxWidth: "var(--container)", margin: "0 auto" }}>
        <SectionHead eyebrow="HOW IT WORKS" title="三步，搞定" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
          {STEPS.map((s) => (
            <Card key={s.n} padding={30} style={{ position: "relative" }}>
              <span style={{ font: "var(--w-bold) 40px var(--font-num)", color: "transparent", WebkitTextStroke: "1.5px var(--mint-400)", letterSpacing: "var(--ls-tight)" }}>{s.n}</span>
              <h3 style={{ margin: "10px 0 8px", font: "var(--w-bold) 22px var(--font-sans)", color: "var(--text-strong)" }}>{s.title}</h3>
              <p style={{ margin: 0, font: "var(--w-regular) 15px/1.7 var(--font-sans)", color: "var(--text-muted)" }}>{s.body}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

window.WSFeatures = Features;
window.WSHowItWorks = HowItWorks;
window.WSSectionHead = SectionHead;
