#!/usr/bin/env node
// ============================================================
// publish-cv.mjs — 研究主页「⬇ CV (PDF)」自动同步（学术 CV 专用小链路）
//
//   源：  ~/Desktop/CV/Wang_Shuhan_CV_Research.pdf   （.tex 在编辑器保存时已编译）
//   上线：https://wshazad.github.io/assets/CV_Wang_Shuhan.pdf   ← 站点文件名固定，外链不破
//
//   一条命令走完 7 步：
//     1) 等 PDF 写完（latexmk 写一半的 PDF 不上线）
//     2) 比对内容：本地/仓库里已是最新版 → 直接退出（幂等，重复跑不留空提交）
//     3) 在 CV 仓库提交 .tex + .pdf 留痕（只碰这两个文件）
//     4) 覆盖站点 assets/CV_Wang_Shuhan.pdf，并给下载链接补 ?v=<内容哈希> 破缓存
//     5) 重建研究主页（index.html / js/zh-i18n.js 是生成物）
//     6) 提交 + pull --rebase + push（只提交 CV 相关路径）
//     7) 轮询线上 md5，确认 GitHub Pages 真的换掉了旧文件
//
//   用法：
//     node tools/publish-cv.mjs              # 全流程（人跑，会打印每一步）
//     node tools/publish-cv.mjs --dry-run    # 只演一遍，不写不推
//     node tools/publish-cv.mjs --compile    # 先让脚本跑一次 latexmk
//     node tools/publish-cv.mjs --no-push    # 本地留痕，先不上线
//     node tools/publish-cv.mjs --no-bust    # 不改链接版本号
//     node tools/publish-cv.mjs --force      # 内容没变也照样提交推送一遍
//     node tools/publish-cv.mjs --quiet      # launchd 用：只写日志
//
//   自动触发：~/Library/LaunchAgents/com.wangshuhan.site-cv-sync.plist
//   盯着源 PDF/.tex，一改动就跑本脚本（--quiet）。见文件末尾「怎么暂停」。
//
//   ⚠ 和 career 那条链路（tools/publish-resume.mjs）互不相干：
//     那条管求职页的通用简历/求职信，是**另一份文档**，别互相覆盖。
//   ⚠ content.json / index.html 是整文件生成物：研究主页若有没发布的文案改动，
//     会和 ?v= 混在同一批里。所以 step 6 只在「除 ?v= 外无其他待发布改动」时才提交
//     文案文件，否则只提交 PDF，改动留在工作区等你手动发布。
//
//   怎么暂停自动发布（改稿期间不想每存一次就上线一版）：
//     touch ~/Developer/wshazad.github.io/tools/.publish-cv.paused     ← 暂停
//     rm    ~/Developer/wshazad.github.io/tools/.publish-cv.paused     ← 恢复
//
//   自动同步的开关（macOS launchd）：
//     装：launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.wangshuhan.site-cv-sync.plist
//     停：launchctl bootout gui/$(id -u)/com.wangshuhan.site-cv-sync
//     手跑一次：launchctl kickstart -k gui/$(id -u)/com.wangshuhan.site-cv-sync
//     看运行记录：tail -f ~/Library/Logs/site-cv-sync.log
//              tail -f ~/Developer/wshazad.github.io/tools/.publish-cv.log
// ============================================================
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  appendFileSync,
  statSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// launchd 给的 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，git/latexmk/curl 都找不到；先补齐。
const EXTRA_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/Library/TeX/texbin",
  join(homedir(), ".local/bin"),
];
process.env.PATH = [...new Set([...EXTRA_PATH, ...(process.env.PATH || "").split(":")])].join(":");

// ---------------- 配置：换文档/换机器只动这里 ----------------
const SITE = join(dirname(fileURLToPath(import.meta.url)), ".."); // 站点仓库根
const CV = process.env.CV_DIR || join(homedir(), "Desktop", "CV"); // 简历源码仓库
const PAGES = "https://wshazad.github.io";
const REMOTE = { name: "origin", branch: "main" };

const SRC = {
  tex: join(CV, "Wang_Shuhan_CV_Research.tex"),
  pdf: join(CV, "Wang_Shuhan_CV_Research.pdf"),
};
const DST = "assets/CV_Wang_Shuhan.pdf"; // 站点上的公开路径（保持旧名，已有外链不破）
const LINK_NAME = "CV_Wang_Shuhan.pdf"; // 链接里出现的形式
// ?v= 落点：模板是结构源，content.json 只放文案；index.html/zh-i18n.js 由 build 生成
const TEXT_SRC = ["content.json", "tools/template.html"];
const TEXT_GEN = ["index.html", "js/zh-i18n.js"];
const SITE_PATHS = [DST, ...TEXT_SRC, ...TEXT_GEN];

const PAUSE_FLAG = join(SITE, "tools", ".publish-cv.paused");
const LOG_FILE = join(SITE, "tools", ".publish-cv.log");
const LOCK_DIR = join(SITE, "tools", ".publish-cv.lock");
const STABLE_MS = 3000; // 源文件静默 3s 才认为写完了
const VERIFY_MS = process.env.CV_SYNC_VERIFY_MS
  ? Number(process.env.CV_SYNC_VERIFY_MS)
  : 660_000; // Pages 走 Actions 构建+部署，1–3 分钟属正常

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const QUIET = has("--quiet");
const DRY = has("--dry-run");
const opts = {
  compile: has("--compile"),
  push: !has("--no-push") && !DRY,
  bust: !has("--no-bust"),
  force: has("--force"),
};
// ----------------------------------------------------------

const lines = [];
function out(s) {
  lines.push(s);
  if (!QUIET) console.log(s);
}
const step = (n, s) => out(`[${n}/7] ${s}`);
const ok = (s) => out(`  ✓ ${s}`);
const warn = (s) => out(`  ! ${s}`);
function die(s) {
  out(`  ✗ ${s}`);
  finish(1, "FAIL");
}
function finish(code, verdict) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    const head = new Date().toISOString().replace("T", " ").slice(0, 19);
    // 每一行都记：只挑带 ✓/!/✗ 符号的行，会让「已是最新版」「已暂停」这类直接退出的
    // 运行在日志里断在 step 2，看不出结局。
    appendFileSync(
      LOG_FILE,
      `${head}  ${(verdict || (code === 0 ? "OK" : "FAIL")).padEnd(11)}  ${lines
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" | ")}\n`,
    );
  } catch {}
  rmLock();
  process.exit(code);
}
// 审完暂存区再提交：PDF 已是最新但仓库里有残留文案时，直接 git commit 会
// 返 “nothing to commit” 非零退出 → 被当成发布失败。
function hasStaged(paths, cwd = SITE) {
  const r = spawnSync("git", ["-C", cwd, "diff", "--cached", "--quiet", "--", ...paths], {
    encoding: "utf8",
  });
  return r.status === 1; // 0 = 无已暂存差异，1 = 有
}

function git(args, cwd = SITE, allowFail = false) {
  const r = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const text = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0 && !allowFail) die(`git ${args.join(" ")} 失败：\n${text}`);
  return text.trim();
}
function md5(file) {
  return createHash("md5").update(readFileSync(file)).digest("hex");
}
function headBlob(path) {
  const r = spawnSync("git", ["-C", SITE, "show", `HEAD:${path}`], {
    maxBuffer: 1 << 26,
  });
  return r.status === 0 ? r.stdout : null;
}
const bufMd5 = (b) => createHash("md5").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- 0. 体检 + 抢锁 ----------------
step(0, "体检");
let haveLock = false;
function rmLock() {
  if (!haveLock) return;
  try {
    if (Number(readFileSync(join(LOCK_DIR, "pid"), "utf8")) === process.pid)
      rmSync(LOCK_DIR, { recursive: true, force: true }); // 碍事的是里面那个 pid 文件，rmdirSync 会 ENOTEMPTY
  } catch {}
  haveLock = false;
}
if (existsSync(LOCK_DIR)) {
  let holder = 0;
  try {
    holder = Number(readFileSync(join(LOCK_DIR, "pid"), "utf8"));
  } catch {}
  const alive = holder && holder !== process.pid ? spawnSync("kill", ["-0", String(holder)], { encoding: "utf8" }).status === 0 : false;
  if (alive) {
    out(`已有另一个同步在跑（pid ${holder}）——本次退出，不做并发 git 操作`);
    process.exit(0); // 不是失败：不写日志不记 FAIL，让下一次文件改动再触发
  }
  warn(`发现残留锁（pid ${holder || "?"} 已不在）——清掉继续`);
  rmSync(LOCK_DIR, { recursive: true, force: true });
}
mkdirSync(LOCK_DIR, { recursive: true });
writeFileSync(join(LOCK_DIR, "pid"), String(process.pid));
haveLock = true;

if (existsSync(PAUSE_FLAG)) {
  out(`自动发布处于暂停状态（存在 ${PAUSE_FLAG.replace(SITE + "/", "")}）——本次跳过；要恢复：rm ${PAUSE_FLAG}`);
  finish(0, "PAUSED");
}
for (const [dir, what] of [
  [join(CV, ".git"), "简历源码仓库"],
  [join(SITE, ".git"), "站点仓库"],
]) {
  if (!existsSync(dir)) die(`${what}不存在或不是 git 仓库：${dir}（可用 CV_DIR=... 覆盖）`);
}
if (!existsSync(SRC.pdf)) die(`缺成品 ${SRC.pdf}（编辑器里保存编译一次，或跑本脚本时加 --compile）`);
if (!existsSync(join(SITE, DST)))
  warn(`${DST} 在站点上不存在——首次发布（研究主页的 CV 按钮会 404 到这次为止）`);
ok(`源 ${SRC.pdf}`);
ok(`目标 ${SITE}/${DST}`);

// ---------------- 1. 等文件写完 ----------------
step(1, "确认源 PDF 已写完");
let waited = 0;
for (;;) {
  const age = Date.now() - statSync(SRC.pdf).mtimeMs;
  if (age >= STABLE_MS) break;
  if (waited >= 30_000) die("PDF 一直在被写入（30s 内 mtime 没稳定）——先去 CV 目录手动编译完再跑");
  await sleep(1000);
  waited += 1000;
}
ok(waited ? `等了 ${Math.round(waited / 1000)}s 让写入结束` : "文件已静默，内容完整");
function basenameOf(p) {
  return p.split("/").pop();
}
// 编译必须在算哈希之前：先编再取 md5，否则拿的是旧 PDF 的哈希。
if (opts.compile) {
  if (!existsSync(SRC.tex)) die(`要编译但找不到源文件 ${SRC.tex}`);
  const r = spawnSync(
    "latexmk",
    ["-xelatex", "-interaction=nonstopmode", "-file-line-error", basenameOf(SRC.tex)],
    { cwd: CV, encoding: "utf8", maxBuffer: 1 << 24 },
  );
  if (r.status !== 0) {
    const logPath = SRC.pdf.replace(/\.pdf$/, ".log");
    const logTxt = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    die(
      `编译失败：\n${logTxt.split("\n").filter((l) => /^!|Error:/.test(l)).slice(0, 6).join("\n") || "（见 .log）"}`,
    );
  }
  ok(`已编译 ${basenameOf(SRC.tex)} → ${basenameOf(SRC.pdf)}`);
}
const srcMd5 = md5(SRC.pdf);
ok(`md5=${srcMd5.slice(0, 8)}`);
if (existsSync(SRC.tex) && statSync(SRC.tex).mtimeMs > statSync(SRC.pdf).mtimeMs + 1000) {
  warn("Wang_Shuhan_CV_Research.tex 比 PDF 新 → .tex 里的改动还没编译，上线的是现有 PDF（要脚本代劳加 --compile）");
}

// ---------------- 2. 要不要动 ----------------
step(2, "比对内容，判断需不需要发布");
const dstAbs = join(SITE, DST);
const sameLocal = existsSync(dstAbs) && md5(dstAbs) === srcMd5;
const blob = headBlob(DST);
const sameRepo = !!blob && bufMd5(blob) === srcMd5;
const ahead = git(["rev-list", "--count", `${REMOTE.name}/${REMOTE.branch}..HEAD`], SITE, true).trim();
const siteDirty = git(["status", "--porcelain", "--", ...SITE_PATHS], SITE).trim();
const tplPath = join(SITE, "tools", "template.html");
const linkTagged = existsSync(tplPath)
  ? readFileSync(tplPath, "utf8").includes(`${LINK_NAME}?v=${srcMd5.slice(0, 8)}`)
  : false;
const wantBust = opts.bust ? !linkTagged : false;

if (!opts.force && sameLocal && sameRepo && !siteDirty && ahead === "0" && !wantBust) {
  out("已是最新版（工作区/仓库/远端三处一致），无需发布");
  finish(0, "NO-CHANGE");
}
if (sameRepo && !sameLocal) warn("工作区里的 PDF 和仓库里的不一致（上次拷了没提交）——本次补上");
if (ahead && ahead !== "0") warn(`本地比远端多 ${ahead} 个未推的提交（上次提交没推完 = 网页停在旧版的原因）——本次补推`);
ok(`需要发布：${[
  !sameLocal || !sameRepo ? "更新 PDF" : null,
  wantBust ? "补 ?v= 破缓存" : null,
  siteDirty ? "有未提交的 CV 相关文件" : null,
  ahead && ahead !== "0" ? "补推未推提交" : null,
].filter(Boolean).join(" + ")}`);

// ---------------- 3. CV 仓库留痕 ----------------
step(3, "提交源码仓库（只提交这份 CV 的 .tex/.pdf）");
{
  if (!existsSync(SRC.tex)) warn("找不到同名 .tex，跳过 CV 仓库留痕");
  else {
    const cvPaths = [basenameOf(SRC.tex), basenameOf(SRC.pdf)];
    const dirty = git(["status", "--porcelain", "--", ...cvPaths], CV);
    if (!dirty) {
      ok("源文件相对上次提交无变化，无需提交");
    } else if (DRY || !opts.push) {
      warn(`有改动未提交（${DRY ? "dry-run" : "--no-push"}）：\n    ${dirty.replace(/\n/g, "\n    ")}`);
    } else {
      const msg = `学术CV更新：${LINK_NAME} ${new Date().toISOString().slice(0, 10)}`;
      git(["add", "--", ...cvPaths], CV, true);
      if (!hasStaged(cvPaths, CV)) {
        warn("git add 没产生已暂存内容（文件被 .gitignore 忽略？）——跳过 CV 仓库提交");
      } else {
        git(["commit", "-m", msg, "--", ...cvPaths], CV);
        ok(`已提交 ${git(["rev-parse", "--short", "HEAD"], CV)} — ${msg}（CV 仓库其他脏文件按约定不碰）`);
      }
    }
  }
}

// ---------------- 4. 覆盖到站点 + 破缓存 ----------------
step(4, "同步 PDF 到站点 + 更新下载链接版本号");
if (sameLocal) {
  ok(`${DST} 已是最新（内容未变）`);
} else if (DRY) {
  warn(`dry-run：将覆盖 ${DST}`);
} else {
  copyFileSync(SRC.pdf, dstAbs);
  ok(`${DST} ← ${basenameOf(SRC.pdf)}`);
}
const tag = srcMd5.slice(0, 8);
let textChanged = false;
if (!opts.bust) {
  warn("--no-bust：不改链接版本号（Pages 的 PDF 缓存 max-age=600，最坏 10 分钟后自动是新版）");
} else if (linkTagged) {
  ok("下载链接已经是 ?v=" + tag);
} else {
  let hit = 0;
  for (const f of TEXT_SRC) {
    const p = join(SITE, f);
    if (!existsSync(p)) continue;
    const before = readFileSync(p, "utf8");
    const re = new RegExp(`${LINK_NAME.replace(".", "\\.")}(?:\\?v=[0-9a-f]+)?`, "g");
    const after = before.replace(re, `${LINK_NAME}?v=${tag}`);
    if (after === before) continue;
    if (DRY) {
      warn(`dry-run：将改写 ${f} 的链接版本号`);
      hit++;
      continue;
    }
    writeFileSync(p, after);
    hit++;
    textChanged = true;
    ok(`${f} 链接版本号 → ?v=${tag}`);
  }
  if (!hit && !DRY)
    warn(
      `页面里没有指向 ${LINK_NAME} 的入口（模板被改过？）——文件传了但点不到，去 tools/template.html 的 CV 按钮确认`,
    );
}

// ---------------- 5. 重建研究主页 ----------------
step(5, "重建研究主页");
if (DRY) {
  ok("dry-run：不跑 build（生成物不落盘）");
} else if (!textChanged) {
  ok("文案源没改动 → 不动生成物（index.html / js/zh-i18n.js 保持原样）");
} else {
  const r = spawnSync("node", [join(SITE, "tools", "build.mjs"), "build"], {
    cwd: SITE,
    encoding: "utf8",
    env: process.env, // ⚠ 不设 PI_SITE = 根站（研究主页），别和 career 混
  });
  if (r.status !== 0) die(`重建失败：${r.stdout || ""}${r.stderr || ""}`);
  ok((r.stdout || "").trim().split("\n").pop() || "已重建 index.html / js/zh-i18n.js");
}

// ---------------- 6. 提交 + 推送 ----------------
step(6, "提交并推送到 GitHub");
{
  const dirty = git(["status", "--porcelain", "--", ...SITE_PATHS], SITE).trim();
  if (!dirty) {
    ok("站点 CV 相关文件无变化，跳过提交");
  } else if (DRY) {
    warn(`dry-run：将提交：\n    ${dirty.replace(/\n/g, "\n    ")}`);
  } else {
    // 除 ?v= 之外还有没有别的待发布文案改动？有 → 只提交 PDF，文案留在工作区。
    const textPaths = [...TEXT_SRC, ...TEXT_GEN].filter((f) =>
      dirty.split("\n").some((l) => l.includes(f)),
    );
    const other = textPaths.length
      ? git(["diff", "--", ...textPaths])
          .split("\n")
          .filter((l) => /^[-+][^-+]/.test(l) && !new RegExp(LINK_NAME).test(l))
      : [];
    let includeText = textPaths.length > 0;
    if (other.length) {
      warn(
        `生成物里除 CV 链接外还有 ${other.length} 行未发布的文案改动，整文件提交会一起上线——本次只提交 PDF，那 ${other.length} 行留在工作区等你手动发布`,
      );
      for (const l of other.slice(0, 3)) out(`    \x1b[90m${l.slice(0, 120)}\x1b[0m`);
      includeText = false;
    }
    const commitPaths = includeText ? [DST, ...textPaths] : [DST];
    const msg = `发布学术CV（${LINK_NAME}） ${new Date().toISOString().slice(0, 10)}${
      includeText || !textPaths.length ? "" : "（仅PDF；其他文案改动留在工作区待手动发布）"
    }`;
    git(["add", "-A", "--", ...commitPaths]);
    if (!hasStaged(commitPaths)) {
      ok("已暂存内容为空（PDF 早已在仓库里，只剩残留文案）——不造空提交");
    } else {
      git(["commit", "-m", msg, "--", ...commitPaths]);
      ok(`已提交 ${git(["rev-parse", "--short", "HEAD"])} — ${msg}`);
    }
  }
  // 「拷了但没提交」是静默失败，必须当场拦住
  if (!DRY) {
    const after = headBlob(DST);
    if (!after || bufMd5(after) !== srcMd5)
      die(`${DST} 在仓库里的字节还不是本次编译结果——本次不能算发布成功`);
    ok("仓库内容已核对：提交里的 PDF = 本地最新版");
  }
  if (!opts.push) {
    warn(DRY ? "dry-run：未提交未推送" : "--no-push：本地已留痕，未推送，线上还是旧版");
    finish(0, DRY ? "DRY-RUN" : "LOCAL-ONLY");
  }
  const pull = git(["pull", "--rebase", "--autostash", REMOTE.name, REMOTE.branch], SITE, true);
  if (/error|fatal|Conflicting/i.test(pull) && !/Already up to date|Fast-forward|Successfully rebase/i.test(pull)) {
    git(["rebase", "--abort"], SITE, true);
    die(`拉取远端时冲突，已放弃 rebase、本地提交仍在：\n${pull}`);
  }
  const pushed = git(["push", REMOTE.name, REMOTE.branch], SITE, true);
  if (/error|fatal/i.test(pushed) && !/Everything up-to-date/.test(pushed)) die(`推送失败：\n${pushed}`);
  ok(pushed.split("\n").filter((l) => /main|->|Everything/.test(l)).join("  ") || "已推送");
}

// ---------------- 7. 核对线上 ----------------
step(7, "核对线上是否已是新版");
{
  const url = `${PAGES}/${DST}`;
  out(`  文件：${url}`);
  out(`  页面：${PAGES}/`);
  const tmp = `/tmp/_cv_check_${process.pid}.pdf`;
  const deadline = Date.now() + VERIFY_MS;
  let verdict = "pending";
  while (Date.now() < deadline) {
    const r = spawnSync("curl", ["-sL", "--max-time", "25", "-o", tmp, "-w", "%{http_code}", `${url}?t=${Date.now()}`], {
      encoding: "utf8",
    });
    if (r.stdout === "200" && existsSync(tmp) && md5(tmp) === srcMd5) {
      verdict = "live";
      break;
    }
    await sleep(15_000);
  }
  rmSync(tmp, { force: true });
  if (verdict === "live") ok("线上已是最新（md5 一致）");
  else
    warn(
      `线上还没刷新（等满 ${Math.round(VERIFY_MS / 60000)} 分钟）——稍后打开 ${url} 确认，或去 https://github.com/WshAzad/WshAzad.github.io/actions 看 Pages 部署任务`,
    );
}
out(`完成。${QUIET ? "" : "研究主页顶栏「⬇ CV (PDF)」已指向最新编译结果。"}`);
finish(0, "PUBLISHED");
