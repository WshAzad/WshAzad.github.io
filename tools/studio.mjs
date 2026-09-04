#!/usr/bin/env node
// ============================================================
// studio.mjs — 个人主页本地编辑台
// 用法: node tools/studio.mjs [--port 3838]
// 界面: http://127.0.0.1:3838
//   · 左侧列出现有内容条目（中英成对）
//   · 修改 → 保存（写入 content.json 并重新生成 index.html / zh-i18n.js）
//   · 发布（git commit + push → GitHub Pages 自动部署）
// ============================================================
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './build.mjs';

const ROOT = process.env.PI_SITE ? join(dirname(fileURLToPath(import.meta.url)), '..', process.env.PI_SITE) : join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content.json');
const pi = process.argv.indexOf('--port');
const PORT = Number(pi > -1 ? process.argv[pi + 1] : process.env.PORT || 3838);

const GROUP = [
  ['导航/Hero/筛选', k => ['nav_research','nav_education','nav_experience','nav_honors','hero_role','hero_int','cv_chip','st_rr','st_wp','st_gpa','f_all','f_rr','f_wp','f_award','sec_research','sec_edu','sec_exp','sec_hon','sec_phd'].includes(k)],
  ['论文① 开发区', k => k.startsWith('p1_') || k === 'b_jrs'],
  ['论文② 集聚与户籍', k => (k.startsWith('p2_') || k === 'b_hssc')],
  ['论文③ 生成式AI', k => k.startsWith('p3_') || k === 'b_wp'],
  ['ICM / 博士计划', k => ['icm_t','icm_desc','icm_body','phd'].includes(k)],
  ['教育 / 经历 / 荣誉 / 页脚', k => k.startsWith('edu_') || k.startsWith('exp_') || k.startsWith('hon_') || k === 'footer'],
];
function groupOf(k) { const g = GROUP.find(([, f]) => f(k)); return g ? g[0] : '其他'; }

function load() { return JSON.parse(readFileSync(CONTENT, 'utf8')); }
function save(data) { writeFileSync(CONTENT, JSON.stringify(data, null, 1) + '\n'); }
const j = (o, code = 200) => ({ code, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(o) });
function strip(h) { return h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (r) => { res.writeHead(r.code, r.headers); res.end(r.body); };
  try {
    const STATIC = new Set(['/css/', '/js/', '/assets/', '/tools/']);
    if (req.method === 'GET' && STATIC.has(url.pathname.slice(0, 1) + url.pathname.split('/').slice(1, 2).join('/') + '/') && !url.pathname.includes('..')) {
      const rel = url.pathname.slice(1);
      const file = join(ROOT, rel);
      if (existsSync(file) && file.startsWith(ROOT + '/')) {
        const map = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.pdf':'application/pdf', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
        const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
        res.writeHead(200, { 'content-type': map[ext] || 'application/octet-stream' });
        return res.end(readFileSync(file));
      }
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/site')) {
      let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
      html = html.replace('</body>', '<script src="/edit.js"></script></body>');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/edit.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'edit.js')));
    }
    if (req.method === 'GET' && url.pathname === '/api/content') {
      const c = load();
      const list = Object.keys(c).map(k => ({
        key: k, group: groupOf(k), en: c[k].en, zh: c[k].zh, hint: strip(c[k].en).slice(0, 42) || strip(c[k].zh).slice(0, 42),
      }));
      return send(j({ groups: GROUP.map(([g]) => g), list }));
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      let b = ''; for await (const x of req) b += x;
      const { key, en, zh } = JSON.parse(b || '{}');
      const c = load();
      if (!c[key]) return send(j({ error: 'no such key: ' + key }, 400));
      if (typeof en === 'string') c[key].en = en;
      if (typeof zh === 'string') c[key].zh = zh;
      save(c);
      render();                       // 重新生成 index.html + zh-i18n.js
      return send(j({ ok: true }));
    }
    if (req.method === 'POST' && url.pathname === '/api/publish') {
      const msg = 'content update @ ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
      execFileSync('git', ['add', '-A'], { cwd: ROOT });
      execFileSync('git', ['commit', '-m', msg], { cwd: ROOT, stdio: 'pipe' });
      execFile('git', ['push', '-q', 'origin', 'main'], { cwd: ROOT }, (e) => {
        if (e) return send(j({ ok: false, error: 'push failed: ' + e.message }));
        send(j({ ok: true, commit: msg }));
      });
      return; // 异步 push 由回调 send
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      let b = ''; for await (const x of req) b += x;
      const { path: pth, data } = JSON.parse(b || '{}');
      if (!/^\/assets\/[\w\-./]+$/.test(pth || '') || pth.includes('..')) return send(j({ error: 'bad path' }, 400));
      const m = data.match(/^data:([\w/+.-]+);base64,(.+)$/s);
      if (!m) return send(j({ error: 'bad data' }, 400));
      const file = join(ROOT, pth.slice(1));
      if (!file.startsWith(join(ROOT, 'assets') + '/')) return send(j({ error: 'bad path' }, 400));
      writeFileSync(file, Buffer.from(m[2], 'base64'));
      return send(j({ ok: true, path: pth }));
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      try {
        const last = execFileSync('git', ['log', '-1', '--format=%h %ad %s', '--date=short'], { cwd: ROOT }).toString().trim();
        const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim().split('\n').filter(Boolean).length;
        return send(j({ last, dirty }));
      } catch { return send(j({ last: '', dirty: -1 })); }
    }
    send(j({ error: 'not found' }, 404));
  } catch (e) { send(j({ error: String(e) }, 500)); }
});

server.listen(PORT, () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`\n✎ 主页可视化编辑台: ${url}\n   点页面右下角 “✎ 编辑本页” → 直接改文字 → 💾保存 / 🚀发布 (Ctrl+C 退出)\n`);
  if (process.platform === 'darwin' && !process.env.NO_OPEN) execFile('open', [url]);
});
