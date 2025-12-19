/* Wound Vac Tracker (PHI-Free)
   - GitHub Pages (HTTPS) required for camera on iPhone
   - Scanner:
       1) BarcodeDetector API if available
       2) Fallback to ZXing via dynamic import from CDN
*/

const STORAGE_KEY = "wvt_logs_v1";

const el = (id) => document.getElementById(id);

const ui = {
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

let stream = null;
let scanning = false;
let scanTimer = null;
let zxing = null; // lazy loaded
let startingCamera = false;

// ---------- Utilities ----------

function isHttps() {
  return location.protocol === "https:" || location.hostname === "localhost";
}

function isStreamActive(s) {
  return !!(s && s.getTracks && s.getTracks().some((t) => t.readyState === "live"));
}

function setPill() {
  const pill = ui.securePill;
  if (!pill) return;

  if (isHttps()) {
    pill.textContent = "HTTPS: secure ✅";
  } else {
    pill.textContent = "HTTPS: NOT secure ❌";
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
  const d = new Date(iso);
  return d.toLocaleString();
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
  if (!raw) return "";
  return String(raw).trim();
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

  setScanStatus("good", `Scan successful ✅  (${v})`);
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
  // IMPORTANT: do NOT stop tracks (avoids iOS Safari re-open bug)
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
      alert("Camera requires HTTPS on iPhone.");
      return;
    }

    setScanStatus("warn", "Starting camera…");

    // Reuse live stream if we already have it
    if (stream && isStreamActive(stream)) {
      ui.video.setAttribute("playsinline", "");
      ui.video.setAttribute("webkit-playsinline", "");
      ui.video.muted = true;
      ui.video.autoplay = true;

      ui.video.srcObject = stream;
      await new Promise((res) => setTimeout(res, 120));
      await ui.video.play().catch(() => {});

      scanning = true;
      ui.btnStartScan.disabled = true;
      ui.btnStopScan.disabled = false;

      setScanStatus(null, "Camera running (reused). Point at barcode / QR.");
      await beginScanLoop();
      return;
    }

    // Otherwise acquire fresh stream
    await hardReleaseCamera();

    const constraints = {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };

    // Retry once for transient Safari errors
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const name = err?.name || "";
        const retryable = ["AbortError", "NotReadableError", "OverconstrainedError"].includes(name);
        if (attempt === 0 && retryable) {
          await new Promise((res) => setTimeout(res, 900));
          continue;
        }
        throw err;
      }
    }
    if (!stream) throw lastErr || new Error("No stream");

    ui.video.setAttribute("playsinline", "");
    ui.video.setAttribute("webkit-playsinline", "");
    ui.video.muted = true;
    ui.video.autoplay = true;

    ui.video.srcObject = stream;
    await new Promise((res) => setTimeout(res, 150));
    await ui.video.play();

    scanning = true;
    ui.btnStartScan.disabled = true;
    ui.btnStopScan.disabled = false;

    setScanStatus(null, "Camera running. Point at barcode / QR.");
    await beginScanLoop();
  } catch (err) {
    console.error("Camera error:", err);

    // give Safari time to recover
    await new Promise((res) => setTimeout(res, 600));

    setScanStatus("bad", "Camera failed (iOS Safari).");
    alert(
      "Camera failed.\n\n" +
        "Try:\n" +
        "• Tap Close\n" +
        "• Wait 1 second\n" +
        "• Tap Start Camera again\n\n" +
        "If still stuck: force-close Safari and reopen."
    );
  } finally {
    startingCamera = false;
  }
}

// ---------- Scanner loop ----------

async function beginScanLoop() {
  const hasBarcodeDetector = "BarcodeDetector" in window;

  if (hasBarcodeDetector) {
    const formats = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf"];
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
  setScanStatus("warn", "Native scanner unavailable. Loading fallback scanner…");
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
    alert("Scanner fallback failed. Try updating iOS, or test another device.");
  }
}

async function loadZXing() {
  if (zxing) return;
  const mod = await import("https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/esm/index.min.js");
  zxing = mod;
}

// ---------- Init / Events ----------

function init() {
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

  // Lifecycle: hard release only when leaving page (battery + stability)
  window.addEventListener("pagehide", hardReleaseCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) softStopScan();
  });

  // Keep Service Worker OFF until you're fully happy with camera stability on iOS
  // if ("serviceWorker" in navigator) {
  //   navigator.serviceWorker.register("./sw.js").catch(() => {});
  // }
}

window.addEventListener("load", init);
