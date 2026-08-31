// Marketing site — top navigation bar
const { Button } = window.DesignSystem_6b732f;

function Nav() {
  const links = ["产品", "价格", "客户", "博客"];
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 20,
      height: "var(--header-h)", display: "flex", alignItems: "center",
      padding: "0 32px", background: "rgba(255,255,255,0.82)",
      backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border-subtle)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 40, maxWidth: "var(--container)", width: "100%", margin: "0 auto" }}>
        <img src="../../assets/logo-lockup.svg" alt="财务洗头膏" style={{ height: 38 }} />
        <nav style={{ display: "flex", gap: 28, flex: 1 }}>
          {links.map((l) => (
            <a key={l} href="#" style={{
              font: "var(--w-medium) 15px var(--font-sans)", color: "var(--text-body)",
              textDecoration: "none",
            }}>{l}</a>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <a href="#" style={{ font: "var(--w-medium) 15px var(--font-sans)", color: "var(--text-body)", textDecoration: "none" }}>登录</a>
          <Button size="sm" iconRight={<i data-lucide="arrow-right"></i>}>免费试用</Button>
        </div>
      </div>
    </header>
  );
}
window.WSNav = Nav;
