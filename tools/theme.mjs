// ============================================================
// theme.mjs — 版式（字号 / 字体 / 行距 / 版心）单一来源
//
//   <site>/theme.json      ← 人编辑（编辑台「Aa 版式」或直接上 GitHub 网页改）
//   <site>/css/theme.css   ← 生成物：:root 变量覆盖，style.css 之后加载
//
// tools/build.mjs 每次 render() 都会调 syncTheme()，所以
//   · 本地 build → theme.css 与 theme.json 同步
//   · GitHub Actions 部署（改 theme.json 就上线）→ 同样同步
// style.css 里的 var(--fs-root)/var(--font-body)/... 是消费端。
// ============================================================

// 只用系统字体，不引外部字体请求（隐私 + 离线 + 首屏）。
export const FONT_PRESETS = {
  sans: {
    label: "系统无衬线（当前默认）",
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  humanist: {
    label: "人文无衬线（Avenir / Segoe / 思源）",
    stack:
      'Avenir, "Avenir Next", "Segoe UI", "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  helvetica: {
    label: "Helvetica / 苹方（更紧更现代）",
    stack:
      '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  georgia: {
    label: "Georgia 衬线（学术、当前标题）",
    stack: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
  },
  times: {
    label: "Times New Roman 衬线（投稿感）",
    stack: '"Times New Roman", Times, "Songti SC", SimSun, serif',
  },
  cjkserif: {
    label: "宋体系衬线（中文优先）",
    stack:
      '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", Georgia, "SimSun", serif',
  },
  ui: {
    label: "UI 无衬线（SF / Roboto / 思源黑）",
    stack:
      'ui-sans-serif, system-ui, "SF Pro Text", Roboto, "Source Han Sans SC", "PingFang SC", sans-serif',
  },
  mono: {
    label: "等宽（技术风，慎用）",
    stack: '"SF Mono", "JetBrains Mono", Menlo, Consolas, "Courier New", monospace',
  },
};

export const THEME_DEFAULTS = {
  fs_root_pct: 100, // 根字号：所有 rem 尺寸等比缩放（1rem = 16px × %）
  lh_body: 1.55, // 正文行距
  lh_h1: 1.15, // 主标题行距（放大字号后靠它控制不撑高）
  scale_h1: 1, // 主标题（hero h1）相对缩放
  scale_h2: 1, // 小节标题 .sec-title 相对缩放
  wrap_max_px: 880, // 版心最大宽度
  font_body: "sans", // 正文字体预设
  font_display: "georgia", // 标题字体预设
};

// 编辑台控件元数据（ ranges 只在这里定义一次，前端读 /api/theme 渲染 ）
// unit   = 拼进 CSS 值的后缀（必须是合法 CSS！）
// display= 只给面板标签看的后缀
export const THEME_FIELDS = [
  {
    key: "fs_root_pct",
    label: "全局字号",
    kind: "range",
    min: 88,
    max: 128,
    step: 1,
    unit: "%",
  },
  {
    key: "scale_h1",
    label: "主标题",
    kind: "range",
    min: 0.8,
    max: 1.4,
    step: 0.02,
    unit: "",
    display: "×",
  },
  {
    key: "scale_h2",
    label: "小节标题",
    kind: "range",
    min: 0.8,
    max: 1.4,
    step: 0.02,
    unit: "",
    display: "×",
  },
  {
    key: "lh_h1",
    label: "主标题行距",
    kind: "range",
    min: 1,
    max: 1.7,
    step: 0.05,
    unit: "",
  },
  {
    key: "lh_body",
    label: "正文行距",
    kind: "range",
    min: 1.35,
    max: 1.95,
    step: 0.05,
    unit: "",
  },
  {
    key: "wrap_max_px",
    label: "版心宽度",
    kind: "range",
    min: 720,
    max: 1080,
    step: 10,
    unit: "px",
  },
  { key: "font_body", label: "正文字体", kind: "font", def: "sans" },
  { key: "font_display", label: "标题字体", kind: "font", def: "georgia" },
];

const num = (v, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return n;
};

/** 合并 + 夹取到合法区间：仓库里/网页上手改的 theme.json 都不会把站点搞坏 */
export function clampTheme(raw = {}) {
  const out = { ...THEME_DEFAULTS };
  for (const f of THEME_FIELDS) {
    if (f.kind === "font") {
      const v = raw?.[f.key];
      if (typeof v === "string" && FONT_PRESETS[v]) out[f.key] = v;
      continue;
    }
    if (raw?.[f.key] === undefined || raw?.[f.key] === null) continue;
    const n = num(raw[f.key], THEME_DEFAULTS[f.key]); // 坏值（"abc" / NaN / null）退回默认，
    //                                              绝不能变成 undefined 泄进 CSS
    const min = f.min ?? -Infinity;
    const max = f.max ?? Infinity;
    out[f.key] = Math.min(max, Math.max(min, n));
  }
  return out;
}

// theme.json 字段 → style.css 里的 CSS 变量名（编辑台实时预览也读这份，不写第二遂）
export const VAR_NAMES = {
  fs_root_pct: "--fs-root",
  lh_body: "--lh-body",
  lh_h1: "--lh-h1",
  scale_h1: "--scale-h1",
  scale_h2: "--scale-h2",
  wrap_max_px: "--wrap-max",
  font_body: "--font-body",
  font_display: "--font-display",
};

/** theme 值 → 真正的 CSS 自定义属性 */
export function themeVars(t) {
  return {
    [VAR_NAMES.fs_root_pct]: `${t.fs_root_pct}%`,
    [VAR_NAMES.lh_body]: String(t.lh_body),
    [VAR_NAMES.lh_h1]: String(t.lh_h1),
    [VAR_NAMES.scale_h1]: String(t.scale_h1),
    [VAR_NAMES.scale_h2]: String(t.scale_h2),
    [VAR_NAMES.wrap_max_px]: `${t.wrap_max_px}px`,
    [VAR_NAMES.font_body]: FONT_PRESETS[t.font_body].stack,
    [VAR_NAMES.font_display]: FONT_PRESETS[t.font_display].stack,
  };
}

export function themeCss(t = clampTheme()) {
  const vars = themeVars(t);
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `/* AUTO-GENERATED 由 tools/build.mjs 从 theme.json 生成 — 请勿手改，改 theme.json 或用编辑台 */\n:root {\n${body}\n}\n`;
}
