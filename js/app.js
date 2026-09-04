/* =====================================================================
   Shuhan WANG — 个人主页交互脚本
   功能清单：
   1. 主题切换（浅色/深色，记忆在 localStorage，跟随系统初始值）
   2. 顶部阅读进度条 + 导航高亮当前区块
   3. 滚动显现动画（IntersectionObserver）
   4. 论文筛选（All / R&R / Working Papers / Competition）
   5. 点击标题展开/收起摘要
   6. 复制邮箱（带 toast 提示）
   7. 数据计数动画（GPA、论文数等）
   8. 回到顶部按钮
   9. 移动端菜单
   ===================================================================== */

(function () {
  "use strict";

  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const on = (el, ev, fn, opts) => el.addEventListener(ev, fn, opts);

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
    themeBtn.title = t === "dark" ? "切换到浅色" : "切换到深色";
    localStorage.setItem("theme", t);
  }
  applyTheme(theme);
  on(themeBtn, "click", () => applyTheme(theme === "dark" ? "light" : "dark"));

  /* ---------- 2. 进度条 + 导航高亮 ---------- */
  const bar = $("#progressBar");
  const sections = $$("main section[id]");
  const navMap = new Map($$(".nav-links a[data-nav]").map((a) => [a.dataset.nav, a]));

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
    { rootMargin: "-40% 0px -55% 0px" }
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
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  /* ---------- 4. 论文筛选 ---------- */
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
    })
  );

  /* ---------- 5. 研究卡：展开/收起（正文或摘要） ---------- */
  $$(".title[data-expand]").forEach((title) =>
    on(title, "click", (e) => {
      const paper = title.closest(".paper");
      const target = paper && (paper.querySelector(".study-body") || paper.querySelector(".abstract"));
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
    })
  );

  /* ---------- 6. 复制邮箱 ---------- */
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

  /* ---------- 7. 计数动画 ---------- */
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
    { threshold: 0.6 }
  );
  nums.forEach((n) => countObs.observe(n));

  /* ---------- 8. 回到顶部 ---------- */
  on($("#toTop"), "click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* ---------- 9. 移动端菜单 ---------- */
  const navLinks = $("#navLinks");
  const menuBtn = $("#menuToggle");
  on(menuBtn, "click", () => navLinks.classList.toggle("open"));
  on(navLinks, "click", (e) => {
    if (e.target.tagName === "A") navLinks.classList.remove("open");
  });
  on(document, "keydown", (e) => {
    if (e.key === "Escape") navLinks.classList.remove("open");
  });

  /* ---------- 页脚年份 ---------- */
  const yr = $("#year");
  if (yr) yr.textContent = new Date().getFullYear();
})();
