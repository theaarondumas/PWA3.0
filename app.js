/* Wound Vac Tracker (PHI-Free)
   - GitHub Pages (HTTPS) required for camera on iPhone
   - Scanner strategy:
       iOS Safari: ZXing ONLY (BarcodeDetector is not supported reliably)
       Others: try native BarcodeDetector, fallback to ZXing
*/

const STORAGE_KEY = "wvt_logs_v1";
const el = (id) => document.getElementById(id);

let ui = {};

// ---- state ----
let stream = null;
let scanning = false;
let scanTimer = null;
let zxing = null;       // lazy loaded
let startingCamera = false;

// ---------- UI binding (SAFE) ----------
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

  // Don’t block the app; just warn.
  const required = ["securePill","btnStartScan","btnStopScan","video","scanDot","scanText","tbody"];
  const missing = required.filter((k) => !ui[k]);
  if (missing.length) {
    alert("Missing HTML IDs: " + missing.join(", "));
  }
}

// ---------- Utilities ----------
function isHttps() {
  return location.protocol === "https:" || location.hostname === "localhost";
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStreamActive(s) {
  return !!(s && s.getTracks && s.getTracks().some((t) => t.readyState === "live"));
}

function setPill() {
  const pill = ui.securePill;
  if (!pill) return;

  if (isHttps()) {
    pill.textContent = "HTTPS: secure ✅";
    pill.style.color = "#37d67a";
  } else {
    pill.textContent = "HTTPS: NOT secure ❌";
    pill.style.color = "";
  }
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

// ---------- Camera control (Safari-hardened) ----------
async function hardReleaseCamera() {
  scanning = false;

  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }

  if (zxing && zxing._reader) {
    try { zxing._reader.reset(); } catch {}
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

async function softStopScan() {
  // IMPORTANT: do NOT stop tracks (helps iOS Safari restart reliability)
  scanning = false;

  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }

  if (zxing && zxing._reader) {
    try { zxing._reader.reset(); } catch {}
  }

  ui.btnStartScan && (ui.btnStartScan.disabled = false);
  ui.btnStopScan && (ui.btnStopScan.disabled = true);

  setScanStatus(null, "Idle (camera kept ready)");
}

async function stopCamera() {
  await softStopScan();
}

async function startCamera() {
  if (startingCamera) return;
  startingCamera = true;

  try {
    if (!isHttps()) {
      alert("Camera requires HTTPS on iPhone (GitHub Pages).");
      return;
    }

    setScanStatus("warn", "Starting camera…");

    // Reuse existing live stream
    if (stream && isStreamActive(stream)) {
      prepareVideoElementForIOS();
      ui.video.srcObject = stream;
      await delay(120);
      await ui.video.play().catch(() => {});
      scanning = true;
      ui.btnStartScan.disabled = true;
      ui.btnStopScan.disabled = false;
      setScanStatus(null, "Camera running (reused). Point at barcode / QR.");
      await beginScanLoop();
      return;
    }

    // Fresh acquire
    await hardReleaseCamera();

    // Start with reasonable constraints; if OverconstrainedError, we'll relax.
    let constraints = {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };

    let lastErr = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const name = err?.name || "";

        // If constraints are too strict, relax on retry
        if (name === "OverconstrainedError") {
          constraints = { video: { facingMode: "environment" }, audio: false };
        }

        const retryable = ["AbortError", "NotReadableError", "OverconstrainedError"].includes(name);
        if (attempt === 0 && retryable) {
          await delay(900);
          continue;
        }
        throw err;
      }
    }

    if (!stream) throw lastErr || new Error("No stream");

    prepareVideoElementForIOS();
    ui.video.srcObject = stream;

    await delay(150);
    await ui.video.play();

    scanning = true;
    ui.btnStartScan.disabled = true;
    ui.btnStopScan.disabled = false;

    setScanStatus(null, "Camera running. Point at barcode / QR.");
    await beginScanLoop();

  } catch (err) {
    console.error("Camera error:", err);

    const name = err?.name || "UnknownError";
    const msg  = err?.message || "";
    const hint =
      name === "NotAllowedError" ? "Permission blocked (Safari/Screen Time/MDM)." :
      name === "NotReadableError" ? "Camera in use by another app or iOS/Safari glitch. Force-close Camera/FaceTime/Instagram, then retry. If needed restart iPhone." :
      name === "AbortError" ? "Safari glitch. Reload or force-close Safari." :
      name === "OverconstrainedError" ? "Camera constraints issue. We relaxed constraints; retry Start Camera." :
      name === "TypeError" ? "Often a script/cache issue. Hard refresh / clear Safari website data and retry." :
      "Unknown. Retry after force-closing Safari.";

    setScanStatus("bad", `Camera error: ${name}`);

    alert(
      "Camera failed.\n\n" +
      "ERROR: " + name + "\n" +
      (msg ? ("MSG: " + msg + "\n") : "") +
      "\n" + hint
    );

  } finally {
    startingCamera = false;
  }
}

function prepareVideoElementForIOS() {
  if (!ui.video) return;
  ui.video.setAttribute("playsinline", "");
  ui.video.setAttribute("webkit-playsinline", "");
  ui.video.muted = true;
  ui.video.autoplay = true;
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ---------- Scanner loop ----------
async function beginScanLoop() {
  // iOS Safari: ZXing ONLY (skip BarcodeDetector entirely)
  if (isIOS()) {
    setScanStatus("warn", "Scanner loading (iOS)…");
    await loadZXing();
    setScanStatus(null, "Scanner ready.");

    try {
      const reader = new zxing.BrowserMultiFormatReader();
      zxing._reader = reader;

      // Prefer continuously method if present
      if (reader.decodeFromVideoElementContinuously) {
        reader.decodeFromVideoElementContinuously(ui.video, (result) => {
          if (!scanning) return;
          if (result?.getText) successScan(result.getText());
        });
      } else {
        reader.decodeFromVideoDevice(null, ui.video, (result) => {
          if (!scanning) return;
          if (result?.getText) successScan(result.getText());
        });
      }
    } catch (e) {
      console.error(e);
      setScanStatus("bad", "Scanner failed to start (iOS).");
      alert("Scanner failed on iOS. Try force-closing Safari, then reload.");
    }

    return;
  }

  // Non-iOS: Try BarcodeDetector first, fallback to ZXing
  if ("BarcodeDetector" in window) {
    const formats = ["qr_code","code_128","code_39","ean_13","ean_8","upc_a","upc_e","itf"];
    let detector = null;

    try {
      detector = new BarcodeDetector({ formats });
    } catch {
      detector = null;
    }

    if (detector) {
      setScanStatus(null, "Scanner ready (native).");

      const tick = async () => {
        if (!scanning) return;

        try {
          const bmp = await createImageBitmap(ui.video);
          const barcodes = await detector.detect(bmp);
          bmp.close?.();

          if (barcodes?.length) {
            successScan(barcodes[0].rawValue || barcodes[0].value || "");
          }
        } catch {
          // ignore frame errors
        }

        scanTimer = setTimeout(tick, 250);
      };

      tick();
      return;
    }
  }

  // Fallback ZXing
  setScanStatus("warn", "Loading fallback scanner…");
  await loadZXing();
  setScanStatus(null, "Scanner ready (fallback).");

  try {
    const reader = new zxing.BrowserMultiFormatReader();
    zxing._reader = reader;

    if (reader.decodeFromVideoElementContinuously) {
      reader.decodeFromVideoElementContinuously(ui.video, (result) => {
        if (!scanning) return;
        if (result?.getText) successScan(result.getText());
      });
    } else {
      reader.decodeFromVideoDevice(null, ui.video, (result) => {
        if (!scanning) return;
        if (result?.getText) successScan(result.getText());
      });
    }
  } catch (e) {
    console.error(e);
    setScanStatus("bad", "Fallback scanner failed to start.");
    alert("Scanner fallback failed. Try updating browser/device.");
  }
}

async function loadZXing() {
  if (zxing) return;

  // IMPORTANT: dynamic import can fail if CDN blocked.
  // This is the most common stable ESM CDN URL.
  const mod = await import("https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/esm/index.min.js");
  zxing = mod;
}

// ---------- Init / Events ----------
function init() {
  bindUI(); // bind after DOM exists

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

  // Lifecycle
  window.addEventListener("pagehide", hardReleaseCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) softStopScan();
  });
}

window.addEventListener("load", init);
