/* =====================================================================
   Shuhan WANG — personal homepage interactions
   1. Theme toggle (light/dark; persisted in localStorage; follows system by default)
   2. Reading progress bar + active-section nav highlight
   3. Scroll-reveal animations (IntersectionObserver)
   4. Paper filtering (All / R&R / Working Paper / Competition)
   5. Click title to expand/collapse a study panel or abstract
   6. Copy email to clipboard (with toast)
   7. Animated counters (GPA, paper counts, …)
   8. Back-to-top button
   9. Mobile menu
   ===================================================================== */

(function () {
  "use strict";

  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const on = (el, ev, fn, opts) => el.addEventListener(ev, fn, opts);

  /* ---------- 0. 语言切换 (EN / 中文) ---------- */
  const langBtn = $("#langToggle");
  // 默认永远英文：只有 ?lang=zh 或本标签页里刚切过中文才显示中文。
  // 以前用 localStorage 永久记住，谁误点一次「中文」，之后每次打开都是中文。
  const normLang = (l) => (l === "zh" || l === "en" ? l : null);
  let lang =
    normLang(new URLSearchParams(location.search).get("lang")) ||
    normLang(sessionStorage.getItem("lang")) ||
    "en";
  try {
    localStorage.removeItem("lang"); // 抹掉历史残留
  } catch {}
  function setYear() {
    const y = $("#year");
    if (y) y.textContent = new Date().getFullYear();
  }
  function applyLang(l) {
    lang = l;
    document.documentElement.setAttribute("lang", l);
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (l === "zh") {
        if (el.dataset.enHtml === undefined) el.dataset.enHtml = el.innerHTML;
        const t = (window.I18N_ZH || {})[el.dataset.i18n];
        el.innerHTML = t !== undefined ? t : el.dataset.enHtml;
      } else if (el.dataset.enHtml !== undefined) {
        el.innerHTML = el.dataset.enHtml;
      }
    });
    document.title =
      l === "zh"
        ? "Shuhan WANG｜研究主页"
        : "Shuhan WANG | Research — Agglomeration, Place-Based Policy & Generative AI";
    if (langBtn) langBtn.textContent = l === "zh" ? "EN" : "中文";
    setYear();
    try {
      sessionStorage.setItem("lang", l); // 只在当前标签页内记住
    } catch {}
  }
  applyLang(lang);
  if (langBtn)
    on(langBtn, "click", () => applyLang(lang === "zh" ? "en" : "zh"));

  /* ---------- 1. 主题切换 ---------- */
  const root = document.documentElement;
  const themeBtn = $("#themeToggle");
  const saved = localStorage.getItem("theme");
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  let theme = saved || (sysDark ? "dark" : "light");

  function applyTheme(t) {
    theme = t;
    root.setAttribute("data-theme", t);
    themeBtn.textContent = t === "dark" ? "☀️" : "🌙";
    themeBtn.title =
      t === "dark" ? "Switch to light mode" : "Switch to dark mode";
    localStorage.setItem("theme", t);
  }
  applyTheme(theme);
  on(themeBtn, "click", () => applyTheme(theme === "dark" ? "light" : "dark"));

  /* ---------- 2. 进度条 + 导航高亮 ---------- */
  const bar = $("#progressBar");
  const sections = $$("main section[id]");
  const navMap = new Map(
    $$(".nav-links a[data-nav]").map((a) => [a.dataset.nav, a]),
  );

  function onScroll() {
    const h = document.documentElement;
    const pct = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
    bar.style.width = (pct * 100).toFixed(1) + "%";
    $("#toTop").classList.toggle("show", h.scrollTop > 480);
  }
  on(window, "scroll", onScroll, { passive: true });
  onScroll();

  const secObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          $$(".nav-links a").forEach((a) => a.classList.remove("active"));
          const link = navMap.get(e.target.id);
          if (link) link.classList.add("active");
        }
      });
    },
    { rootMargin: "-40% 0px -55% 0px" },
  );
  sections.forEach((s) => secObs.observe(s));

  /* ---------- 3. 滚动显现 ---------- */
  const revealEls = $$("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  /* ---------- 4. Paper filtering ---------- */
  const papers = $$(".paper");
  const filterBtns = $$(".filter");
  filterBtns.forEach((btn) =>
    on(btn, "click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const f = btn.dataset.filter;
      papers.forEach((p) => {
        const show = f === "all" || (p.dataset.tags || "").includes(f);
        p.style.display = show ? "" : "none";
        if (show) p.classList.add("in"); // 确保重新显示时可见
      });
    }),
  );

  /* ---------- 5. Study cards: expand/collapse body or abstract ---------- */
  $$(".title[data-expand]").forEach((title) =>
    on(title, "click", (e) => {
      const paper = title.closest(".paper");
      const target =
        paper &&
        (paper.querySelector(".study-body") ||
          paper.querySelector(".abstract"));
      if (!target) return;
      if (target.hidden) {
        target.hidden = false;
        paper.classList.add("open");
      } else {
        target.hidden = true;
        paper.classList.remove("open");
      }
      // 标题若是外链（preprint），展开时不跳转；跳转走 p-meta / s-meta 里的链接
      if (title.tagName === "A") e.preventDefault();
    }),
  );

  /* ---------- 6. Copy email ---------- */
  const emailChip = $("#emailChip");
  const toast = $("#toast");
  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 1600);
  }
  if (emailChip) {
    on(emailChip, "click", async (e) => {
      e.preventDefault();
      const mail = emailChip.textContent.replace("✉ ", "").trim();
      try {
        await navigator.clipboard.writeText(mail);
        showToast("Email copied: " + mail);
      } catch {
        showToast(mail); // 剪贴板不可用时至少显示地址
      }
    });
  }

  /* ---------- 7. Count-up animation ---------- */
  const nums = $$(".num[data-count]");
  const countObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        countObs.unobserve(e.target);
        const el = e.target;
        const target = parseFloat(el.dataset.count);
        const dec = parseInt(el.dataset.decimals || "0", 10);
        const suffix = el.dataset.suffix || "";
        const dur = 900;
        const t0 = performance.now();
        (function tick(t) {
          const p = Math.min(1, (t - t0) / dur);
          const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
          el.textContent = (target * eased).toFixed(dec) + suffix;
          if (p < 1) requestAnimationFrame(tick);
          else el.textContent = target.toFixed(dec) + suffix;
        })(t0);
      });
    },
    { threshold: 0.6 },
  );
  nums.forEach((n) => countObs.observe(n));

  /* ---------- 8. Back to top ---------- */
  on($("#toTop"), "click", () =>
    window.scrollTo({ top: 0, behavior: "smooth" }),
  );

  /* ---------- 9. Mobile menu ---------- */
  const navLinks = $("#navLinks");
  const menuBtn = $("#menuToggle");
  on(menuBtn, "click", () => navLinks.classList.toggle("open"));
  on(navLinks, "click", (e) => {
    if (e.target.tagName === "A") navLinks.classList.remove("open");
  });
  on(document, "keydown", (e) => {
    if (e.key === "Escape") navLinks.classList.remove("open");
  });

  /* ---------- 页脚年份（由语言模块的 setYear 维护） ---------- */
})();
