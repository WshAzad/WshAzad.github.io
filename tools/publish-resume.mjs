#!/usr/bin/env node
// ============================================================
// publish-resume.mjs — 简历一键「编译 + 提交 + 上线」
//
//   一条命令走完 6 步（默认**不跑 latex**：上线的就是你手上现成的 PDF）：
//     1) 查 PDF 新不新（.tex 比 PDF 新才提醒你，要脚本代劳加 --compile，且只编译变了的那几份）
//     2) 在 CV 仓库提交这些 .tex + .pdf（只提交这几个文件）
//     3) 把最新 PDF 拷进本站 career/assets/resumes/
//     4) 给下载链接加 ?v=<内容哈希> 破缓存（HR 拿到的一定是新版）
//     5) 重建 career 页面 + 提交 + pull --rebase + push
//     6) 轮询线上文件 md5，确认 GitHub Pages 真的部署完成
//
//   用法（仓库根执行，或直接双击桌面「发布简历.command」）：
//     node tools/publish-resume.mjs                 # 全流程
//     node tools/publish-resume.mjs --dry-run       # 只演一遍，不写不推
//     node tools/publish-resume.mjs --no-push       # 本地留痕，先不上线
//     node tools/publish-resume.mjs --compile       # 让脚本跑一次 latexmk（默认不编译；且只编译 .tex 变新的）
//     node tools/publish-resume.mjs --no-clean      # 发布完不要把编译中间文件扫走
//     node tools/publish-resume.mjs --no-bust       # 不改链接版本号
//     node tools/publish-resume.mjs --msg "补 CET-4" # 自定义提交说明
//     node tools/publish-resume.mjs --yes          # 不提问：文案改动跟简历一起上线
//     node tools/publish-resume.mjs --pdf-only     # 只上传两个 PDF，其他内容一律不提交
//     node tools/publish-resume.mjs --no-verify     # 推完就走，不等部署
//
//   只碰简历相关文件；站点里其他未提交改动一律不动（会提示你有几个）。
//   中文简历：2026-09-05 恢复发布（页面入口在 career/content.json 的 doc_a，链接版本号由 step 4 自动补）。
//   某条 job 若只想本地留痕不发布：site 写 null + retire 列出已传上去的路径（出现即被删）。
//   ⚠ content.json / index.html 是整体生成物：改简历链接和改文案在同一个文件里，
//     拆不开。所以 step 5 会问你「文案改动要不要一起上线」（--yes / --pdf-only 免提问）。
// ============================================================
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

// ---------------- 配置：换机器/改名只动这里 ----------------
const SITE = join(dirname(fileURLToPath(import.meta.url)), ".."); // 站点仓库根
const CV = process.env.CV_DIR || join(homedir(), "Desktop", "CV"); // 简历源码仓库
const PAGES = "https://wshazad.github.io"; // 线上地址前缀
const REMOTE = { name: "origin", branch: "main" };

const JOBS = [
  {
    label: "英文简历",
    tex: "Resume_General_EN_Wang_Shuhan.tex",
    pdf: "Resume_General_EN_Wang_Shuhan.pdf",
    site: "career/assets/resumes/Resume_EN.pdf",
  },
  {
    // 求职信：跟简历同一条链路（编译 → 覆盖 → 入口加 ?v= 破缓存 → 提交 → push → 校 md5）
    label: "英文求职信",
    tex: "Cover_Letter_General_EN_Wang_Shuhan.tex",
    pdf: "Cover_Letter_General_EN_Wang_Shuhan.pdf",
    site: "career/assets/resumes/Cover_Letter_EN.pdf",
  },
  {
    // 2026-09-05 恢复发布。若要回到「只本地留痕」：site 改 null 并加 retire: ["career/assets/resumes/Resume_CN.pdf"]
    label: "中文简历",
    tex: "Resume_General_CN_Wang_Shuhan.tex",
    pdf: "Resume_General_CN_Wang_Shuhan.pdf",
    site: "career/assets/resumes/Resume_CN.pdf",
  },
];

// career 站点的内容源（链接和文案都在这里，index.html 是生成物）
const CAREER = {
  content: "career/content.json",
  template: "career/tools/template.html",
  index: "career/index.html",
  zh: "career/js/zh-i18n.js",
};
// ----------------------------------------------------------

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const optVal = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};
const DRY = has("--dry-run");
const opts = {
  // 默认不编译：你编辑器保存时已经编译好了，发布只负责拿现成 PDF 上线
  compile: has("--compile"),
  clean: !has("--no-clean"),
  cvCommit: !has("--no-cv-commit"),
  push: !has("--no-push"),
  bust: !has("--no-bust"),
  verify: !has("--no-verify") && !has("--no-push"),
  yes: has("--yes"),
  pdfOnly: has("--pdf-only"),
  msg: optVal("--msg"),
};

const log = (s) => console.log(s);
const step = (n, s) => console.log(`\n\x1b[1m[${n}/6] ${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`);
const die = (s) => {
  console.error(`\n\x1b[31m✗ ${s}\x1b[0m`);
  process.exit(1);
};

function git(args, cwd = SITE, allowFail = false) {
  const r = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0 && !allowFail) die(`git ${args.join(" ")} 失败：\n${out}`);
  return out.trim();
}
function md5(file) {
  return createHash("md5").update(readFileSync(file)).digest("hex");
}
function need(cond, msg) {
  if (!cond) die(msg);
}
function headBlob(path) {
  // 从 HEAD 里取一个文件的原始字节（判断“提交里真的包含新文件”）
  const r = spawnSync("git", ["-C", SITE, "show", `HEAD:${path}`], {
    maxBuffer: 1 << 26,
  });
  return r.status === 0 ? r.stdout : null;
}
function bufMd5(buf) {
  return createHash("md5").update(buf).digest("hex");
}
async function ask(q) {
  if (!process.stdin.isTTY) return null; // 非交互环境：不猜，交回控制
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((res) => rl.question(q, res));
  rl.close();
  return a.trim().toLowerCase();
}

// ---------------- 0. 体检 ----------------
step(0, "体检");
for (const [dir, what] of [
  [CV, "简历源码仓库"],
  [SITE, "站点仓库"],
]) {
  need(
    existsSync(join(dir, ".git")),
    `${what}不存在或不是 git 仓库：${dir}（可用 CV_DIR=... 覆盖路径）`,
  );
}
for (const j of JOBS) {
  need(existsSync(join(CV, j.tex)), `缺源文件 ${join(CV, j.tex)}`);
}
ok(`源码仓库 ${CV}`);
ok(`站点仓库 ${SITE}`);
if (opts.push) {
  const auth = spawnSync(
    "ssh",
    [
      "-T",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      `git@github.com`,
    ],
    { encoding: "utf8" },
  );
  const msg = (auth.stdout || "") + (auth.stderr || "");
  if (/successfully authenticated/.test(msg)) ok("GitHub SSH 可用");
  else
    warn(
      `GitHub SSH 未通过（push 可能失败）：${msg.split("\n")[0] || "no response"}`,
    );
}

// ---------------- 1. 编译 ----------------
step(1, opts.compile ? "编译 LaTeX（--compile）" : "检查 PDF（默认不编译，直接用现成 PDF）");
// .tex 比 .pdf 新 = 改了没编译（或编译失败）
const texNewer = (j) =>
  existsSync(join(CV, j.pdf)) &&
  statSync(join(CV, j.tex)).mtimeMs > statSync(join(CV, j.pdf)).mtimeMs + 1000;
const stale = JOBS.filter(texNewer);
if (!opts.compile && !DRY && stale.length) {
  warn(
    `${stale.length} 份 .tex 比它的 PDF 新（这些改动的 PDF 还是旧的）：${stale.map((j) => j.label).join("、")}`,
  );
  const a = opts.yes
    ? "p"
    : await ask(
        "  [c] 先编译这几份再发 / [p] 就用现有 PDF 发布 / 其他文字=取消 ： ",
      );
  if (a === null)
    die(
      "非交互环境不能代你决定：加 --compile 让脚本编译，或 --yes 直接用现有 PDF",
    );
  if (a !== "p" && a !== "c") {
    console.log("\n  已取消：未提交、未推送，本地也没动。");
    process.exit(0);
  }
  if (a === "c") opts.compile = true;
}
if (!opts.compile) {
  ok(stale.length ? "按你的选择：直接发布现有 PDF" : "每份 PDF 都不比 .tex 旧 → 无需编译");
} else if (DRY) {
  warn("dry-run：不编译");
} else {
  const runLatexmk = (j, force) =>
    spawnSync(
      "latexmk",
      [
        ...(force ? ["-g"] : []),
        "-xelatex",
        "-interaction=nonstopmode",
        "-file-line-error",
        j.tex,
      ],
      { cwd: CV, encoding: "utf8", maxBuffer: 1 << 24 },
    );
  for (const j of JOBS) {
    // 只编译真正变了的：没动的 .tex 一律不碰，不白跑一遍也不生一堆中间文件
    if (existsSync(join(CV, j.pdf)) && !texNewer(j)) {
      ok(`${j.label} .tex 没有更新 → 跳过编译`);
      continue;
    }
    const logPath = join(CV, j.pdf.replace(/\.pdf$/, ".log"));
    const r = runLatexmk(j, false);
    if (r.status !== 0) {
      const logTxt = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      const errs = logTxt
        .split("\n")
        .filter((l) => /^!|Error:/.test(l))
        .slice(0, 6)
        .join("\n    ");
      die(`${j.label} 编译失败：\n    ${errs || "（见 .log）"}`);
    }
    need(existsSync(join(CV, j.pdf)), `${j.label} 编译完找不到 ${j.pdf}`);
    // latexmk 认为“无依赖变化”时不会重写 pdf；再强制跑一次，仍不新才报错
    if (
      statSync(join(CV, j.pdf)).mtimeMs <
      statSync(join(CV, j.tex)).mtimeMs - 1000
    ) {
      const r2 = runLatexmk(j, true);
      need(
        r2.status === 0 &&
          statSync(join(CV, j.pdf)).mtimeMs >=
            statSync(join(CV, j.tex)).mtimeMs - 1000,
        `${j.label} pdf 比 tex 旧、且强制重编译没生效（${r2.status === 0 ? "latexmk 报 up-to-date" : "latexmk 失败"}）——去 CV 目录手动跑一次看 .log`,
      );
    }
    ok(`${j.label} 已编译 → ${j.pdf}`);
  }
}
for (const j of JOBS) {
  need(
    existsSync(join(CV, j.pdf)),
    `缺成品 ${join(CV, j.pdf)}（编辑器里保存编译一次，或跑本脚本时加 --compile）`,
  );
  const raw = readFileSync(join(CV, j.pdf), "latin1");
  const cnt = [...raw.matchAll(/\/Count\s+(\d+)/g)].pop();
  // 压缩对象流里没 /Count → 问 Spotlight，再不行才留空
  let pages = cnt ? Number(cnt[1]) : 0;
  if (!pages) {
    const m = spawnSync("mdls", ["-name", "kMDItemNumberOfPages", "-raw", join(CV, j.pdf)], { encoding: "utf8" });
    const n = Number((m.stdout || "").trim());
    if (Number.isFinite(n) && n > 0) pages = n;
  }
  ok(
    `${j.label} md5=${md5(join(CV, j.pdf)).slice(0, 8)}${pages ? ` · ${pages} 页${pages > 1 ? "\x1b[33m（简历一般要求一页）\x1b[0m" : ""}` : ""}`,
  );
}

// ---------------- 2. CV 仓库提交 ----------------
step(2, "提交源码仓库（只提交这 4 个文件）");
const cvPaths = JOBS.flatMap((j) => [j.tex, j.pdf]);
{
  const dirty = git(["status", "--porcelain", "--", ...cvPaths], CV);
  const others =
    git(["status", "--porcelain"], CV).split("\n").filter(Boolean).length -
    dirty.split("\n").filter(Boolean).length;
  if (!dirty) {
    ok("两个 .tex/.pdf 相对上次提交没有变化，无需提交");
  } else if (DRY || !opts.cvCommit) {
    warn(
      `有改动未提交（${DRY ? "dry-run" : "--no-cv-commit"}）：\n    ${dirty.replace(/\n/g, "\n    ")}`,
    );
  } else {
    const msg =
      opts.msg ||
      `发布简历：更新通用简历（中英文，本地留痕） ${new Date().toISOString().slice(0, 10)}`;
    git(["add", "--", ...cvPaths], CV); // pdf 首次纳入跟踪时也不会漏
    git(["commit", "-m", msg, "--", ...cvPaths], CV);
    ok(`已提交 ${git(["rev-parse", "--short", "HEAD"], CV)} — ${msg}`);
    if (others > 0)
      warn(
        `CV 仓库还有 ${others} 处其他改动没提交（本次有意不碰，见 git工作流.md）`,
      );
  }
}

// ---------------- 3. 拷贝到站点 ----------------
step(3, "同步最新 PDF 到站点仓库");
const tags = {};
for (const j of JOBS) {
  if (!j.site) {
    ok(`${j.label}：不上传`);
    for (const p of j.retire || []) {
      const abs = join(SITE, p);
      if (existsSync(abs)) {
        if (DRY) warn(`dry-run：将删除已发布的 ${p}`);
        else {
          rmSync(abs);
          ok(`已撤回不再发布的 ${p}`);
        }
      }
    }
    continue;
  }
  const dst = join(SITE, j.site);
  const same = existsSync(dst) && md5(dst) === md5(join(CV, j.pdf));
  tags[j.site] = md5(join(CV, j.pdf)).slice(0, 8);
  if (same) ok(`${j.site} 已是最新（内容未变）`);
  else if (DRY) warn(`dry-run：将覆盖 ${j.site}`);
  else {
    copyFileSync(join(CV, j.pdf), dst);
    ok(`${j.site} ← ${j.pdf}`);
  }
}

// ---------------- 4. 下载链接：破缓存 + 检查中英文都在 ----------------
step(4, "检查 career 下载链接");
let touchedContent = false;
for (const f of [CAREER.content, CAREER.template]) {
  const p = join(SITE, f);
  if (!existsSync(p)) continue;
  const before = readFileSync(p, "utf8");
  let after = before;
  if (opts.bust) {
    for (const j of JOBS) {
      if (!j.site) continue;
      const tag = tags[j.site];
      // assets/resumes/Resume_EN.pdf  /  带旧 ?v= 的  →  统一改成新 ?v=
      const re = new RegExp(
        `assets/resumes/${j.site.split("/").pop().replace(".", "\\.")}(?:\\?v=[0-9a-f]+)?`,
        "g",
      );
      after = after.replace(
        re,
        `assets/resumes/${j.site.split("/").pop()}?v=${tag}`,
      );
    }
  }
  if (after !== before) {
    if (DRY) {
      warn(`dry-run：将改写 ${f} 的链接版本号`);
      continue;
    }
    writeFileSync(p, after);
    touchedContent = true;
    ok(opts.bust ? `${f} 链接版本号已更新` : `${f} 已更新`);
  }
}
{
  const tpl = existsSync(join(SITE, CAREER.template))
    ? readFileSync(join(SITE, CAREER.template), "utf8")
    : "";
  const cont = existsSync(join(SITE, CAREER.content))
    ? readFileSync(join(SITE, CAREER.content), "utf8")
    : "";
  for (const j of JOBS) {
    if (!j.site) {
      for (const p of j.retire || []) {
        const name = p.split("/").pop();
        const still = cont.includes(name) || tpl.includes(name);
        if (still)
          warn(
            `${name} 已不再生成，但页面里还留着指向它的链接（点了会 404）。` +
              `在 ${CAREER.content} 和 ${CAREER.template} 里删掉对应按钮/key 后重跑`,
          );
        else ok(`${name} 已下架，页面无残留入口`);
      }
      continue;
    }
    const name = j.site.split("/").pop();
    const linked = cont.includes(name) || tpl.includes(name);
    if (linked) ok(`${name} 有下载入口`);
    else
      warn(
        `线上页面目前**没有指向 ${name} 的入口**——文件传了也下不到。恢复链接：git checkout HEAD -- ${CAREER.content} 后重跑，或在编辑台里加回按钮`,
      );
  }
}
if (touchedContent && !DRY) {
  const r = spawnSync("node", [join(SITE, "tools", "build.mjs"), "build"], {
    cwd: SITE,
    encoding: "utf8",
    env: { ...process.env, PI_SITE: "career" },
  });
  if (r.status !== 0)
    die(`重建 career 页面失败：${r.stdout || ""}${r.stderr || ""}`);
  ok((r.stdout || "").trim().split("\n").pop());
}

// ---------------- 5. 站点仓库提交 + 推送 ----------------
step(5, "提交并推送到 GitHub");
// 只保留「确实还需要从仓库里拿掉」的路径：工作区里还在、或索引/HEAD 里还跟踪着。
// 已经删干净的文件不能出现在 git add 的 pathspec 里，否则 fatal: pathspec did not match（以前在这里崩过）
const trackedPaths = new Set(git(["ls-files"]).split("\n").filter(Boolean));
const retiredAll = JOBS.flatMap((j) => (j.site ? [] : j.retire || []));
const retired = retiredAll.filter(
  (p) => existsSync(join(SITE, p)) || trackedPaths.has(p),
);
const sitePaths = [
  ...JOBS.filter((j) => j.site).map((j) => j.site),
  ...retired,
  CAREER.content,
  CAREER.index,
  CAREER.zh,
  CAREER.template,
].filter(
  (f, i, a) =>
    (retired.includes(f) || existsSync(join(SITE, f))) && a.indexOf(f) === i,
);
{
  const dirty = git(["status", "--porcelain", "--", ...sitePaths]);
  if (dirty) {
    if (DRY) {
      warn(`dry-run：将提交以下文件：\n    ${dirty.replace(/\n/g, "\n    ")}`);
      opts.push = false;
    } else {
      // ① 只看简历相关的文件
      const pdfPaths = [
        ...JOBS.filter((j) => j.site)
          .map((j) => j.site)
          .filter((f) => existsSync(join(SITE, f))),
        ...retired, // 下架的 PDF 也要进提交，否则删除不会上线
      ];
      const textPaths = [
        CAREER.content,
        CAREER.index,
        CAREER.zh,
        CAREER.template,
      ].filter((f) => dirty.split("\n").some((l) => l.includes(f)));

      // ② 这些生成物里除了简历链接，还有多少行其他文案要一起上线
      const other = textPaths.length
        ? git(["diff", "--", ...textPaths])
            .split("\n")
            .filter(
              (l) => /^[-+][^-+]/.test(l) && !/Resume_(EN|CN)\.pdf/i.test(l),
            )
            .filter(
              (l) =>
                !/^[-+]\s*[{}[\],"']*(en|zh)"?:\s*"?<a href="assets\/resumes/.test(
                  l,
                ),
            )
        : [];

      let includeText = !opts.pdfOnly;
      if (other.length && textPaths.length) {
        console.log(
          `\n  这 4 个文件里，除简历链接外还有 \x1b[33m${other.length} 行\x1b[0m 待发布改动（生成物整文件提交，拆不开）：`,
        );
        for (const l of other.slice(0, 6))
          console.log(`    \x1b[90m${l.slice(0, 130)}\x1b[0m`);
        if (other.length > 6)
          console.log(`    \x1b[90m… 另有 ${other.length - 6} 行\x1b[0m`);
        let a = null;
        if (opts.yes) a = "a";
        else if (opts.pdfOnly) a = "p";
        else {
          a = await ask(
            "  [a] 一起上线（简历+这些文案） / [p] 只上传两个 PDF / 其他文字=取消 ： ",
          );
        }
        if (a === null) {
          die(
            "非交互环境不能代你决定：重跑时加 --yes（文案跟传）或 --pdf-only（只传 PDF）",
          );
        }
        if (
          a === "cancel" ||
          a === "c" ||
          (a !== "a" && a !== "p" && a !== "")
        ) {
          console.log("\n  已取消：未提交、未推送。本地改动都在。");
          process.exit(0);
        }
        includeText = a !== "p";
      }

      const commitPaths = includeText ? sitePaths : pdfPaths; // ⚠ 不能按 existsSync 过滤：已撤回的文件就是要提交它的**删除**
      const pubLabels = JOBS.filter((j) => j.site).map((j) => j.label);
      const msg =
        opts.msg ||
        `发布简历（${pubLabels.join("、") || "仅撤回"}） ${new Date().toISOString().slice(0, 10)}${includeText ? "（含待发布页面文案）" : ""}`;
      git(["add", "-A", "--", ...commitPaths]); // -A 才会把删除入索引
      git(["commit", "-m", msg, "--", ...commitPaths]);
      ok(`已提交 ${git(["rev-parse", "--short", "HEAD"])} — ${msg}`);
      if (!includeText)
        warn(
          "只传了 PDF：?v= 破缓存没提交，线上旧链接会命中缓存。想破缓存下次选 [a]",
        );
      const left = git(["status", "--porcelain"])
        .split("\n")
        .filter(Boolean).length;
      if (left > 0)
        warn(
          `站点还有 ${left} 处未提交改动，本次**没有**一起发布（编辑台的 🚀 会全量 add，这里刻意只传简历）`,
        );
    }
  } else {
    ok("站点仓库简历相关文件无变化，跳过提交");
  }
  // ③ 推之前先证实仓库里真的是最新版：“拷了但没提交”是静默失败，必须当场拦住
  for (const j of JOBS) {
    if (!j.site || DRY) continue;
    const blob = headBlob(j.site);
    need(
      blob && bufMd5(blob) === md5(join(CV, j.pdf)),
      `${j.site} 在仓库里的内容还不是最新编译结果（${blob ? "字节不一致" : "仓库里根本没这个文件"}）——本次**不能**算发布成功`,
    );
  }
  for (const p of retiredAll) {
    if (DRY) continue;
    need(
      !headBlob(p),
      `${p} 仍留在仓库里（下架没提交上去）——本次**不能**算发布成功`,
    );
  }
  ok("仓库内容已核对：上传的字节 = 编译结果，该下架的已下架");

  {
    // 上次“提交了但没推出去”会让网页永远停在旧版（本次静默补推）
    const ahead = git(
      ["rev-list", "--count", `${REMOTE.name}/${REMOTE.branch}..HEAD`],
      SITE,
      true,
    ).trim();
    if (!DRY && ahead && ahead !== "0")
      warn(
        `本地比远端多 ${ahead} 个未推的提交（上次点了发布没推完，这就是网页没更新的原因）——本次补推`,
      );
  }

  if (!opts.push || DRY) {
    warn("--no-push / dry-run：未推送，线上还是旧版");
    opts.verify = false;
  } else {
    const pull = git(
      ["pull", "--rebase", "--autostash", REMOTE.name, REMOTE.branch],
      SITE,
      true,
    );
    if (
      /error|fatal|Conflicting/i.test(pull) &&
      !/Already up to date|Fast-forward|Successfully rebase/i.test(pull)
    ) {
      git(["rebase", "--abort"], SITE, true);
      die(`拉取远端时冲突，已放弃 rebase、本地提交仍在：\n${pull}`);
    }
    const pushOut = git(["push", REMOTE.name, REMOTE.branch], SITE);
    ok(
      pushOut
        .split("\n")
        .filter((l) => /main|->|Everything/.test(l))
        .join("  ") || "已推送",
    );
  }
}

// ---------------- 6. 线上核对 ----------------
step(6, "核对线上是否已是新版");
const urls = JOBS.filter((j) => j.site).map(
  (j) => `${PAGES}/${j.site}?v=${tags[j.site]}`,
);
log(`  页面：${PAGES}/career/`);
for (const u of urls) log(`  文件：${u}`);
for (const p of retired) log(`  已下架：${PAGES}/${p}（应返回 404）`);
if (!opts.verify || DRY) {
  warn(opts.verify ? "dry-run：跳过核对" : "未核对（--no-verify / --no-push）");
} else {
  const want = Object.fromEntries(
    JOBS.filter((j) => j.site).map((j) => [j.site, md5(join(CV, j.pdf))]),
  );
  // Pages 走 Actions 部署（build + deploy）后，1.5~3 分钟属正常，放宽到 11 分钟
  const deadline = Date.now() + 660_000;
  const pending = new Set(Object.keys(want));
  while (pending.size && Date.now() < deadline) {
    for (const sitePath of [...pending]) {
      const url = `${PAGES}/${sitePath}?t=${Date.now()}`;
      const r = spawnSync(
        "curl",
        [
          "-sL",
          "--max-time",
          "25",
          "-o",
          "/tmp/_remote_resume.pdf",
          "-w",
          "%{http_code}",
          url,
        ],
        { encoding: "utf8" },
      );
      if (
        r.stdout === "200" &&
        existsSync("/tmp/_remote_resume.pdf") &&
        md5("/tmp/_remote_resume.pdf") === want[sitePath]
      ) {
        ok(`线上已是最新：${sitePath}`);
        pending.delete(sitePath);
      }
    }
    if (pending.size) {
      process.stdout.write("  …等 Actions 构建 + Pages 部署（约 1–3 分钟）\r");
      await sleep(15_000);
    }
    if (Date.now() > deadline) break;
  }
  for (const sitePath of pending) {
    warn(
      `线上还没刷新：${PAGES}/${sitePath} —— 稍后手动打开确认，或去 https://github.com/WshAzad/WshAzad.github.io/actions 看 Pages 部署任务`,
    );
  }
}

// ---------------- 收尾：把编译中间文件扫走（都不是 git 跟踪文件，可再生） ----------------
if (!DRY && opts.clean) {
  const EXT = [
    ".aux", ".log", ".out", ".fls", ".fdb_latexmk", ".xdv", ".toc",
    ".bbl", ".blg", ".lof", ".lol", ".nav", ".snm", ".vrb", ".synctex.gz",
  ].sort((a, b) => b.length - a.length);
  const bases = new Set(
    readdirSync(CV)
      .filter((f) => f.endsWith(".tex"))
      .map((f) => f.replace(/\.tex$/, "")),
  );
  const junk = [];
  for (const f of readdirSync(CV)) {
    if (f.endsWith(".tex") || f.endsWith(".pdf")) continue;
    const ext = EXT.find((e) => f.endsWith(e));
    if (ext && bases.has(f.slice(0, -ext.length))) junk.push(f);
  }
  for (const f of junk) {
    try {
      rmSync(join(CV, f));
    } catch {}
  }
  if (junk.length)
    ok(
      `扫走 ${junk.length} 个编译中间文件（${junk.slice(0, 3).join(", ")}${junk.length > 3 ? " …" : ""}）；.tex 与 .pdf 未动`,
    );
  else ok("CV 目录没有中间文件需要清理");
}

console.log(
  "\n\x1b[32m完成。\x1b[0m 流程就是：改 .tex → 编辑器保存自动出 PDF → 双击桌面「发布简历.command」（不跑 latex，直接上线）。\n",
);
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
