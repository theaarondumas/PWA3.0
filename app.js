/* Wound Vac Tracker (PHI-Free) - Safari-safe single file
   - No imports / no modules (fixes "Importing a module script failed")
   - Camera scan via BarcodeDetector when supported
   - Manual entry fallback
   - LocalStorage log + CSV export
*/

(() => {
  "use strict";

  // ---------- Config ----------
  const STORAGE_KEY = "wvt_logs_v1";
  const MAX_LOGS = 2000;

  // Try these formats; Safari support varies.
  // If a format isn't supported, BarcodeDetector will ignore it or throw.
  const PREFERRED_FORMATS = [
    "qr_code",
    "code_128",
    "code_39",
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
    "itf",
    "data_matrix",
    "pdf417"
  ];

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);

  function safeText(el, txt) {
    if (!el) return;
    el.textContent = txt;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function loadLogs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveLogs(logs) {
    try {
      const clipped = logs.slice(-MAX_LOGS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clipped));
    } catch (e) {
      console.warn("Failed saving logs", e);
    }
  }

  function escapeCsv(val) {
    const s = String(val ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function setBadge(type, msg) {
    // type: "ok" | "err" | "info"
    const badge = $("#wvtBadge");
    const badgeMsg = $("#wvtBadgeMsg");
    if (!badge || !badgeMsg) return;

    badge.classList.remove("ok", "err", "info");
    badge.classList.add(type);
    badgeMsg.textContent = msg;

    // auto-hide after a moment for ok/info, keep errors longer
    const ms = type === "err" ? 4000 : 1800;
    badge.style.opacity = "1";
    clearTimeout(setBadge._t);
    setBadge._t = setTimeout(() => {
      badge.style.opacity = "0";
    }, ms);
  }

  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }

  // ---------- UI injection (works even if your HTML changes) ----------
  function ensureUI() {
    // Try to mount into an existing container; otherwise body.
    const mount =
      $("#scan") ||
      $("#scanner") ||
      $("#main") ||
      $("main") ||
      document.body;

    // Avoid double-inject
    if ($("#wvtRoot")) return;

    const root = document.createElement("section");
    root.id = "wvtRoot";
    root.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin: 12px 0;">
        <div style="font-weight:700; font-size:16px;">Scan</div>
        <div id="wvtBadge" class="info" style="
          transition:opacity .2s ease;
          opacity:0;
          padding:8px 10px;
          border-radius:12px;
          font-size:13px;
          border:1px solid rgba(255,255,255,.14);
          background: rgba(30,30,30,.55);
          backdrop-filter: blur(8px);
        ">
          <span id="wvtBadgeMsg">Ready</span>
        </div>
      </div>

      <div style="display:grid; gap:10px;">
        <div style="border-radius:16px; overflow:hidden; border:1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.25);">
          <video id="wvtVideo" playsinline muted style="width:100%; height:auto; display:block; background:#000;"></video>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button id="wvtStartBtn" type="button" style="flex:1; min-width:140px; padding:12px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.14); background: rgba(40,40,40,.55); color:#fff;">
            Start Scan
          </button>
          <button id="wvtStopBtn" type="button" disabled style="flex:1; min-width:140px; padding:12px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.14); background: rgba(40,40,40,.25); color:#aaa;">
            Stop
          </button>
          <button id="wvtTorchBtn" type="button" disabled style="flex:1; min-width:140px; padding:12px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.14); background: rgba(40,40,40,.25); color:#aaa;">
            Torch
          </button>
        </div>

        <div style="display:grid; gap:8px;">
          <div style="font-size:12px; opacity:.8;">Last scan</div>
          <div id="wvtLast" style="padding:12px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.12); background: rgba(20,20,20,.35); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
            —
          </div>
        </div>

        <details style="border-radius:14px; border:1px solid rgba(255,255,255,.10); background: rgba(20,20,20,.25); padding:10px 12px;">
          <summary style="cursor:pointer; font-weight:600;">Manual entry (fallback)</summary>
          <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
            <input id="wvtManual" placeholder="Enter serial / QR text" inputmode="text" autocomplete="off"
              style="flex:1; min-width:220px; padding:12px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.25); color:#fff;" />
            <button id="wvtManualSave" type="button"
              style="padding:12px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background: rgba(40,40,40,.55); color:#fff;">
              Log
            </button>
          </div>
        </details>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:4px;">
          <button id="wvtExportBtn" type="button" style="flex:1; min-width:160px; padding:12px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.14); background: rgba(40,40,40,.55); color:#fff;">
            Export CSV
          </button>
          <button id="wvtClearBtn" type="button" style="flex:1; min-width:160px; padding:12px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.14); background: rgba(70,20,20,.45); color:#fff;">
            Clear Logs
          </button>
        </div>

        <div style="font-size:12px; opacity:.75; line-height:1.35;">
          Notes: Requires HTTPS. If scan isn’t supported on this iPhone/browser, use Manual entry.
        </div>
      </div>
    `;

    mount.appendChild(root);

    // add minimal badge color classes
    const style = document.createElement("style");
    style.textContent = `
      #wvtBadge.ok { border-color: rgba(80,255,160,.35) !important; background: rgba(10,70,30,.45) !important; }
      #wvtBadge.err { border-color: rgba(255,80,80,.35) !important; background: rgba(80,10,10,.45) !important; }
      #wvtBadge.info{ border-color: rgba(120,170,255,.35) !important; background: rgba(10,25,60,.45) !important; }
    `;
    document.head.appendChild(style);
  }

  // ---------- Scanning engine ----------
  let stream = null;
  let scanning = false;
  let detector = null;
  let rafId = null;
  let lastValue = "";
  let lastAt = 0;
  let torchOn = false;
  let videoTrack = null;

  function canUseBarcodeDetector() {
    return "BarcodeDetector" in window;
  }

  async function buildDetector() {
    // Try preferred formats first; if Safari throws, fall back to default constructor
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats?.();
      // If supported formats list exists, choose overlap; else use preferred.
      const formats = Array.isArray(supported) && supported.length
        ? PREFERRED_FORMATS.filter(f => supported.includes(f))
        : PREFERRED_FORMATS;

      // If overlap is empty, still try with preferred list.
      return new window.BarcodeDetector({ formats: formats.length ? formats : PREFERRED_FORMATS });
    } catch (e) {
      // Some browsers don't allow getSupportedFormats; try simplest
      try {
        return new window.BarcodeDetector();
      } catch (err) {
        throw err;
      }
    }
  }

  async function startCamera() {
    const video = $("#wvtVideo");
    if (!video) throw new Error("Video element not found");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API not supported on this browser");
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      throw new Error("Camera requires HTTPS");
    }

    // Request rear camera
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();

    // Keep track reference (for torch + stop)
    videoTrack = stream.getVideoTracks?.()[0] || null;

    return true;
  }

  function stopCamera() {
    try {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      scanning = false;

      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      stream = null;
      videoTrack = null;
      torchOn = false;

      const video = $("#wvtVideo");
      if (video) video.srcObject = null;
    } catch (e) {
      console.warn("stopCamera error", e);
    }
  }

  async function setTorch(enabled) {
    if (!videoTrack) return false;
    const caps = videoTrack.getCapabilities?.();
    if (!caps || !caps.torch) return false;

    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: enabled }] });
      torchOn = enabled;
      return true;
    } catch (e) {
      console.warn("Torch failed", e);
      return false;
    }
  }

  function normalizeValue(raw) {
    return String(raw || "").trim();
  }

  function logScan(value, source) {
    const clean = normalizeValue(value);
    if (!clean) return;

    const logs = loadLogs();
    logs.push({
      at: nowIso(),
      value: clean,
      source: source || "scan"
    });
    saveLogs(logs);

    const last = $("#wvtLast");
    if (last) last.textContent = clean;

    setBadge("ok", "Scan accepted ✅");
  }

  function shouldAccept(value) {
    const v = normalizeValue(value);
    if (!v) return false;

    // Prevent rapid repeats (same code within 3 seconds)
    const t = Date.now();
    if (v === lastValue && (t - lastAt) < 3000) return false;
    lastValue = v;
    lastAt = t;
    return true;
  }

  async function scanLoop() {
    if (!scanning) return;
    const video = $("#wvtVideo");
    if (!video) return;

    try {
      // detector.detect expects an ImageBitmapSource (video works)
      const codes = await detector.detect(video);

      if (codes && codes.length) {
        const raw = codes[0].rawValue || codes[0].data || "";
        if (shouldAccept(raw)) {
          logScan(raw, "camera");
          // Optional: pause briefly after accept so you don't double-log
          await new Promise(r => setTimeout(r, 600));
        }
      }
    } catch (e) {
      // Some frames may throw; don't hard-fail the loop
      // But if it's persistent, show an error once.
      // We keep it quiet to avoid annoying popups.
    }

    rafId = requestAnimationFrame(scanLoop);
  }

  function setButtons(state) {
    const startBtn = $("#wvtStartBtn");
    const stopBtn = $("#wvtStopBtn");
    const torchBtn = $("#wvtTorchBtn");

    if (!startBtn || !stopBtn || !torchBtn) return;

    if (state === "running") {
      startBtn.disabled = true;
      startBtn.style.opacity = "0.6";

      stopBtn.disabled = false;
      stopBtn.style.opacity = "1";
      stopBtn.style.color = "#fff";
      stopBtn.style.background = "rgba(40,40,40,.55)";

      // torch enabled only if track supports it; we’ll update after camera starts
    } else {
      startBtn.disabled = false;
      startBtn.style.opacity = "1";

      stopBtn.disabled = true;
      stopBtn.style.opacity = "0.6";
      stopBtn.style.color = "#aaa";
      stopBtn.style.background = "rgba(40,40,40,.25)";

      torchBtn.disabled = true;
      torchBtn.style.opacity = "0.6";
      torchBtn.style.color = "#aaa";
      torchBtn.style.background = "rgba(40,40,40,.25)";
    }
  }

  function updateTorchButtonAvailability() {
    const torchBtn = $("#wvtTorchBtn");
    if (!torchBtn) return;

    const caps = videoTrack?.getCapabilities?.();
    const hasTorch = !!(caps && caps.torch);

    torchBtn.disabled = !hasTorch;
    torchBtn.style.opacity = hasTorch ? "1" : "0.6";
    torchBtn.style.color = hasTorch ? "#fff" : "#aaa";
    torchBtn.style.background = hasTorch ? "rgba(40,40,40,.55)" : "rgba(40,40,40,.25)";
    torchBtn.textContent = torchOn ? "Torch: ON" : "Torch";
  }

  async function onStart() {
    try {
      setBadge("info", "Starting camera…");
      ensureUI();

      if (!canUseBarcodeDetector()) {
        setBadge("err", "Scanner not supported on this iPhone/browser. Use Manual entry.");
        // Still allow camera preview (optional). But without detector, no scan.
        await startCamera();
        setButtons("running");
        updateTorchButtonAvailability();
        return;
      }

      detector = await buildDetector();
      await startCamera();

      scanning = true;
      setButtons("running");
      updateTorchButtonAvailability();

      setBadge("info", "Aim at barcode/QR…");
      rafId = requestAnimationFrame(scanLoop);
    } catch (e) {
      console.error(e);
      stopCamera();
      setButtons("stopped");

      // Clean user message for common errors
      const msg = (e && e.message) ? e.message : String(e);

      if (/Permission|denied/i.test(msg)) {
        setBadge("err", "Camera permission denied. Enable camera for this site in Safari settings.");
      } else if (/HTTPS/i.test(msg)) {
        setBadge("err", "Camera requires HTTPS.");
      } else {
        setBadge("err", `Camera failed: ${msg}`);
      }
    }
  }

  function onStop() {
    stopCamera();
    setButtons("stopped");
    setBadge("info", "Stopped");
  }

  async function onTorch() {
    const torchBtn = $("#wvtTorchBtn");
    if (!torchBtn) return;

    const next = !torchOn;
    const ok = await setTorch(next);
    if (ok) {
      torchBtn.textContent = next ? "Torch: ON" : "Torch";
      setBadge("info", next ? "Torch on" : "Torch off");
    } else {
      setBadge("err", "Torch not available on this device.");
    }
  }

  function onManualSave() {
    const inp = $("#wvtManual");
    if (!inp) return;
    const v = normalizeValue(inp.value);
    if (!v) {
      setBadge("err", "Enter a serial/QR value first.");
      return;
    }
    inp.value = "";
    logScan(v, "manual");
  }

  function onExport() {
    const logs = loadLogs();
    if (!logs.length) {
      setBadge("err", "No logs to export.");
      return;
    }

    const header = ["timestamp", "value", "source"];
    const rows = logs.map(r => [r.at, r.value, r.source].map(escapeCsv).join(","));
    const csv = header.join(",") + "\n" + rows.join("\n");
    const filename = `wound-vac-log_${new Date().toISOString().slice(0,10)}.csv`;

    downloadText(filename, csv);
    setBadge("ok", "Exported ✅");
  }

  function onClear() {
    const ok = confirm("Clear all local logs on this device?");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    const last = $("#wvtLast");
    if (last) last.textContent = "—";
    setBadge("ok", "Cleared ✅");
  }

  // ---------- Init ----------
  function wire() {
    ensureUI();

    const startBtn = $("#wvtStartBtn");
    const stopBtn = $("#wvtStopBtn");
    const torchBtn = $("#wvtTorchBtn");
    const manualBtn = $("#wvtManualSave");
    const exportBtn = $("#wvtExportBtn");
    const clearBtn = $("#wvtClearBtn");

    startBtn?.addEventListener("click", onStart);
    stopBtn?.addEventListener("click", onStop);
    torchBtn?.addEventListener("click", onTorch);
    manualBtn?.addEventListener("click", onManualSave);
    exportBtn?.addEventListener("click", onExport);
    clearBtn?.addEventListener("click", onClear);

    // Show last scan if exists
    const logs = loadLogs();
    if (logs.length) {
      const last = logs[logs.length - 1];
      const lastEl = $("#wvtLast");
      if (lastEl) lastEl.textContent = last.value || "—";
    }

    // Stop camera if user backgrounds tab
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && scanning) onStop();
    });

    setBadge("info", "Ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
