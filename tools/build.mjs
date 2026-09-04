// ============================================================
// build.mjs — 单一内容源生成器
// 用法：
//   node tools/build.mjs seed      # 从现有 index.html + zh-i18n.js 生成 content.json 与 tools/template.html
//   node tools/build.mjs build     # 用 content.json 重新生成 index.html 与 js/zh-i18n.js
// 约定：结构改动才需重新 seed；日常文字修改只编辑 content.json（或经编辑台）。
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { clampTheme, themeCss } from './theme.mjs';

const ROOT = process.env.PI_SITE ? join(dirname(fileURLToPath(import.meta.url)), '..', process.env.PI_SITE) : join(dirname(fileURLToPath(import.meta.url)), '..');
const IDX = join(ROOT, 'index.html');
const ZH  = join(ROOT, 'js', 'zh-i18n.js');
const CONTENT = join(ROOT, 'content.json');
const TEMPLATE = join(ROOT, 'tools', 'template.html');

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

// 取 data-i18n="KEY" 元素的 (前缀, 内容, 后缀)
export function splitAtKey(html, key) {
  const attr = `data-i18n="${key}"`;
  const ai = html.indexOf(attr);
  if (ai === -1) return null;
  const openEnd = html.indexOf('>', ai);
  const prefix = html.slice(0, openEnd + 1);
  let i = openEnd + 1, stack = [];
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) { const ce = html.indexOf('-->', lt); if (ce === -1) break; i = ce + 3; continue; }
    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    const inner = html.slice(lt + 1, gt).trim();
    if (inner.startsWith('/')) {          // 闭合标签
      if (stack.length === 0) {
        return { prefix, content: html.slice(openEnd + 1, lt), suffix: html.slice(lt) };
      }
      stack.pop();
    } else if (!inner.endsWith('/') && !inner.startsWith('!')) {
      const name = (inner.match(/^[a-zA-Z0-9]+/) || [''])[0].toLowerCase();
      if (name && !VOID.has(name)) stack.push(name);
    }
    i = gt + 1;
  }
  return { prefix, content: html.slice(openEnd + 1), suffix: '' };
}

export function keysIn(html) {
  const out = [];
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function loadZh() {
  try {
    const code = readFileSync(ZH, 'utf8');
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return ctx.window.I18N_ZH || {};
  } catch { return {}; }
}

function sentinel(k) { return `<!--__I18N_${k}__-->`; }

// ---------- 版式 theme：theme.json（可编辑）→ css/theme.css（生成物）----------
const THEME_JSON = join(ROOT, 'theme.json');
const THEME_CSS = join(ROOT, 'css', 'theme.css');

export function readTheme() {
  if (!existsSync(THEME_JSON)) return clampTheme();
  try {
    return clampTheme(JSON.parse(readFileSync(THEME_JSON, 'utf8')));
  } catch (e) {
    // theme.json 坏了不值得把整站部署卡住，但必须响：在网页上改坏了会看到这行
    console.error(`⚠ ${THEME_JSON} 不是合法 JSON（${e.message}）—— 本次用默认版式`);
    return clampTheme();
  }
}

export function writeTheme(patch) {
  const next = clampTheme({ ...readTheme(), ...(patch || {}) });
  writeFileSync(THEME_JSON, JSON.stringify(next, null, 1) + '\n');
  return next;
}

export function resetTheme() {
  const next = clampTheme();
  writeFileSync(THEME_JSON, JSON.stringify(next, null, 1) + '\n');
  return next;
}

export function syncTheme() {
  const theme = readTheme();
  // theme.json 也自态归一：新增字段（如后加的 lh_h1）自动补上默认值，
  // 这样在 GitHub 网页上能看到/改到全部旋钮，不会只看到旧的那几个
  const wanted = JSON.stringify(theme, null, 1) + "\n";
  if (!existsSync(THEME_JSON) || readFileSync(THEME_JSON, "utf8") !== wanted) {
    writeFileSync(THEME_JSON, wanted);
  }
  const css = themeCss(theme);
  if (!existsSync(THEME_CSS) || readFileSync(THEME_CSS, 'utf8') !== css) {
    mkdirSync(dirname(THEME_CSS), { recursive: true });
    writeFileSync(THEME_CSS, css);
    console.log('css/theme.css 已从 theme.json 同步');
  }
  return { theme, created: false };
}

export function buildContentFile() {
  const html = readFileSync(IDX, 'utf8');
  const zh = loadZh();
  const content = {};
  for (const k of keysIn(html)) {
    const r = splitAtKey(html, k);
    if (!r) { console.warn('skip(not found):', k); continue; }
    content[k] = { en: r.content, zh: zh[k] ?? '' };
  }
  writeFileSync(CONTENT, JSON.stringify(content, null, 1) + '\n');
  // 模板 = 每处内容替换为哨兵
  let tpl = html;
  for (const k of Object.keys(content)) {
    const r = splitAtKey(tpl, k);
    if (!r) continue;
    tpl = tpl.replace(r.content, sentinel(k));
  }
  writeFileSync(TEMPLATE, tpl);
  console.log(`content.json: ${Object.keys(content).length} keys; template.html 已生成`);
}

// content.json 语法错（在 GitHub 网页上改漏逗号/引号是最典型的死法）→ 给人话，不给堆栈
function readJsonOrDie(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`✗ ${path} 不是合法 JSON：${e.message}`);
    console.error('  在 GitHub 网页上改过内容的话，检查最后一个 } 前是否多了逗号/漏了引号。');
    process.exit(1);
  }
}

export function render() {
  if (!existsSync(CONTENT) || !existsSync(TEMPLATE)) { console.error('先运行 seed'); process.exit(1); }
  syncTheme();
  const content = readJsonOrDie(CONTENT);
  const tpl = readFileSync(TEMPLATE, 'utf8');
  let html = tpl;
  for (const k of Object.keys(content)) {
    if (!html.includes(sentinel(k))) { console.warn('模板缺哨兵:', k); continue; }
    html = html.replace(sentinel(k), content[k].en ?? '');
  }
  writeFileSync(IDX, html);
  const entries = Object.entries(content).map(([k, v]) => {
    const en = v.zh ?? '';
    return `  ${JSON.stringify(k)}: ${JSON.stringify(en)},`;
  });
  const head = '/* AUTO-GENERATED by tools/build.mjs — 请勿手改；内容在 content.json */\nwindow.I18N_ZH = {\n';
  const tail = '\n};\n';
  writeFileSync(ZH, head + entries.join('\n') + tail);
  console.log(`index.html 与 zh-i18n.js 已由 content.json 重新生成（${Object.keys(content).length} keys）`);
}

const cmd = process.argv[2];
const isMain = !!process.argv[1] && process.argv[1].endsWith('build.mjs');
if (isMain) {
  if (cmd === 'seed') buildContentFile();
  else if (cmd === 'build') render();
  else if (cmd === 'theme') syncTheme();
  else console.log('用法: node tools/build.mjs seed|build|theme');
}
