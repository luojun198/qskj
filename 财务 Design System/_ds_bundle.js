/* @ds-bundle: {"format":3,"namespace":"DesignSystem_6b732f","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"StatTile","sourcePath":"components/core/StatTile.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"eb81344b2a63","components/core/Badge.jsx":"a91e7f969e60","components/core/Button.jsx":"d33ec93fa191","components/core/Card.jsx":"c46baf49f987","components/core/StatTile.jsx":"0bc6c3216a6e","components/forms/Input.jsx":"1c0749785767","components/forms/Switch.jsx":"3d84aec88c3c","components/navigation/Tabs.jsx":"42a3a10f99bf","ui_kits/website/CTA.jsx":"7efb80725b12","ui_kits/website/Features.jsx":"f860374e933b","ui_kits/website/Hero.jsx":"918fac8feae1","ui_kits/website/Nav.jsx":"25f11c1c5fe4","ui_kits/website/Pricing.jsx":"605a63050160"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_6b732f = window.DesignSystem_6b732f || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: 28,
  md: 40,
  lg: 56
};

/**
 * User avatar — image or initials on a bubble-gradient fill.
 */
function Avatar({
  src,
  name = "",
  size = "md",
  style,
  ...rest
}) {
  const px = SIZES[size] || size;
  const initials = name.trim().slice(0, name.match(/[\u4e00-\u9fa5]/) ? 1 : 2).toUpperCase();
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: px,
      height: px,
      borderRadius: "50%",
      background: src ? "var(--ink-100)" : "var(--grad-bubble)",
      color: "var(--brand-contrast)",
      fontFamily: "var(--font-sans)",
      fontWeight: 700,
      fontSize: px * 0.4,
      overflow: "hidden",
      boxShadow: "var(--sheen)",
      flex: "0 0 auto",
      ...style
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }) : initials || "?");
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  brand: {
    bg: "var(--mint-100)",
    fg: "var(--mint-700)"
  },
  blue: {
    bg: "var(--blue-100)",
    fg: "var(--blue-700)"
  },
  neutral: {
    bg: "var(--ink-100)",
    fg: "var(--ink-700)"
  },
  success: {
    bg: "var(--success-soft)",
    fg: "#0a7d57"
  },
  warning: {
    bg: "var(--warning-soft)",
    fg: "#a96b10"
  },
  danger: {
    bg: "var(--danger-soft)",
    fg: "#c23139"
  },
  solid: {
    bg: "var(--mint-500)",
    fg: "var(--brand-contrast)"
  }
};

/**
 * Small status / category label.
 */
function Badge({
  tone = "brand",
  dot = false,
  children,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.brand;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 24,
      padding: "0 10px",
      background: t.bg,
      color: t.fg,
      fontFamily: "var(--font-sans)",
      fontSize: 12.5,
      fontWeight: 700,
      lineHeight: 1,
      borderRadius: "var(--radius-pill)",
      whiteSpace: "nowrap",
      ...style
    }
  }, rest), dot ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: "currentColor"
    }
  }) : null, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    fontSize: 13,
    padding: "0 14px",
    height: 34,
    gap: 6,
    radius: "var(--radius-sm)"
  },
  md: {
    fontSize: 15,
    padding: "0 20px",
    height: 44,
    gap: 8,
    radius: "var(--radius-md)"
  },
  lg: {
    fontSize: 17,
    padding: "0 28px",
    height: 54,
    gap: 10,
    radius: "var(--radius-lg)"
  }
};
function variantStyle(variant, hover, active) {
  switch (variant) {
    case "secondary":
      return {
        background: hover ? "var(--blue-600)" : "var(--blue-500)",
        color: "#fff",
        boxShadow: active ? "none" : "var(--shadow-blue)"
      };
    case "ghost":
      return {
        background: hover ? "var(--mint-50)" : "transparent",
        color: "var(--mint-700)",
        boxShadow: "none"
      };
    case "soft":
      return {
        background: hover ? "var(--mint-100)" : "var(--mint-50)",
        color: "var(--mint-700)",
        boxShadow: "none"
      };
    case "outline":
      return {
        background: hover ? "var(--mint-50)" : "transparent",
        color: "var(--mint-700)",
        boxShadow: "inset 0 0 0 1.5px var(--mint-300)"
      };
    case "danger":
      return {
        background: hover ? "#e0434a" : "var(--danger)",
        color: "#fff",
        boxShadow: "none"
      };
    case "primary":
    default:
      return {
        background: hover ? "var(--mint-600)" : "var(--mint-500)",
        color: "var(--brand-contrast)",
        boxShadow: active ? "var(--sheen)" : "var(--shadow-mint), var(--sheen)"
      };
  }
}

/**
 * Primary action button. Bubbly, soft, with a mint glow on the primary variant.
 */
function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  fullWidth = false,
  disabled = false,
  type = "button",
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = variantStyle(variant, hover && !disabled, active && !disabled);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
      display: fullWidth ? "flex" : "inline-flex",
      width: fullWidth ? "100%" : undefined,
      alignItems: "center",
      justifyContent: "center",
      gap: s.gap,
      height: s.height,
      padding: s.padding,
      fontFamily: "var(--font-sans)",
      fontSize: s.fontSize,
      fontWeight: 700,
      lineHeight: 1,
      border: "none",
      borderRadius: s.radius,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      transform: active && !disabled ? "translateY(1px) scale(0.98)" : "none",
      transition: "background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-bubble), box-shadow var(--dur-fast) var(--ease-out)",
      whiteSpace: "nowrap",
      ...v,
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      fontSize: "1.15em"
    }
  }, icon) : null, children, iconRight ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      fontSize: "1.15em"
    }
  }, iconRight) : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Soft container surface. The bubbly card with optional hover lift.
 */
function Card({
  interactive = false,
  padding = 24,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => interactive && setHover(true),
    onMouseLeave: () => interactive && setHover(false),
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-lg)",
      boxShadow: hover ? "var(--shadow-lg)" : "var(--shadow-sm)",
      padding,
      transition: "box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
      transform: hover ? "translateY(-3px)" : "none",
      cursor: interactive ? "pointer" : "default",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/StatTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * A dashboard metric tile — label, big tabular number, optional delta.
 */
function StatTile({
  label,
  value,
  unit = "¥",
  delta,
  deltaTone = "auto",
  icon,
  style,
  ...rest
}) {
  const up = typeof delta === "string" ? delta.trim().startsWith("+") : delta > 0;
  const tone = deltaTone === "auto" ? up ? "var(--success)" : "var(--danger)" : deltaTone;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-sm)",
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) 13px var(--font-sans)",
      color: "var(--text-muted)"
    }
  }, label), icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "var(--radius-sm)",
      background: "var(--mint-50)",
      color: "var(--mint-600)"
    }
  }, icon) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 4
    }
  }, unit ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) 18px var(--font-num)",
      color: "var(--text-muted)"
    }
  }, unit) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) 30px var(--font-num)",
      color: "var(--text-strong)",
      fontVariantNumeric: "tabular-nums",
      letterSpacing: "var(--ls-tight)"
    }
  }, value)), delta != null ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) 13px var(--font-num)",
      color: tone,
      fontVariantNumeric: "tabular-nums"
    }
  }, up ? "▲" : "▼", " ", String(delta).replace(/^[+-]/, "")) : null);
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Text input with floating bubble focus ring. Supports leading/trailing adornments.
 */
function Input({
  label,
  hint,
  error,
  prefix,
  suffix,
  size = "md",
  style,
  id,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "lg" ? 52 : size === "sm" ? 38 : 46;
  const inputId = id || React.useId();
  const borderColor = error ? "var(--danger)" : focus ? "var(--mint-400)" : "var(--border-default)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 7,
      ...style
    }
  }, label ? /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      font: "var(--w-medium) 13px var(--font-sans)",
      color: "var(--text-strong)"
    }
  }, label) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: h,
      padding: "0 14px",
      background: "var(--surface-card)",
      border: `1.5px solid ${borderColor}`,
      borderRadius: "var(--radius-md)",
      boxShadow: focus ? `0 0 0 4px ${error ? "var(--danger-soft)" : "var(--focus-ring)"}` : "none",
      transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)"
    }
  }, prefix ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)",
      display: "inline-flex"
    }
  }, prefix) : null, /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      font: "var(--w-regular) 15px var(--font-sans)",
      color: "var(--text-strong)"
    }
  }, rest)), suffix ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)",
      display: "inline-flex"
    }
  }, suffix) : null), error ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) 12px var(--font-sans)",
      color: "var(--danger)"
    }
  }, error) : hint ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) 12px var(--font-sans)",
      color: "var(--text-muted)"
    }
  }, hint) : null);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * On/off switch with a bubbly knob.
 */
function Switch({
  checked = false,
  onChange,
  disabled = false,
  label,
  style,
  ...rest
}) {
  const toggle = () => {
    if (!disabled && onChange) onChange(!checked);
  };
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    "aria-checked": checked,
    onClick: toggle,
    disabled: disabled,
    style: {
      position: "relative",
      width: 46,
      height: 28,
      flex: "0 0 auto",
      border: "none",
      borderRadius: "var(--radius-pill)",
      background: checked ? "var(--mint-500)" : "var(--ink-200)",
      boxShadow: checked ? "var(--shadow-mint)" : "inset 0 1px 2px rgba(12,42,46,.12)",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "background var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)",
      padding: 0
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 3,
      left: checked ? 21 : 3,
      width: 22,
      height: 22,
      borderRadius: "50%",
      background: "#fff",
      boxShadow: "0 2px 5px rgba(12,42,46,.25)",
      transition: "left var(--dur-base) var(--ease-bubble)"
    }
  })), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) 14px var(--font-sans)",
      color: "var(--text-body)"
    }
  }, label) : null);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Pill tab bar. Controlled via value/onChange. Sliding mint pill marks the active tab.
 */
function Tabs({
  tabs = [],
  value,
  onChange,
  style,
  ...rest
}) {
  const active = value ?? (tabs[0] && tabs[0].value);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "inline-flex",
      gap: 4,
      padding: 4,
      background: "var(--surface-sunken)",
      borderRadius: "var(--radius-pill)",
      ...style
    }
  }, rest), tabs.map(t => {
    const on = t.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.value,
      type: "button",
      onClick: () => onChange && onChange(t.value),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 36,
        padding: "0 18px",
        border: "none",
        borderRadius: "var(--radius-pill)",
        background: on ? "var(--surface-card)" : "transparent",
        color: on ? "var(--mint-700)" : "var(--text-muted)",
        boxShadow: on ? "var(--shadow-sm)" : "none",
        font: "var(--w-bold) 14px var(--font-sans)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)"
      }
    }, t.icon ? /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex"
      }
    }, t.icon) : null, t.label, t.count != null ? /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--w-bold) 11px var(--font-num)",
        padding: "1px 7px",
        borderRadius: "var(--radius-pill)",
        background: on ? "var(--mint-100)" : "var(--ink-200)",
        color: on ? "var(--mint-700)" : "var(--ink-600)"
      }
    }, t.count) : null);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/CTA.jsx
try { (() => {
// Marketing site — closing CTA band + footer
const {
  Button
} = window.DesignSystem_6b732f;
function CTA() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: "32px 32px 96px",
      background: "var(--surface-canvas)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      overflow: "hidden",
      maxWidth: "var(--container)",
      margin: "0 auto",
      borderRadius: "var(--radius-2xl)",
      background: "var(--grad-bubble)",
      boxShadow: "var(--shadow-mint)",
      padding: "72px 48px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/bubble-pattern.svg",
    alt: "",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      opacity: 0.25,
      mixBlendMode: "screen"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: "var(--w-black) 40px/1.2 var(--font-sans)",
      color: "#ffffff",
      letterSpacing: "var(--ls-tight)"
    }
  }, "\u60A8\u7684\u8D22\u52A1\u4E13\u5BB6\uFF0C\u968F\u53EB\u968F\u5230"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "16px auto 0",
      maxWidth: 460,
      font: "var(--w-regular) 17px/1.7 var(--font-sans)",
      color: "rgba(255,255,255,0.92)"
    }
  }, "\u4ECA\u5929\u5C31\u628A\u8D26\u76EE\u6D17\u5E72\u51C0\u3002\u65E0\u9700\u7ED1\u5361\uFF0C14 \u5929\u514D\u8D39\u8BD5\u7528\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      justifyContent: "center",
      marginTop: 30
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    variant: "soft",
    icon: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "sparkles"
    }),
    style: {
      background: "#ffffff",
      color: "var(--mint-700)"
    }
  }, "\u514D\u8D39\u5F00\u59CB\u6E05\u6D17")))));
}
function Footer() {
  const cols = [{
    h: "产品",
    items: ["记账", "对账", "报税", "团队协作", "价格"]
  }, {
    h: "公司",
    items: ["关于我们", "博客", "招聘", "联系"]
  }, {
    h: "资源",
    items: ["帮助中心", "API 文档", "安全", "状态"]
  }];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: "var(--surface-inverse)",
      color: "var(--text-on-dark)",
      padding: "64px 32px 40px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
      gap: 40
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark.svg",
    alt: "",
    style: {
      width: 30,
      height: 30
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-black) 19px var(--font-sans)",
      color: "#fff"
    }
  }, "\u8D22\u52A1\u6D17\u5934\u818F")), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 14,
      maxWidth: 260,
      font: "var(--w-regular) 14px/1.7 var(--font-sans)",
      color: "rgba(234,246,244,0.6)"
    }
  }, "\u628A\u8D26\u76EE\u6D17\u5F97\u5E72\u5E72\u51C0\u51C0\u3002\u60A8\u7684\u8D22\u52A1\u4E13\u5BB6\u3002")), cols.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.h
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--w-bold) 13px var(--font-sans)",
      color: "#fff",
      marginBottom: 14
    }
  }, c.h), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, c.items.map(i => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: "#",
    style: {
      font: "var(--w-regular) 14px var(--font-sans)",
      color: "rgba(234,246,244,0.62)",
      textDecoration: "none"
    }
  }, i)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "40px auto 0",
      paddingTop: 24,
      borderTop: "1px solid rgba(255,255,255,0.1)",
      display: "flex",
      justifyContent: "space-between",
      font: "var(--w-regular) 13px var(--font-sans)",
      color: "rgba(234,246,244,0.5)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 \u8D22\u52A1\u6D17\u5934\u818F Finance Shampoo"), /*#__PURE__*/React.createElement("span", null, "\u4EACICP\u5907 0000000 \u53F7")));
}
window.WSCTA = CTA;
window.WSFooter = Footer;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/CTA.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Features.jsx
try { (() => {
// Marketing site — features grid + 3-step "how it works"
const {
  Card,
  Badge
} = window.DesignSystem_6b732f;
const FEATURES = [{
  icon: "link",
  title: "一键连接",
  body: "安全连接 200+ 家银行与支付平台，流水自动流入，再不用手动导表。"
}, {
  icon: "wand-sparkles",
  title: "智能归类",
  body: "每一笔收支自动打标签、配科目。错了？改一次，以后它就记住了。"
}, {
  icon: "file-check-2",
  title: "报税无忧",
  body: "增值税、个税、季度报表，提前算好。到点提醒您，您只管签字。"
}, {
  icon: "users",
  title: "多人协作",
  body: "老板看大盘，会计管细账，权限分得清清楚楚，留痕可追溯。"
}];
function SectionHead({
  eyebrow,
  title,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      maxWidth: 620,
      margin: "0 auto 48px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) 12px var(--font-mono)",
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: "var(--mint-600)"
    }
  }, eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: "14px 0 0",
      font: "var(--w-black) 38px/1.2 var(--font-sans)",
      letterSpacing: "var(--ls-tight)",
      color: "var(--text-strong)"
    }
  }, title), sub ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "14px 0 0",
      font: "var(--w-regular) 17px/1.7 var(--font-sans)",
      color: "var(--text-muted)"
    }
  }, sub) : null);
}
function Features() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--surface-card)",
      padding: "96px 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "WHY \u8D22\u52A1\u6D17\u5934\u818F",
    title: "\u628A\u7E41\u7410\u7684\u8D22\u52A1\uFF0C\u6D17\u6210\u4E00\u4EF6\u5C0F\u4E8B",
    sub: "\u4E0D\u662F\u53C8\u4E00\u4E2A\u8BB0\u8D26 App\u3002\u662F\u4E00\u4F4D\u968F\u53EB\u968F\u5230\u3001\u6C38\u4E0D\u4E0B\u73ED\u7684\u8D22\u52A1\u4E13\u5BB6\u3002"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 20
    }
  }, FEATURES.map(f => /*#__PURE__*/React.createElement(Card, {
    key: f.title,
    interactive: true,
    padding: 26
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "var(--radius-md)",
      background: "var(--grad-foam)",
      border: "1px solid var(--border-brand)",
      color: "var(--mint-600)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": f.icon
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: "18px 0 8px",
      font: "var(--w-bold) 19px var(--font-sans)",
      color: "var(--text-strong)"
    }
  }, f.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--w-regular) 14px/1.7 var(--font-sans)",
      color: "var(--text-muted)",
      textWrap: "pretty"
    }
  }, f.body))))));
}
const STEPS = [{
  n: "01",
  title: "连接账户",
  body: "登录即连。我们只读流水，不碰您的钱。"
}, {
  n: "02",
  title: "自动洗账",
  body: "归类、对账、查重，几秒钟洗得干干净净。"
}, {
  n: "03",
  title: "签字了事",
  body: "报表与税表备好，确认无误，一键提交。"
}];
function HowItWorks() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--surface-canvas)",
      padding: "96px 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "HOW IT WORKS",
    title: "\u4E09\u6B65\uFF0C\u641E\u5B9A"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 22
    }
  }, STEPS.map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.n,
    padding: 30,
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) 40px var(--font-num)",
      color: "transparent",
      WebkitTextStroke: "1.5px var(--mint-400)",
      letterSpacing: "var(--ls-tight)"
    }
  }, s.n), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: "10px 0 8px",
      font: "var(--w-bold) 22px var(--font-sans)",
      color: "var(--text-strong)"
    }
  }, s.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--w-regular) 15px/1.7 var(--font-sans)",
      color: "var(--text-muted)"
    }
  }, s.body))))));
}
window.WSFeatures = Features;
window.WSHowItWorks = HowItWorks;
window.WSSectionHead = SectionHead;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Features.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Hero.jsx
try { (() => {
// Marketing site — hero with a live mini-dashboard mock
const {
  Button,
  Badge,
  StatTile,
  Tabs,
  Card
} = window.DesignSystem_6b732f;
function HeroDashboard() {
  const [tab, setTab] = React.useState("out");
  const rows = [{
    name: "顺丰速运",
    cat: "物流",
    amt: "-128.00",
    tone: "neutral"
  }, {
    name: "阿里云 · 服务器",
    cat: "技术",
    amt: "-1,280.00",
    tone: "neutral"
  }, {
    name: "客户回款 · 蓝湖",
    cat: "收入",
    amt: "+18,000.00",
    tone: "success"
  }, {
    name: "美团 · 团队午餐",
    cat: "餐饮",
    amt: "-326.50",
    tone: "neutral"
  }];
  return /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    style: {
      overflow: "hidden",
      boxShadow: "var(--shadow-xl)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "18px 22px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottom: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark.svg",
    alt: "",
    style: {
      width: 26,
      height: 26
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) 16px var(--font-sans)",
      color: "var(--text-strong)"
    }
  }, "\u672C\u6708\u6982\u89C8")), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "\u5DF2\u5B9E\u65F6\u540C\u6B65")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 22,
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "\u672C\u6708\u652F\u51FA",
    value: "12,480.00",
    delta: "+8.2%",
    icon: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "trending-down"
    })
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "\u672C\u6708\u6536\u5165",
    value: "38,900.00",
    delta: "+15%",
    icon: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "wallet"
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 22px 8px"
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: "all",
      label: "全部"
    }, {
      value: "out",
      label: "支出"
    }, {
      value: "in",
      label: "收入"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "6px 12px 16px"
    }
  }, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 10px",
      borderRadius: "var(--radius-md)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: "var(--radius-sm)",
      background: "var(--mint-50)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--mint-600)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": r.tone === "success" ? "arrow-down-left" : "arrow-up-right"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--w-medium) 14px var(--font-sans)",
      color: "var(--text-strong)"
    }
  }, r.name), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--w-regular) 12px var(--font-sans)",
      color: "var(--text-muted)"
    }
  }, r.cat)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) 15px var(--font-num)",
      fontVariantNumeric: "tabular-nums",
      color: r.tone === "success" ? "var(--success)" : "var(--text-strong)"
    }
  }, "\xA5", r.amt)))));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: "relative",
      overflow: "hidden",
      background: "var(--grad-rinse)"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/bubble-pattern.svg",
    alt: "",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      opacity: 0.5,
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      maxWidth: "var(--container)",
      margin: "0 auto",
      padding: "84px 32px 96px",
      display: "grid",
      gridTemplateColumns: "1.05fr 0.95fr",
      gap: 56,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 14px",
      borderRadius: "var(--radius-pill)",
      background: "var(--white)",
      boxShadow: "var(--shadow-sm)",
      font: "var(--w-bold) 12px var(--font-mono)",
      letterSpacing: "0.08em",
      color: "var(--mint-700)",
      textTransform: "uppercase",
      whiteSpace: "nowrap"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "sparkles",
    style: {
      width: 14,
      height: 14
    }
  }), " \u60A8\u7684\u8D22\u52A1\u4E13\u5BB6"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: "22px 0 0",
      font: "var(--w-black) 58px/1.08 var(--font-sans)",
      letterSpacing: "var(--ls-tight)",
      color: "var(--text-strong)"
    }
  }, "\u628A\u8D26\u76EE", /*#__PURE__*/React.createElement("br", null), "\u6D17\u5F97\u5E72\u5E72\u51C0\u51C0"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "22px 0 0",
      maxWidth: 440,
      font: "var(--w-regular) 18px/1.75 var(--font-sans)",
      color: "var(--text-body)",
      textWrap: "pretty"
    }
  }, "\u8FDE\u63A5\u94F6\u884C\u8D26\u6237\uFF0C\u81EA\u52A8\u5F52\u7C7B\u6BCF\u4E00\u7B14\u6536\u652F\uFF0C\u6708\u5E95\u4E00\u952E\u751F\u6210\u62A5\u8868\u3002\u9700\u8981\u62A5\u7A0E\u65F6\uFF0C\u529F\u8BFE\u6211\u4EEC\u66FF\u60A8\u505A\u597D\u4E86\u2014\u2014\u60A8\u53EA\u7BA1\u7B7E\u5B57\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginTop: 32
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    icon: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "sparkles"
    })
  }, "\u514D\u8D39\u5F00\u59CB\u6E05\u6D17"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    variant: "outline",
    icon: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "play"
    })
  }, "\u770B\u6F14\u793A")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginTop: 24,
      font: "var(--w-regular) 14px var(--font-sans)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "shield-check",
    style: {
      width: 18,
      height: 18,
      color: "var(--mint-600)"
    }
  }), "\u94F6\u884C\u7EA7\u52A0\u5BC6 \xB7 \u65E0\u9700\u7ED1\u5361\u5373\u53EF\u8BD5\u7528 14 \u5929")), /*#__PURE__*/React.createElement(HeroDashboard, null)));
}
window.WSHero = Hero;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Hero.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Nav.jsx
try { (() => {
// Marketing site — top navigation bar
const {
  Button
} = window.DesignSystem_6b732f;
function Nav() {
  const links = ["产品", "价格", "客户", "博客"];
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 20,
      height: "var(--header-h)",
      display: "flex",
      alignItems: "center",
      padding: "0 32px",
      background: "rgba(255,255,255,0.82)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 40,
      maxWidth: "var(--container)",
      width: "100%",
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-lockup.svg",
    alt: "\u8D22\u52A1\u6D17\u5934\u818F",
    style: {
      height: 38
    }
  }), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      gap: 28,
      flex: 1
    }
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      font: "var(--w-medium) 15px var(--font-sans)",
      color: "var(--text-body)",
      textDecoration: "none"
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      font: "var(--w-medium) 15px var(--font-sans)",
      color: "var(--text-body)",
      textDecoration: "none"
    }
  }, "\u767B\u5F55"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    iconRight: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "arrow-right"
    })
  }, "\u514D\u8D39\u8BD5\u7528"))));
}
window.WSNav = Nav;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Nav.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Pricing.jsx
try { (() => {
// Marketing site — pricing tiers
const {
  Card,
  Button,
  Badge
} = window.DesignSystem_6b732f;
const TIERS = [{
  name: "个人版",
  price: "0",
  unit: "永久免费",
  desc: "自由职业者与小本经营",
  feats: ["1 个账户连接", "自动归类记账", "月度报表", "社区支持"],
  cta: "免费开始",
  variant: "soft",
  featured: false
}, {
  name: "团队版",
  price: "199",
  unit: "/ 月",
  desc: "成长中的小团队",
  feats: ["无限账户连接", "智能对账 + 查重", "一键报税", "5 名成员协作", "优先客服"],
  cta: "免费试用 14 天",
  variant: "primary",
  featured: true
}, {
  name: "企业版",
  price: "定制",
  unit: "",
  desc: "多主体、多账套的公司",
  feats: ["多公司合并报表", "审批流与权限", "API 与对接", "专属财务顾问"],
  cta: "联系我们",
  variant: "outline",
  featured: false
}];
function Pricing() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--surface-card)",
      padding: "96px 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto"
    }
  }, window.WSSectionHead({
    eyebrow: "PRICING",
    title: "明码标价，洗得放心",
    sub: "不绑卡、不套路，随时可退。"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 22,
      alignItems: "stretch"
    }
  }, TIERS.map(t => /*#__PURE__*/React.createElement(Card, {
    key: t.name,
    padding: 32,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 20,
      border: t.featured ? "2px solid var(--mint-400)" : "1px solid var(--border-subtle)",
      boxShadow: t.featured ? "var(--shadow-lg)" : "var(--shadow-sm)",
      transform: t.featured ? "translateY(-8px)" : "none",
      position: "relative"
    }
  }, t.featured ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 20,
      right: 20
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "solid"
  }, "\u6700\u53D7\u6B22\u8FCE")) : null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--w-bold) 18px var(--font-sans)",
      color: "var(--text-strong)"
    }
  }, t.name), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--w-regular) 13px var(--font-sans)",
      color: "var(--text-muted)",
      marginTop: 4
    }
  }, t.desc)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 6,
      minHeight: 52
    }
  }, t.price !== "定制" ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) 20px var(--font-num)",
      color: "var(--text-muted)"
    }
  }, "\xA5") : null, /*#__PURE__*/React.createElement("span", {
    style: {
      font: `var(--w-black) ${t.price === "定制" ? 34 : 44}px var(--font-num)`,
      color: "var(--text-strong)",
      letterSpacing: "var(--ls-tight)",
      whiteSpace: "nowrap"
    }
  }, t.price), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) 14px var(--font-sans)",
      color: "var(--text-muted)"
    }
  }, t.unit)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 11,
      flex: 1
    }
  }, t.feats.map(f => /*#__PURE__*/React.createElement("div", {
    key: f,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      font: "var(--w-regular) 14px var(--font-sans)",
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "check",
    style: {
      width: 17,
      height: 17,
      color: "var(--mint-600)"
    }
  }), " ", f))), /*#__PURE__*/React.createElement(Button, {
    variant: t.variant,
    fullWidth: true
  }, t.cta))))));
}
window.WSPricing = Pricing;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Pricing.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
