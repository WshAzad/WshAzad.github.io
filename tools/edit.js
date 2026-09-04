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
  .ve-on main img{outline:2px dashed rgba(245,158,11,.6);outline-offset:2px;cursor:pointer}
  .ve-on main img:hover{outline-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18)}
  .ve-badge{position:fixed;left:18px;bottom:18px;z-index:99997;font:600 12px/1 -apple-system,"PingFang SC",sans-serif;
    background:#fdf1dc;color:#7a4b00;border:1px solid #ecd3a0;border-radius:999px;padding:6px 11px}
  .ve-btn2{position:fixed;right:18px;bottom:64px;z-index:99999;border:1px solid #d3dae6;border-radius:999px;
    padding:10px 16px;font:600 14px/1 -apple-system,"PingFang SC",sans-serif;cursor:pointer;
    background:#fff;color:#1c1e21;box-shadow:0 4px 14px rgba(16,24,40,.14)}
  .ve-btn2:hover{background:#f2f6ff;border-color:#0a58ca;color:#0a58ca}
  .ve-typo{position:fixed;right:18px;top:62px;z-index:99999;width:300px;
    max-height:calc(100vh - 178px); /* 不压住右下角的 Aa / ✎ 两个按钮 */
    overflow:auto;background:#fff;color:#1c1e21;border:1px solid #e2e5ea;border-radius:14px;
    padding:10px 12px 11px;box-shadow:0 12px 36px rgba(0,0,0,.22);
    font:12.5px/1.4 -apple-system,"PingFang SC",sans-serif}
  .ve-typo[hidden]{display:none}
  .ve-typo h4{margin:0;font-size:13px}
  .ve-typo .ve-sub{display:block;color:#6b7280;font-size:10.5px;margin-bottom:6px}
  .ve-ty-row{margin:0 0 5px}
  .ve-ty-row label{display:flex;justify-content:space-between;font-size:11.5px;color:#3f4652}
  .ve-ty-row output{font-variant-numeric:tabular-nums;color:#0a58ca;font-weight:600}
  .ve-typo input[type=range]{width:100%;height:16px;accent-color:#0a58ca;margin:0}
  .ve-typo select{width:100%;font:12px/1.3 -apple-system,"PingFang SC",sans-serif;padding:2px 5px;
    border:1px solid #d3dae6;border-radius:7px;background:#fff;color:#1c1e21}
  .ve-ty-btns{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}
  .ve-ty-btns button{border:none;border-radius:8px;padding:6px 9px;font:600 11.5px/1 inherit;cursor:pointer}
  .ve-ty-save{background:#16a34a;color:#fff}
  .ve-ty-reset{background:#eef1f5;color:#1c1e21}
  .ve-ty-pub{background:#0a58ca;color:#fff}
  .ve-ty-close{background:#fff;color:#6b7280;border:1px solid #e2e5ea !important}
  .ve-ty-msg{min-height:14px;margin-top:5px;font-size:11.5px;color:#6b7280}
  .ve-ty-cur{margin-top:5px;padding-top:6px;border-top:1px dashed #e2e5ea;color:#6b7280;font-size:11px}
  `;
	const style = document.createElement("style");
	style.textContent = CSS;
	document.head.appendChild(style);

	let on = false;
	let snap = null; // 进入编辑时的语言与原稿快照（undo）
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
	fileInput.style.display = "none";
	document.body.appendChild(fileInput);

	function imgs() {
		return [...document.querySelectorAll("main img")];
	}
	function onImgPick(e) {
		e.preventDefault();
		e.stopPropagation();
		fileInput.onchange = async () => {
			const f = fileInput.files[0];
			if (!f) return;
			const img = e.currentTarget;
			const src = img.getAttribute("src") || "";
			const at = src.indexOf("assets/"); // 支持 assets/… 与 ../assets/…（全站共享图）
			if (at === -1) {
				veMsg("暂只支持替换页面内 assets/ 图片", false);
				return;
			}
			const rel = src.slice(at).split("?")[0]; // 形如 assets/photo.png
			const ext = (f.name.match(/\.(png|jpe?g|webp)$/i) || [
				"",
				".png",
			])[0].toLowerCase();
			const path = "/" + rel.replace(/\.(png|jpe?g|webp)$/i, ext); // 保持原文件名风格
			const reader = new FileReader();
			reader.onload = async () => {
				try {
					const r = await fetch("/api/upload", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path, data: reader.result }),
					});
					const d = await r.json();
					if (!d.ok) throw new Error(d.error || "upload fail");
					img.src = rel + "?v=" + Date.now();
					veMsg("✓ 图片已替换（本地）。点击 🚀 发布上线即可更新线上");
				} catch (err) {
					veMsg("替换失败: " + err.message, false);
				}
			};
			reader.readAsDataURL(f);
			fileInput.value = "";
		};
		fileInput.click();
	}
	function bindImgs() {
		imgs().forEach((im) => im.addEventListener("click", onImgPick));
	}
	function unbindImgs() {
		imgs().forEach((im) => im.removeEventListener("click", onImgPick));
	}
	const btn = document.createElement("button");
	btn.className = "ve-btn";
	btn.textContent = "✎ 编辑本页";
	document.body.appendChild(btn);

	const panel = document.createElement("div");
	panel.className = "ve-panel";
	panel.style.display = "none";
	panel.innerHTML = `
    <span class="ve-hint">✎ 编辑模式：点击文字直接修改，保存作用于<span id="veLang"></span>版</span>
    <button class="ve-undo">撤销</button>
    <button class="ve-save">💾 保存</button>
    <button class="ve-pub">🚀 发布上线</button>
    <button class="ve-off">✕ 退出</button>
    <span id="veMsg"></span>`;
	document.body.appendChild(panel);
	const $ = (s) => panel.querySelector(s);
	const MSG = $("#veMsg");
	function veMsg(t, ok = true) {
		MSG.textContent = t;
		MSG.style.color = ok ? "#16a34a" : "#b91c1c";
	}

	function els() {
		return [...document.querySelectorAll("[data-i18n]")];
	}
	function lang() {
		return document.documentElement.lang === "zh" ? "zh" : "en";
	}

	async function saveOne(key, html, lg) {
		await fetch("/api/save", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(lg === "zh" ? { key, zh: html } : { key, en: html }),
		});
	}

	async function start() {
		on = true;
		snap = await (await fetch("/api/content")).json(); // 撤销快照(含双语)
		document.body.classList.add("ve-on");
		els().forEach((el) => el.setAttribute("contenteditable", "true"));
		bindImgs();
		btn.style.display = "none";
		panel.style.display = "flex";
		$(".ve-save").textContent = "💾 保存";
		setHint();
	}
	function setHint() {
		$("#veLang").textContent = lang() === "zh" ? "中文" : "English";
	}
	function end() {
		on = false;
		document.body.classList.remove("ve-on");
		els().forEach((el) => el.removeAttribute("contenteditable"));
		unbindImgs();
		panel.style.display = "none";
		btn.style.display = "";
	}
	async function saveAll() {
		const lg = lang();
		const btnEl = $(".ve-save");
		const prev = btnEl.textContent;
		btnEl.textContent = "保存中…";
		btnEl.disabled = true;
		try {
			for (const el of els()) {
				await saveOne(el.dataset.i18n, el.innerHTML.trim(), lg);
			}
			btnEl.textContent = "✓ 已保存并重建";
			setTimeout(() => {
				btnEl.textContent = prev;
				btnEl.disabled = false;
				location.reload();
			}, 900);
		} catch (e) {
			btnEl.textContent = "失败: " + e.message;
			setTimeout(() => {
				btnEl.textContent = prev;
				btnEl.disabled = false;
			}, 2000);
		}
	}
	function undo() {
		if (!snap) return;
		const cur = lang() === "zh" ? "zh" : "en";
		for (const it of snap.list) {
			const el = document.querySelector(`[data-i18n="${it.key}"]`);
			if (el) el.innerHTML = it[cur];
		}
	}
	btn.onclick = start;
	$(".ve-save").onclick = saveAll;
	$(".ve-undo").onclick = undo;
	$(".ve-off").onclick = end;
	$(".ve-pub").onclick = () => publish($(".ve-pub"), (t, ok) => veMsg(t, ok));

	/* ============ Aa 版式：字号 / 字体 / 行距 / 版心（写 theme.json）============ */
	// 只把「跟打开时不一样」的 key 写回 content.json（未 ✘ 保存的文字也算进去）
	async function saveChanged(lg) {
		const cur = lg === "zh" ? "zh" : "en";
		const byKey = Object.fromEntries((snap?.list || []).map((it) => [it.key, it]));
		let n = 0;
		for (const el of els()) {
			const html = el.innerHTML.trim();
			const was = String(byKey[el.dataset.i18n]?.[cur] ?? "").trim();
			if (html === was) continue;
			await saveOne(el.dataset.i18n, html, lg);
			n++;
		}
		return n;
	}
	async function publish(b, say) {
		const prev = b.textContent;
		b.disabled = true;
		b.textContent = "发布中…";
		try {
			let saved = 0;
			// 关键：✎ 模式里改了字但没点 💾 就点 🚀 → 以前会“已发布”但其实什么都没提
			if (on) saved = await saveChanged(lang());
			const r = await fetch("/api/publish", { method: "POST" });
			const d = await r.json();
			if (d.ok) {
				say(
					`✓ 已发布${saved ? `（自动保存了 ${saved} 处文字改动）` : ""}，约 1–3 分钟后线上生效`,
					true,
				);
				if (saved) setTimeout(() => location.reload(), 1800);
			} else if (d.nothing) {
				say("✕ 未发布：本地没有待上线的改动（先在 ✎ 里改完保存再发）", false);
			} else {
				say("发布失败: " + (d.error || ""), false);
			}
		} catch (e) {
			say("发布失败: " + e.message, false);
		}
		b.disabled = false;
		b.textContent = prev;
	}

	const tyBtn = document.createElement("button");
	tyBtn.className = "ve-btn2";
	tyBtn.textContent = "Aa 版式";
	document.body.appendChild(tyBtn);

	const ty = document.createElement("div");
	ty.className = "ve-typo";
	ty.hidden = true;
	document.body.appendChild(ty);
	const tySay = (t, ok) => {
		const m = ty.querySelector(".ve-ty-msg");
		if (m) {
			m.textContent = t;
			m.style.color = ok ? "#16a34a" : "#b91c1c";
		}
	};

	let TY = null; // { theme, fields, fonts, varNames }
	let dirty = false;
	// 面板标签是模板拼接，全部过一遂转义（数据源是本地 theme.json / tools/theme.mjs）
	const esc = (s) =>
		String(s).replace(
			/[&<>\""]/g,
			(c) =>
				({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					'"': "&quot;",
					"'": "&#39;",
				})[c],
		);

	// 预览值 → CSS 变量：变量名仍由服务端 varNames 给，格式按 field.unit
	function applyVar(k, v) {
		const name = TY.varNames?.[k];
		const f = TY.fields.find((x) => x.key === k);
		if (!name || !f) return;
		const val = f.kind === "font" ? TY.fonts[v].stack : `${v}${f.unit ?? ""}`;
		document.documentElement.style.setProperty(name, val);
	}
	function applyAll(vals) {
		for (const f of TY.fields) applyVar(f.key, vals[f.key]);
		const px = Math.round(16 * (vals.fs_root_pct / 100) * 10) / 10;
		const cur = ty.querySelector(".ve-ty-cur");
		if (cur)
			cur.textContent =
				`当前：1rem = ${px}px・正文 ${vals.lh_body} 行距・版心 ${vals.wrap_max_px}px`;
	}

	async function tyOpen() {
		if (!TY) {
			try {
				TY = await (await fetch("/api/theme")).json();
			} catch (e) {
				ty.hidden = false;
				tySay("读不到版式配置：" + e.message, false);
				return;
			}
			const rows = TY.fields
				.map((f) => {
					const v = TY.theme[f.key];
					if (f.kind === "font") {
						const opts = Object.entries(TY.fonts)
							.map(
								([k, o]) =>
									`<option value="${esc(k)}"${k === v ? " selected" : ""}>${esc(o.label)}</option>`,
							)
							.join("");
						return `<div class="ve-ty-row"><label>${esc(f.label)}</label><select data-k="${esc(f.key)}">${opts}</select></div>`;
					}
					const shown = f.display ?? f.unit ?? "";
					return `<div class="ve-ty-row"><label>${esc(f.label)}<output data-out="${esc(f.key)}">${v}${esc(shown)}</output></label>
            <input type="range" data-k="${esc(f.key)}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"></div>`;
				})
				.join("");
			ty.innerHTML = `<h4>Aa 版式</h4>
        <span class="ve-sub">拉一下即时预览，不动文字；保存 = 写 theme.json</span>
        ${rows}
        <div class="ve-ty-btns">
          <button class="ve-ty-save">💾 保存版式</button>
          <button class="ve-ty-reset">↺ 默认</button>
          <button class="ve-ty-pub">🚀 发布</button>
          <button class="ve-ty-close">✕</button>
        </div>
        <div class="ve-ty-msg"></div>
        <div class="ve-ty-cur"></div>`;
			const vals = () => {
				const o = {};
				ty.querySelectorAll("[data-k]").forEach((el) => {
					const f = TY.fields.find((x) => x.key === el.dataset.k);
					o[el.dataset.k] =
						f.kind === "font" ? el.value : Math.round(Number(el.value) * 100) / 100;
				});
				return o;
			};
			ty.addEventListener("input", (e) => {
				const k = e.target.dataset?.k;
				if (!k) return;
				dirty = true;
				const f = TY.fields.find((x) => x.key === k);
				const v = f.kind === "font" ? e.target.value : Number(e.target.value);
				applyVar(k, v);
				const out = ty.querySelector(`[data-out="${k}"]`);
				if (out) out.textContent = v + (f.display ?? f.unit ?? "");
				applyAll(vals());
			});
			ty.querySelector(".ve-ty-close").onclick = () => {
				if (dirty && !confirm("未保存的版式调整会丢失，确定关闭？")) return;
				ty.hidden = true;
				location.reload(); // 还原预览，去掉临时变量
			};
			ty.querySelector(".ve-ty-save").onclick = async (e) => {
				const b = e.currentTarget;
				b.disabled = true;
				b.textContent = "保存中…";
				try {
					const r = await fetch("/api/theme", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ values: vals() }),
					});
					const d = await r.json();
					if (!d.ok) throw new Error(d.error || "save fail");
					dirty = false;
					TY.theme = d.theme;
					tySay("✓ 已保存到 theme.json，并重生 css/theme.css——点 🚀 发布才上线", true);
				} catch (err) {
					tySay("保存失败: " + err.message, false);
				}
				b.disabled = false;
				b.textContent = "💾 保存版式";
			};
			ty.querySelector(".ve-ty-reset").onclick = async (e) => {
				const b = e.currentTarget;
				b.disabled = true;
				try {
					const r = await fetch("/api/theme", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ reset: true }),
					});
					const d = await r.json();
					if (!d.ok) throw new Error(d.error || "reset fail");
					dirty = false;
					location.reload();
				} catch (err) {
					tySay("还原失败: " + err.message, false);
					b.disabled = false;
				}
			};
			ty.querySelector(".ve-ty-pub").onclick = (e) => {
				if (dirty) {
					tySay("版式改动还未保存 → 先点 💾 保存版式，再点 🚀 发布", false);
					return;
				}
				publish(e.currentTarget, (t, ok) => tySay(t, ok));
			};
		}
		applyAll(TY.theme);
		ty.hidden = false;
	}
	tyBtn.onclick = tyOpen;

	// 顶部悬浮徽标（编辑中提示所在区块不可点）
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			if (!ty.hidden) {
				ty.hidden = true;
				location.reload();
			} else if (on) end();
		}
	});
})();
