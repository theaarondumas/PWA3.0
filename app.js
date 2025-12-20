/* Wound Vac Tracker (PHI-Free) — iOS Safari QR Scanner (jsQR)
   - NO modules / NO imports
   - QR-only scanning via jsQR (global)
   - Fills Serial field + optional auto-log
   - LocalStorage logs + KPIs + table + search + export + wipe
*/

// --- BIG GREEN "ACCEPTED ✅" OVERLAY (no HTML/CSS needed) ---
function showAccepted(msg = "ACCEPTED") {
  let wrap = document.getElementById("wvtAcceptedOverlay");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "wvtAcceptedOverlay";
    wrap.style.cssText =
      "position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:99999;pointer-events:none;";
    wrap.innerHTML = `
      <div id="wvtAcceptedBox" style="
        background:rgba(10,80,40,.92);
        border:3px solid #3cff9e;
        border-radius:20px;
        padding:28px 36px;
        text-align:center;
        box-shadow:0 0 30px rgba(60,255,160,.6);
        transform:scale(.95);
        opacity:0;
        transition:opacity .12s ease, transform .12s ease;">
        <div style="font-size:64px;line-height:1;color:#3cff9e;">✔</div>
        <div id="wvtAcceptedText" style="margin-top:8px;font-size:32px;font-weight:800;letter-spacing:2px;color:#eafff3;">ACCEPTED</div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  const text = document.getElementById("wvtAcceptedText");
  if (text) text.textContent = msg;

  const box = document.getElementById("wvtAcceptedBox");
  wrap.style.display = "flex";
  requestAnimationFrame(() => {
    if (box) { box.style.opacity = "1"; box.style.transform = "scale(1)"; }
  });

  clearTimeout(showAccepted._t);
  showAccepted._t = setTimeout(() => {
    if (box) { box.style.opacity = "0"; box.style.transform = "scale(.95)"; }
    setTimeout(() => (wrap.style.display = "none"), 130);
  }, 900);
}

(() => {
  "use strict";

  // -------------------------
  // DOM helpers
  // -------------------------
  const $ = (id) => document.getElementById(id);

  // Elements (from your HTML)
  const securePill = $("securePill");

  const beepOnScan = { value: true };
  const hapticOnScan = { value: true };
  const btnStartScan = $("btnStartScan");
  const btnStopScan = $("btnStopScan");
  const videoEl = $("video");

  const scanDot = $("scanDot");
  const scanText = $("scanText");
  const autoLogEl = $("autoLog");

  const logForm = $("logForm");
  const unitEl = $("unit");
  const roomEl = $("room");
  const bedEl = $("bed");
  const serialEl = $("serial");
  const btnClear = $("btnClear");

  const kpiTotal = $("kpiTotal");
  const kpiToday = $("kpiToday");
  const kpiUnits = $("kpiUnits");

  const btnExport = $("btnExport");
  const btnWipe = $("btnWipe");
  const searchEl = $("search");
  const tbody = $("tbody");

  // -------------------------
  // Storage
  // -------------------------
  const STORAGE_KEY = "wvt_logs_v3";
  const MAX_LOGS = 3000;

  let audioCtx = null;

async function feedback() {
  try {
    // --- AUDIO (beep) ---
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    // iOS unlock tick (near silent)
    const unlockOsc = audioCtx.createOscillator();
    const unlockGain = audioCtx.createGain();
    unlockGain.gain.value = 0.00001;
    unlockOsc.connect(unlockGain);
    unlockGain.connect(audioCtx.destination);
    unlockOsc.start();
    unlockOsc.stop(audioCtx.currentTime + 0.02);

    // Actual confirmation beep
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    o.type = "sine";
    o.frequency.value = 880; // hospital-safe tone

    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start();
    o.stop(audioCtx.currentTime + 0.13);

    // --- HAPTIC (best effort; iOS may ignore) ---
    if (navigator.vibrate) {
      navigator.vibrate([20, 30, 20]);
    }
  } catch {
    // fail silently (hospital-safe)
  }
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(-MAX_LOGS)));
    } catch (e) {
      console.warn("saveLogs failed", e);
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isToday(iso) {
    try {
      const d = new Date(iso);
      const t = new Date();
      return (
        d.getFullYear() === t.getFullYear() &&
        d.getMonth() === t.getMonth() &&
        d.getDate() === t.getDate()
      );
    } catch {
      return false;
    }
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  // -------------------------
  // UI status (green check)
  // -------------------------
  function setScanStatus(type, msg) {
    if (!scanText || !scanDot) return;

    scanText.textContent = msg;

    const colors = {
      idle: "rgba(180,180,180,0.9)",
      info: "rgba(120,170,255,0.95)",
      ok: "rgba(90,255,160,0.95)",
      err: "rgba(255,90,90,0.95)",
    };

    scanDot.style.background = colors[type] || colors.idle;

    if (type === "ok") {
      scanDot.style.boxShadow = "0 0 12px rgba(90,255,160,0.55)";
      setTimeout(() => (scanDot.style.boxShadow = "none"), 700);
    } else if (type === "err") {
      scanDot.style.boxShadow = "0 0 12px rgba(255,90,90,0.45)";
      setTimeout(() => (scanDot.style.boxShadow = "none"), 1200);
    } else {
      scanDot.style.boxShadow = "none";
    }
  }

  function setSecurePill() {
    if (!securePill) return;
    const isSecure = location.protocol === "https:" || location.hostname === "localhost";
    securePill.textContent = isSecure ? "HTTPS: secure ✅" : "HTTPS: NOT secure ⚠️";
  }

  // -------------------------
  // Logging
  // -------------------------
  function normalize(v) {
    return String(v || "").trim();
  }

  function getFormValues() {
    return {
      unit: normalize(unitEl?.value),
      room: normalize(roomEl?.value),
      bed: normalize(bedEl?.value),
      serial: normalize(serialEl?.value),
    };
  }

  function clearForm(keepLocation = true) {
    if (!keepLocation) {
      if (unitEl) unitEl.value = "";
      if (roomEl) roomEl.value = "";
      if (bedEl) bedEl.value = "";
    }
    if (serialEl) serialEl.value = "";
    serialEl?.focus?.();
  }

  function addLogEntry({ unit, room, bed, serial, source }) {
    const s = normalize(serial);
    if (!unit || !room || !bed || !s) {
      setScanStatus("err", "Missing Unit/Room/Bed/Serial");
      return false;
    }

    const logs = loadLogs();
    logs.push({ at: nowIso(), unit, room, bed, serial: s, source: source || "manual" });
    saveLogs(logs);

    renderAll();
    setScanStatus("ok", "Logged ✅");
    showAccepted("LOGGED"); // or "ACCEPTED"
    return true;

  // -------------------------
  // Table + KPIs
  // -------------------------
  function computeKPIs(logs) {
    const total = logs.length;
    const today = logs.filter((x) => isToday(x.at)).length;
    const unitSet = new Set(logs.map((x) => x.unit).filter(Boolean));
    return { total, today, units: unitSet.size };
  }

  function matchesSearch(log, q) {
    if (!q) return true;
    const hay = `${log.unit} ${log.room} ${log.bed} ${log.serial}`.toLowerCase();
    return hay.includes(q);
  }

  function renderTable(logs) {
    if (!tbody) return;
    const q = normalize(searchEl?.value).toLowerCase();

    const filtered = logs
      .slice()
      .reverse()
      .filter((x) => matchesSearch(x, q));

    tbody.innerHTML = "";

    for (const row of filtered) {
      const tr = document.createElement("tr");

      const cells = [
        fmtTime(row.at),
        row.unit,
        row.room,
        row.bed,
        row.serial,
      ];

      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }

      const tdAct = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.className = "btn";
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => deleteRow(row));
      tdAct.appendChild(delBtn);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }

  function deleteRow(row) {
    const ok = confirm("Delete this log entry?");
    if (!ok) return;

    const logs = loadLogs();
    const idx = logs.findIndex(
      (x) =>
        x.at === row.at &&
        x.serial === row.serial &&
        x.unit === row.unit &&
        x.room === row.room &&
        x.bed === row.bed
    );
    if (idx >= 0) {
      logs.splice(idx, 1);
      saveLogs(logs);
      renderAll();
      setScanStatus("info", "Deleted");
    }
  }

  function renderKPIs(logs) {
    const { total, today, units } = computeKPIs(logs);
    if (kpiTotal) kpiTotal.textContent = String(total);
    if (kpiToday) kpiToday.textContent = String(today);
    if (kpiUnits) kpiUnits.textContent = String(units);
  }

  function renderAll() {
    const logs = loadLogs();
    renderKPIs(logs);
    renderTable(logs);
  }

  // -------------------------
  // Export / Wipe
  // -------------------------
  function escapeCsv(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function onExport() {
    const logs = loadLogs();
    if (!logs.length) {
      setScanStatus("err", "No logs to export");
      return;
    }
    const header = ["timestamp", "unit", "room", "bed", "serial", "source"];
    const rows = logs.map((x) =>
      [x.at, x.unit, x.room, x.bed, x.serial, x.source || ""].map(escapeCsv).join(",")
    );
    const csv = header.join(",") + "\n" + rows.join("\n");
    downloadText(`wound-vac-log_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    setScanStatus("ok", "Exported ✅");
  }

  function onWipe() {
    const ok = confirm("Wipe ALL local data/logs on this device?");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    renderAll();
    setScanStatus("info", "All data wiped");
    clearForm(true);
  }

  // -------------------------
  // QR Scanning via jsQR (iOS Safari friendly)
  // -------------------------
  let stream = null;
  let scanning = false;
  let rafId = null;
  let lastValue = "";
  let lastAtMs = 0;

  // Offscreen canvas for frame grabs
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function canUseJsQR() {
    return typeof window.jsQR === "function";
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API not supported");
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      throw new Error("Camera requires HTTPS");
    }
    if (!videoEl) throw new Error("Video element missing");

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    videoEl.srcObject = stream;
    await videoEl.play();
  }

  function stopCamera() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    scanning = false;

    try {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    } catch {}
    stream = null;

    if (videoEl) videoEl.srcObject = null;
  }

  function acceptDedup(v) {
    const val = normalize(v);
    if (!val) return null;

    const t = Date.now();
    if (val === lastValue && t - lastAtMs < 2500) return null;

    lastValue = val;
    lastAtMs = t;
    return val;
  }

  function haptic() {
  if (!hapticOnScan.value) return;
  try {
    if (navigator.vibrate) {
      navigator.vibrate([20, 30, 20]); // short double-tap
    }
  } catch {}
}

function beep() {
  if (!beepOnScan.value) return;

  try {
    // Create or reuse AudioContext (must be triggered after user gesture once)
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();

    // If iOS suspended it, resume (requires gesture; Start Camera click counts)
    if (audioCtx.state === "suspended") {
      audioCtx.resume?.();
    }

    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    o.type = "sine";          // clean hospital-friendly tone
    o.frequency.value = 880;  // beep pitch (Hz)

    // quick, subtle envelope
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start();
    o.stop(audioCtx.currentTime + 0.13);
  } catch {}
}

  function scanLoop() {
    if (!scanning) return;

    try {
      // Only scan when video is ready
      const w = videoEl.videoWidth || 0;
      const h = videoEl.videoHeight || 0;

      if (w > 0 && h > 0) {
        // Scale down for speed (QR works fine smaller)
        const targetW = 640;
        const scale = Math.min(1, targetW / w);
        const cw = Math.floor(w * scale);
        const ch = Math.floor(h * scale);

        canvas.width = cw;
        canvas.height = ch;

        ctx.drawImage(videoEl, 0, 0, cw, ch);
        const img = ctx.getImageData(0, 0, cw, ch);

        const result = window.jsQR(img.data, cw, ch, { inversionAttempts: "attemptBoth" });
        if (result?.data) {
          const val = acceptDedup(result.data);
          if (val) {
            if (serialEl) serialEl.value = val;
            setScanStatus("ok", "Scan accepted ✅");
            haptic();

            if (autoLogEl?.checked) {
              const fv = getFormValues();
              fv.serial = val;

              if (fv.unit && fv.room && fv.bed) {
                addLogEntry({ ...fv, source: "scan" });
              } else {
                setScanStatus("info", "Scan accepted ✅ — enter Unit/Room/Bed then Log");
              }
            }

            // brief pause to avoid re-scanning same QR instantly
            setTimeout(() => {
              if (scanning) rafId = requestAnimationFrame(scanLoop);
            }, 650);
            return;
          }
        }
      }
    } catch {
      // ignore frame errors
    }

    rafId = requestAnimationFrame(scanLoop);
  }

  async function onStartScan() {
    try {
      btnStartScan.disabled = true;
      btnStopScan.disabled = false;

      if (!canUseJsQR()) {
        setScanStatus("err", "QR scanner library not loaded. Refresh once.");
        btnStartScan.disabled = false;
        btnStopScan.disabled = true;
        return;
      }

      setScanStatus("info", "Starting camera…");
      await startCamera();

      scanning = true;
      setScanStatus("info", "Aim at QR");
      rafId = requestAnimationFrame(scanLoop);
    } catch (e) {
      console.error(e);
      stopCamera();
      btnStartScan.disabled = false;
      btnStopScan.disabled = true;

      const msg = e?.message ? e.message : String(e);
      if (/denied|permission/i.test(msg)) {
        setScanStatus("err", "Camera permission denied. Enable camera for this site in Safari settings.");
      } else {
        setScanStatus("err", `Camera failed: ${msg}`);
      }
    }
  }

  function onStopScan() {
    stopCamera();
    btnStartScan.disabled = false;
    btnStopScan.disabled = true;
    setScanStatus("idle", "Idle");
  }

  // -------------------------
  // Form handlers
  // -------------------------
  function onFormSubmit(e) {
    e.preventDefault();
    const fv = getFormValues();
    const ok = addLogEntry({ ...fv, source: "manual" });
    if (ok) clearForm(true);
  }

  function onClear() {
    clearForm(true);
    setScanStatus("info", "Cleared form");
  }

  // -------------------------
  // Init / lifecycle
  // -------------------------
  function wire() {
    setSecurePill();
    renderAll();
    setScanStatus("idle", "Idle");

    btnStartScan?.addEventListener("click", onStartScan);
    btnStopScan?.addEventListener("click", onStopScan);

    logForm?.addEventListener("submit", onFormSubmit);
    btnClear?.addEventListener("click", onClear);

    btnExport?.addEventListener("click", onExport);
    btnWipe?.addEventListener("click", onWipe);

    searchEl?.addEventListener("input", () => renderAll());

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        try { onStopScan(); } catch {}
      }
    });

    window.addEventListener("pagehide", () => {
      try { stopCamera(); } catch {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
