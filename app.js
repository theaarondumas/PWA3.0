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

function isHttps() {
  // GitHub pages is https. Localhost is treated as secure in some browsers, but iPhone needs https.
  return location.protocol === "https:" || location.hostname === "localhost";
}

function setPill() {
  if (isHttps()) {
    ui.securePill.textContent = "HTTPS: secure ✅";
    ui.securePill.style.color = "rgba(55,214,122,.95)";
  } else {
    ui.securePill.textContent = "HTTPS: NOT secure ❌";
    ui.securePill.style.color = "rgba(255,77,77,.95)";
  }
}

function setScanStatus(kind, text) {
  ui.scanDot.className = "dot";
  if (kind) ui.scanDot.classList.add(kind);
  ui.scanText.textContent = text;
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
  const logs = loadLogs().filter(x => x.id !== id);
  saveLogs(logs);
  render();
}

function wipeAll() {
  localStorage.removeItem(STORAGE_KEY);
  render();
}

function toCsv(logs) {
  const header = ["timestamp","unit","room","bed","serial"];
  const rows = logs.map(l => [
    l.timestamp,
    l.unit,
    l.room,
    l.bed,
    (l.serial || "").replaceAll('"', '""')
  ]);
  return [header, ...rows].map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
}

function downloadText(filename, text, mime="text/plain") {
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
  start.setHours(0,0,0,0);
  return logs.filter(l => new Date(l.timestamp) >= start).length;
}

function uniqueUnits(logs) {
  const set = new Set(logs.map(l => (l.unit || "").trim()).filter(Boolean));
  return set.size;
}

function render() {
  const q = (ui.search.value || "").toLowerCase().trim();
  const logs = loadLogs();

  ui.kpiTotal.textContent = String(logs.length);
  ui.kpiToday.textContent = String(todayCount(logs));
  ui.kpiUnits.textContent = String(uniqueUnits(logs));

  const filtered = !q ? logs : logs.filter(l => {
    const hay = `${l.unit} ${l.room} ${l.bed} ${l.serial} ${l.timestamp}`.toLowerCase();
    return hay.includes(q);
  });

  ui.tbody.innerHTML = filtered.map(l => `
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
  `).join("");

  [...ui.tbody.querySelectorAll("button[data-del]")].forEach(btn => {
    btn.addEventListener("click", () => deleteLog(btn.getAttribute("data-del")));
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function normalizeScanValue(raw) {
  if (!raw) return "";
  // Keep it simple: trim and collapse spaces
  return String(raw).trim();
}

function successScan(value) {
  const v = normalizeScanValue(value);
  if (!v) {
    setScanStatus("warn", "Scan read empty value—try again.");
    return;
  }

  // Visual green check
  setScanStatus("good", `Scan successful ✅  (${v})`);

  // Haptic feedback if available
  if (navigator.vibrate) navigator.vibrate(60);

  // Fill serial field
  ui.serial.value = v;

  // Optionally log immediately
  if (ui.autoLog.checked) {
    // Only log if form fields are filled enough; if not, we keep serial and prompt.
    const unit = ui.unit.value.trim();
    const room = ui.room.value.trim();
    const bed  = ui.bed.value.trim();

    if (unit && room && bed) {
      addLog({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
        timestamp: nowIso(),
        unit, room, bed,
        serial: v,
      });
      // Clear serial so they can scan next one quickly
      ui.serial.value = "";
      setScanStatus("good", "Logged ✅ Ready for next scan.");
    } else {
      setScanStatus("warn", "Scanned ✅ Now enter Unit/Room/Bed to log.");
    }
  }
}

async function startCamera() {
  if (!isHttps()) {
    setScanStatus("bad", "Camera blocked: page is not HTTPS.");
    alert("Camera requires HTTPS on iPhone. Use GitHub Pages (https://) to run this.");
    return;
  }

  try {
    setScanStatus("warn", "Requesting camera permission…");

    // Stop any existing
    await stopCamera();

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    ui.video.srcObject = stream;
    await ui.video.play();

    scanning = true;
    ui.btnStartScan.disabled = true;
    ui.btnStopScan.disabled = false;

    setScanStatus(null, "Camera running. Looking for barcode/QR…");

    // Start scanning loop
    await beginScanLoop();
  } catch (err) {
    console.error(err);
    setScanStatus("bad", "Camera failed. Check permissions and HTTPS.");
    alert("Camera failed. On iPhone: Settings → Safari → Camera (Allow), and ensure you're on https://");
  }
}

async function startCamera() {
  if (!isHttps()) {
    alert("Camera requires HTTPS on iPhone.");
    return;
  }

  try {
    setScanStatus("warn", "Requesting camera…");

    await stopCamera();

    const constraints = {
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    // IMPORTANT: request stream first
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);

    stream = newStream;

    // IMPORTANT: set attributes BEFORE assigning srcObject
    ui.video.setAttribute("playsinline", "");
    ui.video.setAttribute("webkit-playsinline", "");
    ui.video.muted = true;
    ui.video.autoplay = true;

    ui.video.srcObject = stream;

    // iOS needs a short delay before play()
    await new Promise(res => setTimeout(res, 150));

    await ui.video.play();

    scanning = true;
    ui.btnStartScan.disabled = true;
    ui.btnStopScan.disabled = false;

    setScanStatus(null, "Camera running. Point at barcode / QR.");

    await beginScanLoop();

  } catch (err) {
    console.error("Camera error:", err);
    setScanStatus("bad", "Camera failed (iOS Safari).");

    alert(
      "Camera failed.\n\n" +
      "Fix checklist:\n" +
      "• Reload page\n" +
      "• Tap Start Camera again\n" +
      "• Low Power Mode OFF\n" +
      "• Try Safari (not in-app browser)"
    );
  }
}

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
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  ui.btnStartScan.disabled = false;
  ui.btnStopScan.disabled = true;

  setScanStatus(null, "Idle");
}

async function beginScanLoop() {
  // Prefer native BarcodeDetector when present
  const hasBarcodeDetector = ("BarcodeDetector" in window);

  if (hasBarcodeDetector) {
    const formats = [
      "qr_code",
      "code_128",
      "code_39",
      "ean_13",
      "ean_8",
      "upc_a",
      "upc_e",
      "itf"
    ];

    let detector = null;
    try {
      detector = new BarcodeDetector({ formats });
    } catch (e) {
      detector = null;
    }

    if (detector) {
      setScanStatus(null, "Scanner ready (native).");
      const tick = async () => {
        if (!scanning) return;

        try {
          // Grab a frame from the video
          const bmp = await createImageBitmap(ui.video);
          const barcodes = await detector.detect(bmp);
          bmp.close?.();

          if (barcodes && barcodes.length) {
            successScan(barcodes[0].rawValue || barcodes[0].value || "");
          }
        } catch {
          // ignore frame errors
        }

        // Scan ~4x/sec (good balance on iPhone)
        scanTimer = setTimeout(tick, 250);
      };
      tick();
      return;
    }
  }

  // Fallback to ZXing
  setScanStatus("warn", "Native scanner unavailable. Loading fallback scanner…");
  await loadZXing();
  setScanStatus(null, "Scanner ready (fallback).");

  // Use ZXing BrowserMultiFormatReader
  try {
    const reader = new zxing.BrowserMultiFormatReader();
    zxing._reader = reader;

    // decodeFromVideoElementContinuously exists in newer versions,
    // but we keep compatibility with decodeFromVideoDevice.
    reader.decodeFromVideoElementContinuously
      ? reader.decodeFromVideoElementContinuously(ui.video, (result, err) => {
          if (!scanning) return;
          if (result?.getText) successScan(result.getText());
        })
      : reader.decodeFromVideoDevice(null, ui.video, (result, err) => {
          if (!scanning) return;
          if (result?.getText) successScan(result.getText());
        });

  } catch (e) {
    console.error(e);
    setScanStatus("bad", "Fallback scanner failed to start.");
    alert("Scanner fallback failed. Try updating iOS, or test on another device.");
  }
}

async function loadZXing() {
  if (zxing) return;

  // Dynamic import from a stable CDN path.
  // If this ever changes, the native BarcodeDetector path will still work on capable browsers.
  const mod = await import("https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/esm/index.min.js");
  zxing = mod;
}

function init() {
  setPill();
  render();

  ui.btnStartScan.addEventListener("click", startCamera);
  ui.btnStopScan.addEventListener("click", stopCamera);

  ui.form.addEventListener("submit", (e) => {
    e.preventDefault();

    const unit = ui.unit.value.trim();
    const room = ui.room.value.trim();
    const bed  = ui.bed.value.trim();
    const serial = ui.serial.value.trim();

    if (!unit || !room || !bed || !serial) {
      alert("Fill Unit, Room, Bed, and Serial (or scan) before logging.");
      return;
    }

    addLog({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      timestamp: nowIso(),
      unit, room, bed, serial
    });

    ui.serial.value = "";
    setScanStatus("good", "Logged ✅ Ready.");
  });

  ui.btnClear.addEventListener("click", () => {
    ui.serial.value = "";
    setScanStatus(null, "Idle");
  });

  ui.btnExport.addEventListener("click", () => {
    const logs = loadLogs();
    const csv = toCsv(logs);
    const name = `wound-vac-tracker_${new Date().toISOString().slice(0,10)}.csv`;
    downloadText(name, csv, "text/csv");
  });

  ui.btnWipe.addEventListener("click", () => {
    const ok = confirm("Wipe ALL local data on this device?");
    if (ok) wipeAll();
  });

  ui.search.addEventListener("input", render);

  // Service worker for basic offline (optional)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

window.addEventListener("load", init);
