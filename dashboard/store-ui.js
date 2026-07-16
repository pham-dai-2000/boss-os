/* Cửa hàng Premium — client UI. Gọi các route /store/* (server/store_client.py).
   Luồng: xem danh mục -> Mua -> QR SePay -> poll -> license lưu -> Cài/Cập nhật. */
(function () {
  "use strict";

  const esc = (s) => (s || "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtVnd = (n) => (n || 0).toLocaleString("vi-VN") + "đ";

  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (!r.ok) {
      let msg;
      try { msg = (await r.json()).detail; } catch (e) { msg = r.statusText; }
      throw new Error(msg || ("HTTP " + r.status));
    }
    return r.json();
  }

  const _state = { packs: [], status: null };
  let _pollTimer = null;

  let _css = false;
  function injectCss() {
    if (_css) return; _css = true;
    const css = `
    .store-wrap{max-width:920px}
    .store-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:22px}
    .store-h{font-size:22px;font-weight:800;margin:0}
    .store-sub{color:var(--text2,#a8a294);font-size:14px;margin-top:4px}
    .store-paste{background:transparent;border:1px solid var(--border,rgba(242,240,232,.18));color:var(--text2,#a8a294);
      border-radius:10px;padding:9px 15px;font:inherit;font-size:13.5px;cursor:pointer}
    .store-paste:hover{border-color:var(--accent,#e8a85c);color:var(--text,#f2f0e8)}
    .store-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .store-card{background:var(--bg3,#1c1a2a);border:1px solid var(--border,rgba(242,240,232,.13));
      border-radius:15px;padding:20px;display:flex;flex-direction:column;gap:8px}
    .sc-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
    .sc-name{font-size:16.5px;font-weight:800;color:var(--text,#f2f0e8)}
    .sc-price{font-size:14px;font-weight:700;color:var(--accent,#e8a85c);white-space:nowrap}
    .sc-title{font-size:13.5px;color:var(--text2,#a8a294);line-height:1.5}
    .sc-ver{font-size:12px;color:var(--text2,#a8a294);opacity:.75}
    .sc-change{font-size:13px;color:var(--text2,#a8a294);line-height:1.5;flex:1}
    .sc-actions{margin-top:6px}
    .sc-btn{width:100%;border:0;border-radius:10px;padding:11px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;transition:filter .15s}
    .sc-btn:hover{filter:brightness(1.08)}
    .sc-btn.buy{background:linear-gradient(135deg,var(--accent,#e8a85c),#d1904a);color:#1a1420}
    .sc-btn.install{background:linear-gradient(135deg,var(--accent2,#9b7bd8),#6d4bb8);color:#fff}
    .sc-btn.update{background:linear-gradient(135deg,var(--accent2,#9b7bd8),#6d4bb8);color:#fff}
    .sc-btn.installed{background:transparent;border:1px solid rgba(111,186,111,.5);color:#7fce7f;cursor:default}
    .sc-btn:disabled{opacity:.6;cursor:wait}
    .store-loading,.store-err{color:var(--text2,#a8a294);padding:26px 0;font-size:15px}
    .store-err span{display:block;font-size:13px;opacity:.7;margin-top:6px}

    .store-modal{position:fixed;inset:0;background:rgba(5,5,11,.7);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px}
    .sm-box{background:var(--bg2,#15131f);border:1px solid var(--border,rgba(242,240,232,.15));
      border-radius:16px;padding:24px;width:min(400px,94vw);position:relative;max-height:90vh;overflow:auto}
    .sm-x{position:absolute;top:12px;right:14px;background:none;border:0;color:var(--text2,#a8a294);font-size:18px;cursor:pointer}
    .sm-title{font-size:17px;font-weight:800;padding-right:24px}
    .sm-price{color:var(--accent,#e8a85c);font-weight:700;font-size:14px;margin:4px 0 16px}
    .sm-label{display:block;font-size:13px;color:var(--text2,#a8a294);margin-bottom:6px}
    .sm-email{width:100%;background:var(--bg,#0d0c16);border:1px solid var(--border,rgba(242,240,232,.18));
      border-radius:10px;padding:11px;color:var(--text,#f2f0e8);font:inherit;font-size:14px;margin-bottom:12px}
    .sm-email:focus{outline:0;border-color:var(--accent,#e8a85c)}
    .sm-go{width:100%;background:linear-gradient(135deg,var(--accent,#e8a85c),#d1904a);color:#1a1420;
      border:0;border-radius:10px;padding:12px;font:inherit;font-weight:800;cursor:pointer}
    .sm-body{margin-top:16px}
    .sm-qrwrap{text-align:center;margin-bottom:14px}
    .sm-qr{width:220px;height:220px;border-radius:12px;background:#fff;padding:6px}
    .sm-pay{font-size:14px;color:var(--text,#f2f0e8);line-height:1.7}
    .sm-pay .sm-content{color:var(--accent,#e8a85c)}
    .sm-note{font-size:12.5px;color:var(--text2,#a8a294);margin-top:8px}
    .sm-status{margin-top:14px;padding:11px;border-radius:10px;background:var(--bg3,#1c1a2a);
      text-align:center;font-size:14px;font-weight:600}
    .sm-wait,.sm-err{padding:10px 0;font-size:14px}
    .sm-err{color:#e07b8e}
    .sc-detail{background:transparent;border:0;color:var(--accent2,#9b7bd8);font:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:2px 0;text-align:left;align-self:flex-start}
    .sc-detail:hover{text-decoration:underline}
    .sm-box.detail{width:min(540px,94vw)}
    .detail-body{max-height:56vh;overflow-y:auto;margin:10px 0 16px;padding-right:8px;font-size:14px;line-height:1.7;color:var(--text2,#a8a294)}
    .detail-body h3{color:var(--text,#f2f0e8);margin:16px 0 6px;font-size:15px;font-weight:700}
    .detail-body h3:first-child{margin-top:0}
    .detail-body p{margin:0 0 10px}
    .detail-body ul{margin:6px 0 10px;padding-left:20px}
    .detail-body li{margin:4px 0}
    .detail-body b,.detail-body strong{color:var(--text,#f2f0e8)}
    .detail-foot{border-top:1px solid var(--border,rgba(242,240,232,.13));padding-top:14px}`;
    const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  function packState(p) {
    const st = _state.status || {};
    const inst = (st.installed || {})[p.pack_id];
    const lic = (st.licenses || {})[p.pack_id];
    if (inst) {
      if (String(inst.version) === String(p.version)) return { kind: "installed", label: "✓ Đã cài · v" + inst.version };
      return { kind: "update", label: "Cập nhật lên v" + p.version };
    }
    if (lic) return { kind: "install", label: "Cài đặt" };
    return { kind: "buy", label: "Mua · " + fmtVnd(p.price_vnd) };
  }

  function renderList() {
    const cards = _state.packs.map((p) => {
      const s = packState(p);
      const dis = s.kind === "installed" ? "disabled" : "";
      return `<div class="store-card">
        <div class="sc-top"><div class="sc-name">${esc(p.name)}</div><div class="sc-price">${fmtVnd(p.price_vnd)}</div></div>
        <div class="sc-title">${esc(p.title || "")}</div>
        <div class="sc-ver">v${esc(p.version)} · cần Core ≥ ${esc(p.min_core_version || "?")}</div>
        <div class="sc-change">${esc(p.changelog || "")}</div>
        <button class="sc-detail" data-detail="${esc(p.pack_id)}">Xem chi tiết →</button>
        <div class="sc-actions">
          <button class="sc-btn ${s.kind}" data-act="${s.kind}" data-pack="${esc(p.pack_id)}" data-ver="${esc(p.version)}" ${dis}>${esc(s.label)}</button>
        </div>
      </div>`;
    }).join("");
    return `<div class="store-wrap">
      <div class="store-head">
        <div><h2 class="store-h">Cửa hàng tính năng</h2>
        <div class="store-sub">Mua đứt theo phiên bản · dùng mãi mãi · thanh toán VietQR</div></div>
        <button class="store-paste" data-act="paste">Dán license</button>
      </div>
      <div class="store-grid">${cards || '<div class="store-err">Chưa có gói nào.</div>'}</div>
    </div>`;
  }

  function bind(el) {
    el.querySelectorAll(".sc-btn").forEach((b) => b.addEventListener("click", onAction));
    el.querySelectorAll(".sc-detail").forEach((b) =>
      b.addEventListener("click", (e) => openDetail(e.currentTarget.dataset.detail)));
    const paste = el.querySelector(".store-paste");
    if (paste) paste.addEventListener("click", onPaste);
  }

  function onAction(e) {
    const b = e.currentTarget;
    const kind = b.dataset.act;
    if (kind === "buy") return openBuy(b.dataset.pack, b.dataset.ver);
    if (kind === "install" || kind === "update") return doInstall(b.dataset.pack, b);
  }

  async function installFlow(pack) {
    await api("/store/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack_id: pack }) });
    await refresh();
  }

  async function doInstall(pack, btn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = "Đang cài…";
    try { await installFlow(pack); }
    catch (e) { alert("Cài lỗi: " + e.message); btn.disabled = false; btn.textContent = old; }
  }

  // Popup mô tả chi tiết (nội dung details.html từ Store — nguồn tin cậy của Sếp)
  function openDetail(pack) {
    const p = _state.packs.find((x) => x.pack_id === pack) || {};
    const s = packState(p);
    const content = (p.details && p.details.trim())
      ? p.details
      : `<p>${esc(p.changelog || "Chưa có mô tả chi tiết.")}</p>`;
    const footBtn = s.kind === "installed"
      ? `<button class="sc-btn installed" disabled>${esc(s.label)}</button>`
      : `<button class="sc-btn ${s.kind}" data-act="${s.kind}">${esc(s.label)}</button>`;
    const modal = document.createElement("div"); modal.className = "store-modal";
    modal.innerHTML = `<div class="sm-box detail">
      <button class="sm-x">✕</button>
      <div class="sm-title">${esc(p.name)}</div>
      <div class="sm-price">${fmtVnd(p.price_vnd)} · v${esc(p.version)}</div>
      <div class="detail-body">${content}</div>
      <div class="detail-foot">${footBtn}</div>
    </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector(".sm-x").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    const fb = modal.querySelector(".detail-foot .sc-btn");
    if (fb && !fb.disabled) fb.addEventListener("click", async () => {
      const kind = fb.dataset.act;
      if (kind === "buy") { close(); return openBuy(p.pack_id, p.version); }
      fb.disabled = true; fb.textContent = "Đang cài…";
      try { await installFlow(p.pack_id); close(); }
      catch (e) { alert("Cài lỗi: " + e.message); fb.disabled = false; }
    });
  }

  function openBuy(pack, ver) {
    const p = _state.packs.find((x) => x.pack_id === pack) || {};
    const modal = document.createElement("div"); modal.className = "store-modal";
    modal.innerHTML = `<div class="sm-box">
      <button class="sm-x">✕</button>
      <div class="sm-title">Mua: ${esc(p.name)}</div>
      <div class="sm-price">${fmtVnd(p.price_vnd)} · v${esc(ver)}</div>
      <label class="sm-label">Email nhận license</label>
      <input class="sm-email" type="email" placeholder="email@cuaban.com">
      <button class="sm-go">Tạo mã thanh toán</button>
      <div class="sm-body"></div>
    </div>`;
    document.body.appendChild(modal);
    const close = () => { if (_pollTimer) clearInterval(_pollTimer); modal.remove(); };
    modal.querySelector(".sm-x").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    modal.querySelector(".sm-go").addEventListener("click", () => startCheckout(modal, pack, ver));
    modal.querySelector(".sm-email").focus();
  }

  async function startCheckout(modal, pack, ver) {
    const email = modal.querySelector(".sm-email").value.trim();
    if (!email) { modal.querySelector(".sm-email").focus(); return; }
    const body = modal.querySelector(".sm-body");
    const goBtn = modal.querySelector(".sm-go"); goBtn.disabled = true;
    body.innerHTML = `<div class="sm-wait">Đang tạo đơn…</div>`;
    let co;
    try {
      co = await api("/store/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack_id: pack, version: ver, buyer: email }) });
    } catch (e) { body.innerHTML = `<div class="sm-err">${esc(e.message)}</div>`; goBtn.disabled = false; return; }

    goBtn.style.display = "none";
    body.innerHTML = `
      <div class="sm-qrwrap"><img class="sm-qr" src="${esc(co.qr_url)}" alt="QR thanh toán"></div>
      <div class="sm-pay">
        <div>Chuyển <b>${fmtVnd(co.amount)}</b> tới <b>${esc(co.bank)} ${esc(co.account)}</b></div>
        <div>Nội dung: <b class="sm-content">${esc(co.transfer_content)}</b></div>
        <div class="sm-note">Quét QR bằng app ngân hàng, GIỮ NGUYÊN nội dung chuyển khoản để hệ thống tự khớp đơn.</div>
      </div>
      <div class="sm-status">⏳ Đang chờ thanh toán…</div>`;
    const statusEl = body.querySelector(".sm-status");
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(async () => {
      try {
        const r = await api("/store/poll?order_id=" + encodeURIComponent(co.order_id));
        if (r.status === "paid") {
          clearInterval(_pollTimer);
          statusEl.textContent = "✅ Đã thanh toán! License đã lưu.";
          setTimeout(async () => { modal.remove(); await refresh(); }, 1200);
        }
      } catch (e) { /* im lặng, poll tiếp */ }
    }, 3000);
  }

  function onPaste() {
    const token = prompt("Dán chuỗi license bạn nhận được:");
    if (!token) return;
    api("/store/license", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ license: token.trim() }) })
      .then(() => refresh())
      .catch((e) => alert("License không hợp lệ: " + e.message));
  }

  async function refresh() {
    const el = document.getElementById("cviewBody");
    if (!el) return;
    try {
      const [packs, status] = await Promise.all([api("/store/packs"), api("/store/status")]);
      _state.packs = packs.packs || []; _state.status = status;
      el.innerHTML = renderList(); bind(el);
    } catch (e) {
      el.innerHTML = `<div class="store-wrap"><div class="store-err">Không tải được Cửa hàng: ${esc(e.message)}</div></div>`;
    }
  }

  async function render(el) {
    injectCss();
    el.innerHTML = `<div class="store-wrap"><div class="store-loading">Đang tải Cửa hàng…</div></div>`;
    let packs, status;
    try {
      [packs, status] = await Promise.all([api("/store/packs"), api("/store/status")]);
    } catch (e) {
      el.innerHTML = `<div class="store-wrap"><div class="store-err">Không kết nối được Cửa hàng: ${esc(e.message)}<span>Kiểm tra Store server có đang chạy không.</span></div></div>`;
      return;
    }
    _state.packs = packs.packs || []; _state.status = status;
    el.innerHTML = renderList(); bind(el);
  }

  window.BossStore = { render };
})();
