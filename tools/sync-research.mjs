#!/usr/bin/env node
// ============================================================
// sync-research.mjs — 研究主页（仓库根） ↔ 求职页（career/）同名 key 三方对齐
//
// 两个站共用一套研究文案：论文标题、问题句、数据/方法行、图注、机制块、关键结果、
// 教育/经历字段……（两边同名 key 45 个）。在任意一边改完跑一次这条命令就对齐。
//
//   node tools/sync-research.mjs                        # 默认范围：p1_ p2_ p3_ icm_
//   node tools/sync-research.mjs p1_ p2_ p3_ icm_ edu_  # 位置参数 = 前缀白名单
//   node tools/sync-research.mjs --all                  # 全部同名 key
//   node tools/sync-research.mjs --from main            # 强制方向：研究主页 → 求职页
//   node tools/sync-research.mjs --from career          # 强制方向：求职页 → 研究主页
//   node tools/sync-research.mjs --fields en            # 只同步英文（默认 en,zh）
//   node tools/sync-research.mjs --dry-run              # 只看将要改什么（建议先跑）
//   node tools/sync-research.mjs --list                 # 只列两边同名 key
//   node tools/sync-research.mjs --no-build             # 写完不重建 index.html/zh-i18n.js
//   node tools/sync-research.mjs --include-style-only    # 连纯样式（HTML 标记）差异也对齐
//   node tools/sync-research.mjs --force                # 冲突时按 --from 的方向覆盖；并允许动 footer/hero_*
//
// 怎么做到不互相覆盖：
//   · 每次同步把结果记进 tools/.sync-research.state.json（基线）。
//   · 某条 key：只有一边变过 → 从那边搬到另一边；两边都变且不同 → 判为冲突，
//     默认跳过并列出，等你用 --from 裁决；没基线时也一样要求裁决，绝不瞎猜。
//   · 纯样式差异（文字一模一样、只有内联 style/标记不同）默认不动，只提示；--include-style-only 才对齐。
//   · footer / hero_role / hero_int 两边是故意写得不一样的（一个学术口吻、一个求职口吻），
//     除非 --force，永不参与同步。
//   · 单边独有的 key（求职页 sk1、研究主页 phd/p1_abs…）只作提示，永不复制。
//   · 图片路径自动改写：研究主页 assets/… ↔ 求职页 ../assets/…
// ============================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SITES = {
  main: { label: "研究主页", file: join(REPO, "content.json"), pi: "" },
  career: {
    label: "求职页",
    file: join(REPO, "career", "content.json"),
    pi: "career",
  },
};
const STATE = join(HERE, ".sync-research.state.json");
const DEFAULT_PREFIXES = ["p1_", "p2_", "p3_", "icm_"];
const NEVER_SYNC = ["footer", "hero_role", "hero_int"]; // 两边有意不同
const VALUE_OPTS = ["from", "fields"];

/* --------------------------- 参数 --------------------------- */
const argv = process.argv.slice(2);
const flags = new Set();
const opts = {};
const prefixes = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") {
    const src = readFileSync(join(HERE, "sync-research.mjs"), "utf8");
    console.log(
      src
        .split(/^\/\/ =+$/m)[1]
        .split(/^\/\/ =+$/m)[0]
        .replace(/^\s*\/\/\s?/gm, ""),
    );
    process.exit(0);
  }
  if (!a.startsWith("--")) {
    const prev = argv[i - 1];
    if (prev && prev.startsWith("--") && VALUE_OPTS.includes(prev.slice(2)))
      continue; // 那是选项的值
    prefixes.push(a);
    continue;
  }
  const name = a.slice(2);
  if (VALUE_OPTS.includes(name)) {
    opts[name] = argv[++i];
    if (!opts[name]) die(`--${name} 需要一个值`);
  } else flags.add(name);
}
const FIELDS = String(opts.fields || "en,zh")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (opts.from && !["main", "career", "newer"].includes(opts.from))
  die("--from 只能是 main | career | newer");
for (const f of FIELDS)
  if (!["en", "zh"].includes(f)) die("--fields 只能是 en 和/或 zh");
if (flags.has("force") && !opts.from) opts.from = "main"; // --force 默认以研究主页为准

/* --------------------------- 读取 --------------------------- */
const data = {};
for (const [id, s] of Object.entries(SITES)) {
  if (!existsSync(s.file)) die("找不到 " + s.file);
  try {
    data[id] = JSON.parse(readFileSync(s.file, "utf8"));
  } catch (e) {
    die(`${s.file} 不是合法 JSON：${e.message}`);
  }
}
let state = {};
try {
  state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
} catch (e) {
  console.log(`⚠ 基线文件读不了（${e.message}），本次按“无基线”处理`);
  state = {};
}

const sharedAll = Object.keys(data.main).filter((k) => k in data.career);
const inScope = (k) =>
  flags.has("all") ||
  (prefixes.length ? prefixes : DEFAULT_PREFIXES).some((p) => k.startsWith(p));
const blocked = sharedAll.filter(
  (k) => NEVER_SYNC.includes(k) && !flags.has("force"),
);
const picked = sharedAll.filter(
  (k) => inScope(k) && (flags.has("force") || !NEVER_SYNC.includes(k)),
);

if (flags.has("list")) {
  console.log(
    `两边同名 key ${sharedAll.length} 个；本次范围 ${picked.length} 个：\n  ` +
      picked.join("  "),
  );
  if (blocked.length)
    console.log(
      `\n✗ 永不参与同步（两边有意不同，要动用 --force）：${blocked.join(" ")}`,
    );
  reportOneSided();
  process.exit(0);
}
if (!picked.length) die("范围内没有同名 key。给前缀（p1_ edu_ …）或用 --all");

/* --------------------------- 三方合并 --------------------------- */
const norm = (v, site) => defunk(unwind_if_career(v, site)); // 统一形态后再比（去掉编辑台塑的内联样式）
function unwind_if_career(v, site) {
  return site === "career" ? unwind(v) : v;
}
const plan = []; // {key, field, from, to, value, why}
const conflicts = [];
const styleOnly = [];
for (const k of picked) {
  for (const f of FIELDS) {
    const m = norm(data.main[k][f], "main");
    const c = norm(data.career[k][f], "career");
    if (m === c) {
      touch(k, f, m); // 记基线（含首次运行）
      continue;
    }
    if (text(m) === text(c)) {
      if (!flags.has("include-style-only")) {
        styleOnly.push(`${k}.${f}`);
        continue; // 只是内联样式差异，不动（--include-style-only 才对齐）
      }
      // 落到下面的正常判定：把格式也拉平
    }
    const base = state[k] && state[k][f];
    let from;
    if (opts.from && opts.from !== "newer") from = opts.from;
    else if (base === undefined) from = null;
    else if (m !== base && c === base) from = "main";
    else if (c !== base && m === base) from = "career";
    else from = null; // 两边都改过 → 冲突

    if (!from) {
      conflicts.push({ key: k, field: f, main: m, career: c });
      continue;
    }
    plan.push({
      key: k,
      field: f,
      from,
      to: other(from),
      value: from === "main" ? m : c,
    });
  }
}

/* --------------------------- 汇报 --------------------------- */
console.log(
  `范围：${picked.length} 个 key × ${FIELDS.length} 个字段` +
    (blocked.length ? `　|　已避开有意不同的：${blocked.join(" ")}` : "") +
    (styleOnly.length ? `　|　纯样式差异不动：${styleOnly.join(" ")}` : "") +
    `\n`,
);
if (!plan.length && !conflicts.length) {
  if (!flags.has("dry-run")) saveState();
  console.log(
    `✓ 两边一致，无需改动${flags.has("dry-run") ? "" : "（基线已更新）"}。`,
  );
  reportOneSided();
  process.exit(0);
}
if (plan.length) {
  console.log(
    `${flags.has("dry-run") ? "将改写" : "改写"} ${new Set(plan.map((p) => p.key)).size} 个 key：\n`,
  );
  for (const p of plan) {
    const cur = data[p.to][p.key][p.field];
    console.log(
      `  · ${p.key} [${p.field}]  ${SITES[p.from].label} → ${SITES[p.to].label}`,
    );
    console.log(`      − ${cut(text(cur), 76) || "(空)"}`);
    console.log(`      + ${cut(text(p.value), 76)}`);
  }
  console.log("");
}
if (conflicts.length) {
  console.log(
    `⚠ 冲突：两边都改过且不同，本次未动（${conflicts.length} 处）。用 --from main / --from career 裁决：\n`,
  );
  for (const c of conflicts) {
    console.log(`  ! ${c.key} [${c.field}]`);
    console.log(`      研究主页：${cut(text(c.main), 66)}`);
    console.log(`      求职页　：${cut(text(c.career), 66)}`);
  }
  console.log("");
}
if (flags.has("dry-run")) {
  console.log("（--dry-run：没有写任何文件）");
  process.exit(0);
}

/* --------------------------- 写入 + 重建 --------------------------- */
const dirty = new Set();
for (const p of plan) {
  const raw = relink(p.value, p.to);
  if (data[p.to][p.key][p.field] === raw) continue;
  data[p.to][p.key][p.field] = raw;
  touch(p.key, p.field, p.value);
  dirty.add(p.to);
}
for (const id of dirty) {
  writeFileSync(SITES[id].file, JSON.stringify(data[id], null, 1) + "\n");
  console.log(
    `✓ 已写 ${SITES[id].label}：${SITES[id].file.replace(REPO + "/", "")}`,
  );
}
if (!dirty.size && plan.length) console.log("✓ 两边文本其实已相同，未写文件。");

if (dirty.size && !flags.has("no-build")) {
  for (const id of dirty) {
    execFileSync(process.execPath, [join(HERE, "build.mjs"), "build"], {
      cwd: REPO,
      stdio: "inherit",
      env: { ...process.env, PI_SITE: SITES[id].pi },
    });
  }
  console.log("✓ 已重建对应站的 index.html 与 js/zh-i18n.js");
} else if (dirty.size) {
  console.log(
    `⚠ 用了 --no-build：记得自己跑  PI_SITE=career node tools/build.mjs build`,
  );
}
if (!conflicts.length) saveState();
console.log(
  "下一步：git add -A && git commit -m '…' && git push（或编辑台里点 🚀 发布）",
);
reportOneSided();
process.exit(conflicts.length ? 2 : 0);

/* --------------------------- 工具函数 --------------------------- */
function other(x) {
  return x === "main" ? "career" : "main";
}
function touch(k, f, v) {
  state[k] = state[k] || {};
  state[k][f] = v;
}
function saveState() {
  writeFileSync(STATE, JSON.stringify(state, null, 1) + "\n");
}
// 求职页里的图片写 ../assets/…，研究主页写 assets/…
function relink(v, targetSite) {
  if (typeof v !== "string" || !v.includes("assets/")) return v;
  const pre = targetSite === "career" ? "../" : "";
  return v.replace(
    /\b(src|href|poster)="(?:\.\.\/)?assets\/([^"]*)"/g,
    (_m, attr, rest) => `${attr}="${pre}assets/${rest}"`,
  );
}
function unwind(v) {
  return typeof v === "string"
    ? v.replace(/\b(src|href|poster)="\.\.\/assets\//g, '$1="assets/')
    : v;
}
// 编辑台会在 .lab 里塑一层带内联样式的 span，把值又困回标签里 → 拉平成规范写法：
//   <span class="lab">Data：</span> 值
function defunk(v) {
  if (typeof v !== "string" || !v.includes('class="lab"')) return v;
  const nest =
    /<span class="lab">([^<]*?)((?:&nbsp;|\s)*)<span style="[^"]*">([\s\S]*?)<\/span><\/span>/g;
  return v
    .replace(
      nest,
      (_m, lab, _sp, val) =>
        `<span class="lab">${lab.trim()}</span> ${val.trim()}`,
    )
    .replace(
      /<span style="[^"]*background-color: rgba\(245, 158, 11[^">]*">([\s\S]*?)<\/span>/g,
      "$1",
    );
}
function text(s) {
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function cut(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function reportOneSided() {
  const onlyMain = Object.keys(data.main).filter((k) => !(k in data.career));
  const onlyCareer = Object.keys(data.career).filter((k) => !(k in data.main));
  if (onlyMain.length)
    console.log(
      `\nℹ 只在研究主页（${onlyMain.length}，永不复制）：${onlyMain.slice(0, 14).join(" ")}${onlyMain.length > 14 ? " …" : ""}`,
    );
  if (onlyCareer.length)
    console.log(
      `ℹ 只在求职页（${onlyCareer.length}，永不复制）：${onlyCareer.slice(0, 14).join(" ")}${onlyCareer.length > 14 ? " …" : ""}`,
    );
}
function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}
