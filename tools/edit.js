/* =====================================================================
   edit.js — 可视化(所见即所得)编辑脚本，仅由本地 studio (/site) 注入。
   工作流：✎ 开启 → 直接点击页面文字修改 → 💾 保存(当前语言) → 自动重建+刷新
   ===================================================================== */
(() => {
  if (window.__visEditLoaded) return;
  window.__visEditLoaded = true;
  const CSS = `
  .ve-btn{position:fixed;right:18px;bottom:18px;z-index:99999;border:none;border-radius:999px;
    padding:10px 18px;font:600 14px/1 -apple-system,"PingFang SC",sans-serif;cursor:pointer;
    background:#0a58ca;color:#fff;box-shadow:0 6px 20px rgba(10,88,202,.35)}
  .ve-btn:hover{filter:brightness(1.08)}
  .ve-panel{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99998;
    display:flex;gap:8px;align-items:center;background:#fff;color:#1c1e21;
    border:1px solid #e2e5ea;border-radius:14px;padding:8px 12px;box-shadow:0 8px 30px rgba(0,0,0,.18);
    font:13px/1.4 -apple-system,"PingFang SC",sans-serif}
  .ve-panel button{border:none;border-radius:9px;padding:8px 13px;font:600 13px/1 inherit;cursor:pointer}
  .ve-save{background:#16a34a;color:#fff}
  .ve-undo{background:#eef1f5;color:#1c1e21}
  .ve-off{background:#fff;color:#6b7280;border:1px solid #e2e5ea}
  .ve-hint{color:#6b7280;font-size:12px;margin-right:4px}
  [data-i18n][contenteditable="true"]{outline:2px dashed rgba(245,158,11,.7);outline-offset:2px;
    border-radius:3px;cursor:text;transition:box-shadow .15s}
  [data-i18n][contenteditable="true"]:hover,[data-i18n][contenteditable="true"]:focus{
    outline-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18);background:rgba(245,158,11,.05)}
  .ve-badge{position:fixed;left:18px;bottom:18px;z-index:99997;font:600 12px/1 -apple-system,"PingFang SC",sans-serif;
    background:#fdf1dc;color:#7a4b00;border:1px solid #ecd3a0;border-radius:999px;padding:6px 11px}
  `;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let on = false;
  let snap = null; // 进入编辑时的语言与原稿快照（undo）

  const btn = document.createElement('button');
  btn.className = 've-btn';
  btn.textContent = '✎ 编辑本页';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 've-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <span class="ve-hint">✎ 编辑模式：点击文字直接修改，保存作用于<span id="veLang"></span>版</span>
    <button class="ve-undo">撤销</button>
    <button class="ve-save">💾 保存</button>
    <button class="ve-pub">🚀 发布上线</button>
    <button class="ve-off">✕ 退出</button>
    <span id="veMsg"></span>`;
  document.body.appendChild(panel);
  const $ = (s) => panel.querySelector(s);
  const MSG = $('#veMsg');
  function veMsg(t, ok = true) {
    MSG.textContent = t;
    MSG.style.color = ok ? '#16a34a' : '#b91c1c';
  }

  function els() { return [...document.querySelectorAll('[data-i18n]')]; }
  function lang() { return document.documentElement.lang === 'zh' ? 'zh' : 'en'; }

  async function saveOne(key, html, lg) {
    await fetch('/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(lg === 'zh' ? { key, zh: html } : { key, en: html }),
    });
  }

  async function start() {
    on = true;
    snap = await (await fetch('/api/content')).json(); // 撤销快照(含双语)
    els().forEach((el) => el.setAttribute('contenteditable', 'true'));
    btn.style.display = 'none';
    panel.style.display = 'flex';
    $('.ve-save').textContent = '💾 保存';
    setHint();
  }
  function setHint() {
    $('#veLang').textContent = lang() === 'zh' ? '中文' : 'English';
  }
  function end() {
    on = false;
    els().forEach((el) => el.removeAttribute('contenteditable'));
    panel.style.display = 'none';
    btn.style.display = '';
  }
  async function saveAll() {
    const lg = lang();
    const btnEl = $('.ve-save');
    const prev = btnEl.textContent;
    btnEl.textContent = '保存中…';
    btnEl.disabled = true;
    try {
      for (const el of els()) {
        await saveOne(el.dataset.i18n, el.innerHTML.trim(), lg);
      }
      btnEl.textContent = '✓ 已保存并重建';
      setTimeout(() => { btnEl.textContent = prev; btnEl.disabled = false; location.reload(); }, 900);
    } catch (e) {
      btnEl.textContent = '失败: ' + e.message;
      setTimeout(() => { btnEl.textContent = prev; btnEl.disabled = false; }, 2000);
    }
  }
  function undo() {
    if (!snap) return;
    const lg = lang();
    const cur = lang() === 'zh' ? 'zh' : 'en';
    for (const it of snap.list) {
      const el = document.querySelector(`[data-i18n="${it.key}"]`);
      if (el) el.innerHTML = it[cur];
    }
  }
  btn.onclick = start;
  $('.ve-save').onclick = saveAll;
  $('.ve-undo').onclick = undo;
  $('.ve-off').onclick = end;
  $('.ve-pub').onclick = async () => {
    const b = $('.ve-pub'); b.disabled = true; b.textContent = '发布中…';
    try {
      const r = await fetch('/api/publish', { method: 'POST' });
      const d = await r.json();
      if (d.ok) { veMsg('✓ 已发布，约 1 分钟后线上生效'); }
      else { veMsg('发布失败: ' + (d.error || ''), false); }
    } catch (e) { veMsg('发布失败: ' + e.message, false); }
    b.disabled = false; b.textContent = '🚀 发布上线';
  };
  // 语言切换时更新提示
  const lt = document.getElementById('langToggle');
  if (lt) lt.addEventListener('click', () => setTimeout(setHint, 50));

  // 顶部悬浮徽标（编辑中提示所在区块不可点）
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) end(); });
})();
