/* UnitFlow — Crash Cart Checks (LocalStorage, PHI-free)
   - Real-label style sticker (Providence Holy Cross, orange)
   - iPhone camera photo via file input
   - CSV export
   - Export selected rows as clean HTML table in new tab
   - Print sticker (matches label style)
*/

const LS_KEYS = {
  LOGS: "unitflow_crashcart_logs_v1",
  TECH: "unitflow_tech_name_v1",
};

const $ = (id) => document.getElementById(id);

const screenForm = $("screenForm");
const screenHistory = $("screenHistory");

const logForm = $("logForm");

// Form inputs
const techName = $("techName");
const cartId = $("cartId");
const firstExpire = $("firstExpire");
const expDate = $("expDate");
const lockNumber = $("lockNumber");
const notes = $("notes");

// Photo
const cartPhoto = $("cartPhoto");
const photoPreviewWrap = $("photoPreviewWrap");
const photoPreview = $("photoPreview");
const removePhotoBtn = $("removePhotoBtn");
let pendingPhotoDataUrl = "";

// Sticker (real label)
const stickerPreview = $("stickerPreview");
const printStickerBtn = $("printStickerBtn");

const stFirstExpire = $("stFirstExpire");
const stExpDate = $("stExpDate");
const stCheckDate = $("stCheckDate");
const stTech = $("stTech");
const stLock = $("stLock");
const stCart = $("stCart");

// History
const goHistoryBtn = $("goHistoryBtn");
const goFormBtn = $("goFormBtn");
const historyTbody = $("historyTbody");
const filterText = $("filterText");
const detail = $("detail");

const exportCsvBtn = $("exportCsvBtn");
const exportHtmlBtn = $("exportHtmlBtn");
const clearAllBtn = $("clearAllBtn");

init();

function init() {
  const savedTech = localStorage.getItem(LS_KEYS.TECH);
  if (savedTech) techName.value = savedTech;

  [techName, cartId, firstExpire, expDate, lockNumber].forEach((el) => {
    el.addEventListener("input", updateStickerFromForm);
    el.addEventListener("change", updateStickerFromForm);
  });

  cartPhoto.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const maxMB = 2;
    if (file.size > maxMB * 1024 * 1024) {
      alert(`Photo too large. Keep it under ${maxMB}MB.`);
      cartPhoto.value = "";
      return;
    }

    pendingPhotoDataUrl = await fileToDataURL(file);
    photoPreview.src = pendingPhotoDataUrl;
    photoPreviewWrap.style.display = "block";
  });

  removePhotoBtn.addEventListener("click", () => {
    pendingPhotoDataUrl = "";
    cartPhoto.value = "";
    photoPreviewWrap.style.display = "none";
    photoPreview.src = "";
  });

  logForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveEntry();
  });

  goHistoryBtn.addEventListener("click", showHistory);
  goFormBtn.addEventListener("click", showForm);

  filterText.addEventListener("input", renderHistory);
  exportCsvBtn.addEventListener("click", exportCSV);
  exportHtmlBtn.addEventListener("click", exportSelectedHTMLTable);
  clearAllBtn.addEventListener("click", clearAll);

  printStickerBtn.addEventListener("click", () => {
    updateStickerFromForm(true);
    printSticker();
  });

  updateStickerFromForm(false);
}

function showForm() {
  screenHistory.style.display = "none";
  screenForm.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHistory() {
  screenForm.style.display = "none";
  screenHistory.style.display = "block";
  renderHistory();
  detail.style.display = "none";
  detail.innerHTML = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateStickerFromForm(forceShow = false) {
  const tech = (techName.value || "").trim();
  const cart = (cartId.value || "").trim();
  const first = (firstExpire.value || "").trim();
  const exp = expDate.value ? formatDate(expDate.value) : "";
  const lock = (lockNumber.value || "").trim();

  stFirstExpire.textContent = first || "—";
  stExpDate.textContent = exp || "—";
  stTech.textContent = tech || "—";
  stLock.textContent = lock || "—";
  stCart.textContent = cart || "—";
  stCheckDate.textContent = new Date().toLocaleString();

  const shouldShow =
    forceShow ||
    tech.length > 0 ||
    cart.length > 0 ||
    first.length > 0 ||
    exp.length > 0 ||
    lock.length > 0;

  stickerPreview.style.display = shouldShow ? "block" : "none";
}

function saveEntry() {
  const tech = techName.value.trim();
  const cart = cartId.value.trim();
  const first = firstExpire.value.trim();
  const expRaw = expDate.value;
  const lock = lockNumber.value.trim();
  const note = notes.value.trim();

  if (!tech || !cart || !first || !expRaw) {
    alert("Please complete: Your name, Cart, First supply to expire, and Expiration date.");
    return;
  }

  localStorage.setItem(LS_KEYS.TECH, tech);

  const now = new Date();
  const entry = {
    id: cryptoRandomId(),
    createdAt: now.toISOString(),
    techName: tech,
    cartId: cart,
    firstExpire: first,
    expDate: expRaw,
    lockNumber: lock,
    notes: note,
    photoDataUrl: pendingPhotoDataUrl || "",
  };

  const logs = loadLogs();
  logs.unshift(entry);
  saveLogs(logs);

  logForm.reset();
  techName.value = tech;

  pendingPhotoDataUrl = "";
  cartPhoto.value = "";
  photoPreviewWrap.style.display = "none";
  photoPreview.src = "";

  updateStickerFromForm(false);

  alert("Saved.");
  showHistory();
}

function renderHistory() {
  const logs = loadLogs();
  const q = (filterText.value || "").trim().toLowerCase();

  const filtered = q
    ? logs.filter((x) => (x.cartId || "").toLowerCase().includes(q))
    : logs;

  historyTbody.innerHTML = "";

  if (filtered.length === 0) {
    historyTbody.innerHTML = `<tr><td colspan="6" class="muted" style="padding:14px;">No entries yet.</td></tr>`;
    return;
  }

  for (const entry of filtered) {
    const tr = document.createElement("tr");

    const cbTd = document.createElement("td");
    cbTd.innerHTML = `<input type="checkbox" class="rowSelect" data-id="${escapeHtml(entry.id)}" />`;
    tr.appendChild(cbTd);

    tr.appendChild(tdText(new Date(entry.createdAt).toLocaleString()));
    tr.appendChild(tdText(entry.cartId || ""));
    tr.appendChild(tdText(entry.firstExpire || ""));
    tr.appendChild(tdText(entry.expDate ? formatDate(entry.expDate) : ""));
    tr.appendChild(tdText(entry.techName || ""));

    tr.style.cursor = "pointer";
    tr.addEventListener("click", (e) => {
      if (e.target && e.target.classList && e.target.classList.contains("rowSelect")) return;
      showDetail(entry.id);
    });

    historyTbody.appendChild(tr);
  }
}

function showDetail(id) {
  const logs = loadLogs();
  const entry = logs.find((x) => x.id === id);
  if (!entry) return;

  detail.style.display = "block";

  const expNice = entry.expDate ? formatDate(entry.expDate) : "";
  const createdNice = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "";

  detail.innerHTML = `
    <h2>Crash Cart Check</h2>
    <div class="kv"><div class="k">Date</div><div class="v">${escapeHtml(createdNice)}</div></div>
    <div class="kv"><div class="k">Cart</div><div class="v">${escapeHtml(entry.cartId || "")}</div></div>
    <div class="kv"><div class="k">First to expire</div><div class="v">${escapeHtml(entry.firstExpire || "")}</div></div>
    <div class="kv"><div class="k">Exp date</div><div class="v">${escapeHtml(expNice)}</div></div>
    <div class="kv"><div class="k">Lock #</div><div class="v">${escapeHtml(entry.lockNumber || "—")}</div></div>
    <div class="kv"><div class="k">Tech</div><div class="v">${escapeHtml(entry.techName || "")}</div></div>
    <div class="kv"><div class="k">Notes</div><div class="v">${escapeHtml(entry.notes || "—")}</div></div>

    <div class="row" style="margin-top:10px;">
      <button class="btn" type="button" id="detailPrintSticker">Print Sticker</button>
    </div>

    ${entry.photoDataUrl ? `<img src="${entry.photoDataUrl}" alt="Crash cart photo" />` : `<div class="muted" style="margin-top:10px;">No photo attached.</div>`}
  `;

  $("detailPrintSticker").addEventListener("click", () => printStickerFromEntry(entry));
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function printSticker() {
  const stickerEl = document.querySelector("#stickerPreview .labelSticker");
  if (!stickerEl) return alert("Sticker preview not available yet.");
  printHtmlDocument(stickerEl.outerHTML);
}

function printStickerFromEntry(entry) {
  const expNice = entry.expDate ? formatDate(entry.expDate) : "—";
  const checkNice = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—";

  const html = `
    <div class="labelSticker">
      <div class="labelTop">
        <div class="labelMeta">
          <div class="labelFacility">Providence Holy Cross</div>
          <div class="labelDept">Central Department</div>
          <div class="labelPhone">818-496-1190</div>
        </div>
      </div>

      <div class="labelTitle">CRASH CART CHECK</div>

      <div class="labelRow">
        <div class="labelKey">First supply to expire:</div>
        <div class="labelVal">${escapeHtml(entry.firstExpire || "—")}</div>
      </div>

      <div class="labelRow">
        <div class="labelKey">Exp date:</div>
        <div class="labelVal">${escapeHtml(expNice)}</div>
      </div>

      <div class="labelRow">
        <div class="labelKey">Check date done:</div>
        <div class="labelVal">${escapeHtml(checkNice)}</div>
      </div>

      <div class="labelRow">
        <div class="labelKey">CS tech:</div>
        <div class="labelVal">${escapeHtml(entry.techName || "—")}</div>
      </div>

      <div class="labelRow">
        <div class="labelKey">Lock #:</div>
        <div class="labelVal">${escapeHtml(entry.lockNumber || "—")}</div>
      </div>

      <div class="labelRow">
        <div class="labelKey">Cart:</div>
        <div class="labelVal">${escapeHtml(entry.cartId || "—")}</div>
      </div>

      <div class="labelFoot">PHI-free log • No patient identifiers</div>
    </div>
  `;

  printHtmlDocument(html);
}

function exportCSV() {
  const logs = loadLogs();
  if (logs.length === 0) return alert("No logs to export.");

  const header = ["createdAt","cartId","firstExpire","expDate","lockNumber","techName","notes","hasPhoto"];
  const rows = logs.map((x) => ([
    x.createdAt || "",
    x.cartId || "",
    x.firstExpire || "",
    x.expDate || "",
    x.lockNumber || "",
    x.techName || "",
    (x.notes || "").replace(/\n/g," "),
    x.photoDataUrl ? "yes" : "no",
  ]));

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `crash_cart_checks_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportSelectedHTMLTable() {
  const logs = loadLogs();
  const checked = Array.from(document.querySelectorAll(".rowSelect"))
    .filter((cb) => cb.checked)
    .map((cb) => cb.getAttribute("data-id"));

  const selected = logs.filter((x) => checked.includes(x.id));
  if (selected.length === 0) return alert("Select at least one row using the checkbox column.");

  const rows = selected.map((x) => ({
    Date: x.createdAt ? new Date(x.createdAt).toLocaleString() : "",
    Cart: x.cartId || "",
    "First to expire": x.firstExpire || "",
    "Exp date": x.expDate ? formatDate(x.expDate) : "",
    "Lock #": x.lockNumber || "",
    Tech: x.techName || "",
    Notes: x.notes || "",
    Photo: x.photoDataUrl ? "Yes" : "No",
  }));

  const tableHtml = buildCleanTable(rows);
  const title = `Crash Cart Checks (${selected.length})`;

  const doc = `
    <!doctype html><html><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}
        h1{font-size:18px;margin:0 0 12px}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #ccc;padding:8px;font-size:12px;vertical-align:top}
        th{background:#f3f3f3;text-align:left}
        .muted{color:#666;font-size:12px;margin-top:10px}
      </style>
    </head><body>
      <h1>${escapeHtml(title)}</h1>
      ${tableHtml}
      <div class="muted">PHI-free export • Generated ${escapeHtml(new Date().toLocaleString())}</div>
    </body></html>
  `;

  const win = window.open("", "_blank");
  if (!win) return alert("Popup blocked. Allow popups to export table.");
  win.document.open();
  win.document.write(doc);
  win.document.close();
}

function clearAll() {
  if (!confirm("Clear ALL crash cart logs on this device? This cannot be undone.")) return;
  localStorage.removeItem(LS_KEYS.LOGS);
  renderHistory();
  detail.style.display = "none";
  detail.innerHTML = "";
}

function loadLogs() {
  try {
    const raw = localStorage.getItem(LS_KEYS.LOGS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveLogs(logs) {
  localStorage.setItem(LS_KEYS.LOGS, JSON.stringify(logs));
}

/* Helpers */
function tdText(text) { const td=document.createElement("td"); td.textContent=text; return td; }

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatDate(yyyyMmDd) {
  const [y,m,d] = String(yyyyMmDd).split("-").map(Number);
  if (!y || !m || !d) return String(yyyyMmDd);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function buildCleanTable(rows) {
  const cols = Object.keys(rows[0] || {});
  const thead = `<thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${escapeHtml(r[c])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function cryptoRandomId() {
  if (crypto && crypto.getRandomValues) {
    const a = new Uint32Array(3);
    crypto.getRandomValues(a);
    return Array.from(a).map(n => n.toString(16)).join("-");
  }
  return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function printHtmlDocument(innerHtml) {
  // Print with the same label styling (no external CSS)
  const css = `
    <style>
      :root{ --labelOrange:#ff7a00; --labelInk:#0b0c10; }
      body{margin:24px;font-family:Arial,Helvetica,sans-serif}
      .labelSticker{
        width:100%;max-width:560px;
        background:linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,0) 42%), var(--labelOrange);
        color:var(--labelInk);
        border:3px solid #111;border-radius:10px;padding:12px 12px 10px;
        box-shadow:0 12px 22px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.20);
        position:relative; overflow:hidden;
      }
      .labelSticker::after{
        content:""; position:absolute; inset:0;
        background:repeating-linear-gradient(45deg, rgba(255,255,255,.10), rgba(255,255,255,.10) 6px, rgba(255,255,255,0) 6px, rgba(255,255,255,0) 14px);
        opacity:.10; pointer-events:none;
      }
      .labelTop{position:relative; z-index:1; display:flex; justify-content:space-between; margin-bottom:6px;}
      .labelMeta{font-size:12px; line-height:1.15; font-weight:800;}
      .labelFacility{font-size:13px; letter-spacing:.2px; font-weight:900;}
      .labelDept,.labelPhone{opacity:.92; font-weight:800; margin-top:2px;}
      .labelTitle{position:relative; z-index:1; text-align:center; font-weight:900; letter-spacing:.8px; font-size:22px; margin:6px 0 10px; text-transform:uppercase;}
      .labelRow{position:relative; z-index:1; display:flex; gap:10px; align-items:baseline; margin:9px 0;}
      .labelKey{width:175px; font-size:13px; font-weight:800;}
      .labelVal{
        flex:1; font-size:14px; font-weight:900; padding-bottom:2px;
        border-bottom:2px solid rgba(0,0,0,.55);
        border-radius:6px; padding-left:6px;
        background:linear-gradient(to bottom, rgba(255,255,255,.08), rgba(255,255,255,0));
      }
      .labelFoot{position:relative; z-index:1; margin-top:10px; font-size:11px; font-weight:800; opacity:.92; text-align:center; padding-top:6px; border-top:1px solid rgba(0,0,0,.18);}
    </style>
  `;

  const win = window.open("", "_blank");
  if (!win) return alert("Popup blocked. Allow popups to print.");
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" />${css}</head><body>${innerHtml}<script>window.onload=()=>window.print();<\/script></body></html>`);
  win.document.close();
}
