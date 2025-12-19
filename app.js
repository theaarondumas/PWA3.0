/* Wound Vac Tracker (PHI-Free)
   - GitHub Pages (HTTPS) required for camera on iPhone
   - iOS-stable scanner:
       ✅ BarcodeDetector only (NO dynamic imports / NO ZXing)
*/

const STORAGE_KEY = "wvt_logs_v1";
const el = (id) => document.getElementById(id);

let ui = {};

// ---- state ----
let stream = null;
let scanning = false;
let scanTimer = null;
let detector = null;
let startingCamera = false;

// Offscreen capture (more iOS-stable than createImageBitmap(video))
let capCanvas = null;
let capCtx = null;

// ---------- UI binding ----------
function bindUI() {
  ui = {
    securePill: el("securePill"),
    btnStartScan: el("btnStartScan"),
    btnStopScan: el("btnStopScan"),
    video: el("video"),
    scanDot: el("scanDot"),
    scanText: el("scanText"),
    autoLog: el("autoLog"),
    form: el("logForm"),
    unit: el("unit"),
    room: el("room"),
    bed: el("bed"),
    serial: el("serial"),
    btnClear: el("btnClear"),
    btnExport: el("btnExport"),
    btnWipe: el("btnWipe"),
    search: el("search"),
    tbody: el("tbody"),
    kpiTotal: el("kpiTotal"),
    kpiToday: el("kpiToday"),
    kpiUnits: el("kpiUnits"),
  };

  // Minimal required elements
  const requiredEls = [
    ["securePill", ui.securePill],
    ["btnStartScan", ui.btnStartScan],
    ["btnStopScan", ui.btnStopScan],
    ["video", ui.video],
    ["scanDot", ui.scanDot],
    ["scanText", ui.scanText],
    ["logForm", ui.form],
    ["tbody", ui.tbody],
  ];

  const missing = requiredEls.filter(([, node]) => !node).map(([name]) => name);
  if (missing.length) {
    alert("Missing HTML IDs: " + missing.join(", "));
  }
}

// ---------- Utilities ----------
function isHttps() {
  return location.protocol === "https:" || location.hostname === "localhost";
}

function setPill() {
  if (!ui.securePill) return;
  ui.securePill.textContent = isHttps() ? "HTTPS: secure ✅" : "HTTPS: NOT secure ❌";
}

function setScanStatus(kind, text) {
  if (ui.scanDot) {
    ui.scanDot.className = "dot";
    if (kind) ui.scanDot.classList.add(kind);
  }
  if (ui.scanText) ui.scanText.textContent = text;
}

function nowIso() {
  return new Date().toISOString();
}

function prettyTime(iso) {
  return new Date(iso).toLocaleString();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeScanValue(raw) {
  return raw ? String(raw).trim() : "";
}

// ---------- Storage ----------
function loadLogs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLogs(logs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

function addLog(entry) {
  const logs = loadLogs();
  logs.unshift(entry);
  saveLogs(logs);
  render();
}

function deleteLog(id) {
  const logs = loadLogs().filter((x) => x.id !== id);
  saveLogs(logs);
  render();
}

function wipeAll() {
  localStorage.removeItem(STORAGE_KEY);
  render();
}

function toCsv(logs) {
  const header = ["timestamp", "unit", "room", "bed", "serial"];
  const rows = logs.map((l) => [
    l.timestamp,
    l.unit,
    l.room,
    l.bed,
    (l.serial || "").replaceAll('"', '""'),
  ]);
  return [header, ...rows]
    .map((r) => r.map((v) => `"${v ?? ""}"`).join(","))
    .join("\n");
}

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayCount(logs) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return logs.filter((l) => new Date(l.timestamp) >= start).length;
}

function uniqueUnits(logs) {
  const set = new Set(logs.map((l) => (l.unit || "").trim()).filter(Boolean));
  return set.size;
}

// ---------- Rendering ----------
function render() {
  if (!ui.tbody) return;

  const q = (ui.search?.value || "").toLowerCase().trim();
  const logs = loadLogs();

  if (ui.kpiTotal) ui.kpiTotal.textContent = String(logs.length);
  if (ui.kpiToday) ui.kpiToday.textContent = String(todayCount(logs));
  if (ui.kpiUnits) ui.kpiUnits.textContent = String(uniqueUnits(logs));

  const filtered = !q
    ? logs
    : logs.filter((l) => {
        const hay = `${l.unit} ${l.room} ${l.bed} ${l.serial} ${l.timestamp}`.toLowerCase();
        return hay.includes(q);
      });

  ui.tbody.innerHTML = filtered
    .map(
      (l) => `
      <tr>
        <td><span class="badge">${prettyTime(l.timestamp)}</span></td>
        <td>${escapeHtml(l.unit)}</td>
        <td>${escapeHtml(l.room)}</td>
        <td>${escapeHtml(l.bed)}</td>
        <td><b>${escapeHtml(l.serial)}</b></td>
        <td class="actions">
          <button class="btn danger" data-del="${l.id}">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");

  [...ui.tbody.querySelectorAll("button[data-del]")].forEach((btn) => {
    btn.addEventListener("click", () => deleteLog(btn.getAttribute("data-del")));
  });
}

// ---------- Scan success ----------
function successScan(value) {
  const v = normalizeScanValue(value);
  if (!v) {
    setScanStatus("warn", "Scan read empty value—try again.");
    return;
  }

  setScanStatus("good", `Scan successful ✅ (${v})`);
  if (navigator.vibrate) navigator.vibrate(60);

  if (ui.serial) ui.serial.value = v;

  if (ui.autoLog?.checked) {
    const unit = ui.unit?.value.trim() || "";
    const room = ui.room?.value.trim() || "";
    const bed = ui.bed?.value.trim() || "";

    if (unit && room && bed) {
      addLog({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
        timestamp: nowIso(),
        unit,
        room,
        bed,
        serial: v,
      });
      if (ui.serial) ui.serial.value = "";
      setScanStatus("good", "Logged ✅ Ready for next scan.");
    } else {
      setScanStatus("warn", "Scanned ✅ Now enter Unit/Room/Bed to log.");
    }
  }
}

// ---------- Camera control ----------
async function stopCamera() {
  scanning = false;

  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }

  if (ui.video) {
    try { ui.video.pause(); } catch {}
    ui.video.srcObject = null;
  }

  if (stream) {
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
    stream = null;
  }

  ui.btnStartScan && (ui.btnStartScan.disabled = false);
  ui.btnStopScan && (ui.btnStopScan.disabled = true);

  setScanStatus(null, "Idle");
}

async function startCamera() {
  if (startingCamera) return;
  startingCamera = true;

  try {
    if (!isHttps()) {
      alert("Camera requires HTTPS on iPhone. Use your GitHub Pages URL (https://).");
      return;
    }

    // Require native BarcodeDetector for the scanner (stable path)
    if (!("BarcodeDetector" in window)) {
      setScanStatus("bad", "Scanner unavailable on this iPhone (no BarcodeDetector).");
      alert(
        "This iPhone/browser does not support BarcodeDetector.\n\n" +
        "Fix:\n" +
        "• Update iOS\n" +
        "• Use Safari (not in-app browser)\n"
      );
      return;
    }

    setScanStatus("warn", "Requesting camera permission…");

    // Always fully stop first (avoids iOS weird half-open states)
    await stopCamera();

    // Request camera
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });

    // iOS video setup
    ui.video.setAttribute("playsinline", "");
    ui.video.setAttribute("webkit-playsinline", "");
    ui.video.muted = true;
    ui.video.autoplay = true;
    ui.video.srcObject = stream;

    // Give iOS a beat
    await new Promise((res) => setTimeout(res, 150));
    await ui.video.play();

    // Setup detector once
    if (!detector) {
      // Keep formats broad but safe
      const formats = [
        "qr_code",
        "code_128",
        "code_39",
        "ean_13",
        "ean_8",
        "upc_a",
        "upc_e",
        "itf",
        "data_matrix",
        "pdf417",
      ];
      try {
        detector = new BarcodeDetector({ formats });
      } catch {
        detector = new BarcodeDetector(); // fallback: browser picks formats
      }
    }

    // Setup capture canvas
    capCanvas = document.createElement("canvas");
    capCtx = capCanvas.getContext("2d", { willReadFrequently: true });

    scanning = true;
    ui.btnStartScan.disabled = true;
    ui.btnStopScan.disabled = false;

    setScanStatus(null, "Camera running. Point at barcode / QR.");

    beginScanLoop();
  } catch (err) {
    console.error("Camera error:", err);

    const name = err?.name || "UnknownError";
    const msg = err?.message || "";
    const hint =
      name === "NotAllowedError" ? "Permission blocked (Safari settings / Screen Time / MDM)." :
      name === "NotReadableError" ? "Camera is in use by another app. Force-close Camera/FaceTime/Instagram, then retry." :
      name === "AbortError" ? "Safari glitch. Reload or force-close Safari." :
      "Try force-close Safari and reopen.";

    setScanStatus("bad", `Camera error: ${name}`);

    alert(
      "Camera failed.\n\n" +
      "ERROR: " + name + "\n" +
      (msg ? ("MSG: " + msg + "\n") : "") +
      "\n" + hint
    );

    await stopCamera();
  } finally {
    startingCamera = false;
  }
}

// ---------- Scanner loop (BarcodeDetector only) ----------
function beginScanLoop() {
  const tick = async () => {
    if (!scanning) return;

    try {
      // Ensure video has data
      if (!ui.video || ui.video.readyState < 2) {
        scanTimer = setTimeout(tick, 250);
        return;
      }

      const w = ui.video.videoWidth || 0;
      const h = ui.video.videoHeight || 0;

      if (!w || !h) {
        scanTimer = setTimeout(tick, 250);
        return;
      }

      // Scale down for speed/stability
      const targetW = 720;
      const scale = Math.min(1, targetW / w);
      const cw = Math.max(320, Math.floor(w * scale));
      const ch = Math.max(240, Math.floor(h * scale));

      capCanvas.width = cw;
      capCanvas.height = ch;

      capCtx.drawImage(ui.video, 0, 0, cw, ch);

      const codes = await detector.detect(capCanvas);
      if (codes && codes.length) {
        const v = codes[0].rawValue || codes[0].value || "";
        successScan(v);
      }
    } catch (e) {
      // ignore scan frame errors (common on iOS)
    }

    scanTimer = setTimeout(tick, 250);
  };

  tick();
}

// ---------- Init / Events ----------
function init() {
  bindUI();
  setPill();
  render();
  setScanStatus(null, "Idle");

  ui.btnStartScan?.addEventListener("click", startCamera);
  ui.btnStopScan?.addEventListener("click", stopCamera);

  ui.form?.addEventListener("submit", (e) => {
    e.preventDefault();

    const unit = ui.unit?.value.trim() || "";
    const room = ui.room?.value.trim() || "";
    const bed = ui.bed?.value.trim() || "";
    const serial = ui.serial?.value.trim() || "";

    if (!unit || !room || !bed || !serial) {
      alert("Fill Unit, Room, Bed, and Serial (or scan) before logging.");
      return;
    }

    addLog({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      timestamp: nowIso(),
      unit,
      room,
      bed,
      serial,
    });

    if (ui.serial) ui.serial.value = "";
    setScanStatus("good", "Logged ✅ Ready.");
  });

  ui.btnClear?.addEventListener("click", () => {
    if (ui.serial) ui.serial.value = "";
    setScanStatus(null, "Idle");
  });

  ui.btnExport?.addEventListener("click", () => {
    const logs = loadLogs();
    const csv = toCsv(logs);
    const name = `wound-vac-tracker_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadText(name, csv, "text/csv");
  });

  ui.btnWipe?.addEventListener("click", () => {
    const ok = confirm("Wipe ALL local data on this device?");
    if (ok) wipeAll();
  });

  ui.search?.addEventListener("input", render);

  // If user leaves the page, release camera cleanly
  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCamera();
  });
}

window.addEventListener("load", init);
