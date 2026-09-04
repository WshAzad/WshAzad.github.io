#!/usr/bin/env node
// ============================================================
// studio.mjs — 个人主页本地编辑台
// 用法: node tools/studio.mjs [--port 3838]
// 界面: http://127.0.0.1:3838
//   · 左侧列出现有内容条目（中英成对）
//   · 修改 → 保存（写入 content.json 并重新生成 index.html / zh-i18n.js）
//   · 发布（git commit + push → GitHub Pages 自动部署）
// ============================================================
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync, execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readTheme,
  render,
  resetTheme,
  writeTheme,
} from "./build.mjs";
import {
  FONT_PRESETS,
  THEME_DEFAULTS,
  THEME_FIELDS,
  VAR_NAMES,
} from "./theme.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), ".."); // 仓库根：/assets 是全站共享的
const ROOT = process.env.PI_SITE ? join(REPO, process.env.PI_SITE) : REPO;
const CONTENT = join(ROOT, "content.json");
const pi = process.argv.indexOf("--port");
const PORT = Number(pi > -1 ? process.argv[pi + 1] : process.env.PORT || 3838);

const GROUP_MAIN = [
  [
    "导航/Hero/筛选",
    (k) =>
      [
        "nav_research",
        "nav_education",
        "nav_experience",
        "nav_honors",
        "hero_role",
        "hero_int",
        "cv_chip",
        "st_rr",
        "st_wp",
        "st_gpa",
        "f_all",
        "f_rr",
        "f_wp",
        "f_award",
        "sec_research",
        "sec_edu",
        "sec_exp",
        "sec_hon",
        "sec_phd",
      ].includes(k),
  ],
  ["论文① 开发区", (k) => k.startsWith("p1_") || k === "b_jrs"],
  ["论文② 集聚与户籍", (k) => k.startsWith("p2_") || k === "b_hssc"],
  ["论文③ 生成式AI", (k) => k.startsWith("p3_") || k === "b_wp"],
  [
    "ICM / 博士计划",
    (k) => ["icm_t", "icm_desc", "icm_body", "phd", "b_icm"].includes(k),
  ],
  [
    "教育 / 经历 / 荣誉 / 页脚",
    (k) =>
      k.startsWith("edu_") ||
      k.startsWith("exp_") ||
      k.startsWith("hon_") ||
      k === "footer",
  ],
];
// /career 求职页分组（key 名与 index.html 的 data-i18n 一致；新增前缀请补这里，否则落到「其他」）
const GROUP_CAREER = [
  [
    "导航/Hero/下载",
    (k) =>
      k.startsWith("nav_") ||
      [
        "h1",
        "hero_role",
        "hero_int",
        "contact_email",
        "dl_en",
        "dl_cn",
        "dl_cl",
      ].includes(k),
  ],
  ["关于/优势", (k) => ["sec_about", "about_1", "s1", "s2", "s3"].includes(k)],
  ["教育背景", (k) => k === "sec_edu" || /^edu_/.test(k)],
  ["经历", (k) => k === "sec_exp" || /^e[0-9]_/.test(k)],
  [
    "研究",
    (k) =>
      k === "sec_research" ||
      /^(p[1-3]_|icm_)/.test(k) ||
      ["res_intro", "res_note", "b_jrs", "b_hssc", "b_wp", "b_icm"].includes(k),
  ],
  ["技能", (k) => ["sec_skills", "sk1", "sk2", "sk3", "sk4"].includes(k)],
  [
    "简历与联系/页脚",
    (k) =>
      ["sec_docs", "doc_a", "doc_b", "doc_c", "note", "footer"].includes(k),
  ],
];
const GROUP = ROOT.endsWith("career") ? GROUP_CAREER : GROUP_MAIN;
function groupOf(k) {
  const g = GROUP.find(([, f]) => f(k));
  return g ? g[0] : "其他";
}

function load() {
  try {
    return JSON.parse(readFileSync(CONTENT, "utf8"));
  } catch (e) {
    throw new Error(
      `content.json 不是合法 JSON（${e.message}）—— 先用 git checkout -- ${CONTENT} 恢复`,
    );
  }
}
function save(data) {
  writeFileSync(CONTENT, JSON.stringify(data, null, 1) + "\n");
}
const j = (o, code = 200) => ({
  code,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(o),
});
function strip(h) {
  return h
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (r) => {
    res.writeHead(r.code, r.headers);
    res.end(r.body);
  };
  try {
    const STATIC = new Set(["/css/", "/js/", "/assets/", "/tools/"]);
    if (
      req.method === "GET" &&
      STATIC.has(
        url.pathname.slice(0, 1) +
          url.pathname.split("/").slice(1, 2).join("/") +
          "/",
      ) &&
      !url.pathname.includes("..")
    ) {
      const rel = url.pathname.slice(1);
      // 本站优先；缺失时回退到仓库根的共享 /assets（/career 里的 ../assets/…）
      const local = join(ROOT, rel);
      const shared = join(REPO, rel);
      const file = existsSync(local)
        ? local
        : rel.startsWith("assets/") && existsSync(shared)
          ? shared
          : local;
      if (
        existsSync(file) &&
        (file.startsWith(ROOT + "/") || file.startsWith(REPO + "/"))
      ) {
        const map = {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".pdf": "application/pdf",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
        };
        const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
        res.writeHead(200, {
          "content-type": map[ext] || "application/octet-stream",
        });
        return res.end(readFileSync(file));
      }
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/site")
    ) {
      let html = readFileSync(join(ROOT, "index.html"), "utf8");
      html = html.replace("</body>", '<script src="/edit.js"></script></body>');
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && url.pathname === "/edit.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      return res.end(
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), "edit.js")),
      );
    }
    if (req.method === "GET" && url.pathname === "/api/content") {
      const c = load();
      const list = Object.keys(c).map((k) => ({
        key: k,
        group: groupOf(k),
        en: c[k].en,
        zh: c[k].zh,
        hint: strip(c[k].en).slice(0, 42) || strip(c[k].zh).slice(0, 42),
      }));
      return send(j({ groups: GROUP.map(([g]) => g), list }));
    }
    if (req.method === "GET" && url.pathname === "/api/theme") {
      // 控件元数据（range/min/max）+ 变量名映射都仍在这里 → edit.js 不写两遂
      return send(
        j({
          theme: readTheme(),
          fields: THEME_FIELDS,
          fonts: FONT_PRESETS,
          varNames: VAR_NAMES,
          defaults: THEME_DEFAULTS,
        }),
      );
    }
    if (req.method === "POST" && url.pathname === "/api/theme") {
      let b = "";
      for await (const x of req) b += x;
      let patch = {};
      try {
        patch = JSON.parse(b || "{}");
      } catch {
        return send(j({ error: "theme 不是合法 JSON" }, 400));
      }
      const theme = patch.reset ? resetTheme() : writeTheme(patch.values);
      render(); // 同步 css/theme.css（顺带重建 index.html）
      return send(j({ ok: true, theme, varNames: VAR_NAMES }));
    }
    if (req.method === "POST" && url.pathname === "/api/save") {
      let b = "";
      for await (const x of req) b += x;
      const { key, en, zh } = JSON.parse(b || "{}");
      const c = load();
      if (!c[key]) return send(j({ error: "no such key: " + key }, 400));
      if (typeof en === "string") c[key].en = en;
      if (typeof zh === "string") c[key].zh = zh;
      save(c);
      render(); // 重新生成 index.html + zh-i18n.js
      return send(j({ ok: true }));
    }
    if (req.method === "POST" && url.pathname === "/api/publish") {
      const msg =
        "content update @ " +
        new Date().toISOString().slice(0, 16).replace("T", " ");
      // 只提本站 + 仓库根共享图：/api/upload 会把 career 里引用的共享研究图写到 REPO/assets，
      // 以前只 add ROOT 子树 → 图没上去但 UI 说「已发布」（静默假成功）
      const rel = (p) =>
        p === REPO ? "." : p.startsWith(REPO + "/") ? p.slice(REPO.length + 1) : p;
      const stage = [...new Set([rel(ROOT), "assets"])];
      const dirtyCount = execFileSync(
        "git",
        ["status", "--porcelain", "--", ...stage],
        { cwd: REPO },
      )
        .toString()
        .split("\n").filter(Boolean).length;
      let ahead = 0;
      try {
        ahead =
          Number(
            execFileSync(
              "git",
              ["rev-list", "--count", "origin/main..HEAD"],
              { cwd: REPO },
            ).toString().trim(),
          ) || 0;
      } catch {
        ahead = 0; // 还没有 origin/main 引用 → 当作有东西要推
      }
      let committed = false;
      if (dirtyCount) {
        try {
          execFileSync("git", ["add", "-A", "--", ...stage], { cwd: REPO });
          execFileSync("git", ["commit", "-m", msg], { cwd: REPO, stdio: "pipe" });
          committed = true;
        } catch (e) {
          const out = String(e.stdout || "") + String(e.stderr || "");
          return send(
            j({ ok: false, error: "commit failed: " + (out || e.message) }),
          );
        }
      }
      // 没东西可发 → 老实说 no，以前这里回 ok:true，UI 就跟着说「已发布」
      if (!committed && !ahead)
        return send(
          j({
            ok: false,
            nothing: true,
            commit: msg,
            note: "没有需要提交的改动（已是最新）",
          }),
        );
      execFile("git", ["push", "-q", "origin", "main"], { cwd: REPO }, (e) => {
        if (e)
          return send(j({ ok: false, error: "push failed: " + e.message }));
        send(
          j({
            ok: true,
            committed,
            files: dirtyCount,
            note: committed ? "" : "只推了之前未推送的提交",
          }),
        );
      });
      return; // 异步 push 由回调 send
    }
    if (req.method === "POST" && url.pathname === "/api/upload") {
      let b = "";
      for await (const x of req) b += x;
      const { path: pth, data } = JSON.parse(b || "{}");
      if (!/^\/assets\/[\w\-./]+$/.test(pth || "") || pth.includes(".."))
        return send(j({ error: "bad path" }, 400));
      const m = data.match(/^data:([\w/+.-]+);base64,(.+)$/s);
      if (!m) return send(j({ error: "bad data" }, 400));
      const cand = [join(ROOT, pth.slice(1)), join(REPO, pth.slice(1))].filter(
        (f) =>
          f.startsWith(join(ROOT, "assets") + "/") ||
          f.startsWith(join(REPO, "assets") + "/"),
      );
      // 已存在的图就地更新（共享图 → 仓库根），新图写入本站
      const file = cand.find((f) => existsSync(f)) || cand[0];
      if (!cand.length) return send(j({ error: "bad path" }, 400));
      writeFileSync(file, Buffer.from(m[2], "base64"));
      return send(j({ ok: true, path: pth }));
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      try {
        const last = execFileSync(
          "git",
          ["log", "-1", "--format=%h %ad %s", "--date=short"],
          { cwd: ROOT },
        )
          .toString()
          .trim();
        const dirty = execFileSync("git", ["status", "--porcelain"], {
          cwd: ROOT,
        })
          .toString()
          .trim()
          .split("\n")
          .filter(Boolean).length;
        return send(j({ last, dirty }));
      } catch {
        return send(j({ last: "", dirty: -1 }));
      }
    }
    send(j({ error: "not found" }, 404));
  } catch (e) {
    send(j({ error: String(e) }, 500));
  }
});

server.listen(PORT, () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(
    `\n✎ 主页可视化编辑台: ${url}\n   点页面右下角 “✎ 编辑本页” → 直接改文字 → 💾保存 / 🚀发布 (Ctrl+C 退出)\n`,
  );
  if (process.platform === "darwin" && !process.env.NO_OPEN)
    execFile("open", [url]);
});
