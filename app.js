/* Wound Vac Tracker (PHI-Free) — Safari-safe (NO modules / NO imports)
   Works with your provided index.html IDs.
   Features:
   - Rear camera start/stop
   - BarcodeDetector scanning when supported
   - Green "accepted" status + fills Serial input
   - Optional auto-log after scan
   - Manual log form + clear
   - LocalStorage logs, dashboard KPIs, table, search, export CSV, wipe
*/

(() => {
  "use strict";

  // -------------------------
  // DOM helpers
  // -------------------------
  const $ = (id) => document.getElementById(id);

  // Elements (from your HTML)
  const securePill = $("securePill");

  const btnStartScan = $("btnStartScan");
  const btnStopScan = $("btnStopScan");
  const videoEl = $("video");

  const scanStatus = $("scanStatus");
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
  const STORAGE_KEY = "wvt_logs_v2"; // bump version safely
  const MAX_LOGS = 3000;

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
    // type: idle | info | ok | err
    // You have .dot and text; we'll color dot via inline style to avoid CSS dependency
    if (!scanText || !scanDot) return;

    scanText.textContent = msg;

    const colors = {
      idle: "rgba(180,180,180,0.9)",
      info: "rgba(120,170,255,0.95)",
      ok: "rgba(90,255,160,0.95)",
      err: "rgba(255,90,90,0.95)",
    };

    scanDot.style.background = colors[type] || colors.idle;

    // Optional: subtle pulse on ok
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
    securePill.style.opacity = "1";
  }

  // -------------------------
  // Logging
  // -------------------------
  function normalizeSerial(v) {
    return String(v || "").trim();
  }

  function getFormValues() {
    return {
      unit: String(unitEl?.value || "").trim(),
      room: String(roomEl?.value || "").trim(),
      bed: String(bedEl?.value || "").trim(),
      serial: normalizeSerial(serialEl?.value),
    };
  }

  function clearForm(keepLocation = true) {
    if (!keepLocation) {
      if (unitEl) unitEl.value = "";
      if (roomEl) roomEl.value = "";
      if (bedEl) bedEl.value = "";
    }
    if (serialEl) serialEl.value = "";
    if (serialEl) serialEl.focus();
  }

  function addLogEntry({ unit, room, bed, serial, source }) {
    const cleanSerial = normalizeSerial(serial);
    if (!unit || !room || !bed || !cleanSerial) {
      setScanStatus("err", "Missing Unit/Room/Bed/Serial");
      return false;
    }

    const logs = loadLogs();
    logs.push({
      at: nowIso(),
      unit,
      room,
      bed,
      serial: cleanSerial,
      source: source || "manual",
    });
    saveLogs(logs);

    renderAll();
    setScanStatus("ok", "Logged ✅");
    return true;
  }

  // -------------------------
  // Table + KPIs
  // -------------------------
  function computeKPIs(logs) {
    const total = logs.length;
    const today = logs.filter((x) => isToday(x.at)).length;

    const unitSet = new Set();
    for (const x of logs) {
      if (x.unit) unitSet.add(x.unit);
    }
    const units = unitSet.size;

    return { total, today, units };
  }

  function matchesSearch(log, q) {
    if (!q) return true;
    const hay = `${log.unit} ${log.room} ${log.bed} ${log.serial}`.toLowerCase();
    return hay.includes(q);
  }

  function renderTable(logs) {
    if (!tbody) return;
    const q = String(searchEl?.value || "").trim().toLowerCase();

    // newest first
    const filtered = logs
      .slice()
      .reverse()
      .filter((x) => matchesSearch(x, q));

    tbody.innerHTML = "";

    for (const row of filtered) {
      const tr = document.createElement("tr");

      const tdTime = document.createElement("td");
      tdTime.textContent = fmtTime(row.at);

      const tdUnit = document.createElement("td");
      tdUnit.textContent = row.unit;

      const tdRoom = document.createElement("td");
      tdRoom.textContent = row.room;

      const tdBed = document.createElement("td");
      tdBed.textContent = row.bed;

      const tdSerial = document.createElement("td");
      tdSerial.textContent = row.serial;

      const tdAct = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.className = "btn";
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => deleteRow(row));
      tdAct.appendChild(delBtn);

      tr.appendChild(tdTime);
      tr.appendChild(tdUnit);
      tr.appendChild(tdRoom);
      tr.appendChild(tdBed);
      tr.appendChild(tdSerial);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }

  function deleteRow(row) {
    const ok = confirm("Delete this log entry?");
    if (!ok) return;

    const logs = loadLogs();
    // match by timestamp + serial + location for safety
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
      [
        x.at,
        x.unit,
        x.room,
        x.bed,
        x.serial,
        x.source || "",
      ].map(escapeCsv).join(",")
    );

    const csv = header.join(",") + "\n" + rows.join("\n");
    const filename = `wound-vac-log_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadText(filename, csv);
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
  // Scanning (Safari-safe)
  // -------------------------
  let stream = null;
  let track = null;
  let detector = null;
  let scanning = false;
  let rafId = null;

  // Deduping
  let lastRaw = "";
  let lastAtMs = 0;

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
    "pdf417",
  ];

  function canScan() {
    return "BarcodeDetector" in window;
  }

  async function buildDetector() {
    // Safari variations: getSupportedFormats may not exist
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats?.();
      const formats =
        Array.isArray(supported) && supported.length
          ? PREFERRED_FORMATS.filter((f) => supported.includes(f))
          : PREFERRED_FORMATS;

      return new window.BarcodeDetector({ formats: formats.length ? formats : PREFERRED_FORMATS });
    } catch {
      // fallback
      return new window.BarcodeDetector();
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API not supported");
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      throw new Error("Camera requires HTTPS");
    }
    if (!videoEl) throw new Error("Video element missing");

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play();

    track = stream.getVideoTracks?.()[0] || null;
  }

  function stopCamera() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    scanning = false;

    try {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch {}

    stream = null;
    track = null;

    if (videoEl) videoEl.srcObject = null;
  }

  function acceptDedup(raw) {
    const v = normalizeSerial(raw);
    if (!v) return null;

    const t = Date.now();
    if (v === lastRaw && t - lastAtMs < 2500) return null;

    lastRaw = v;
    lastAtMs = t;
    return v;
  }

  async function scanLoop() {
    if (!scanning) return;

    try {
      const codes = await detector.detect(videoEl);
      if (codes && codes.length) {
        const raw = codes[0].rawValue || codes[0].data || "";
        const v = acceptDedup(raw);
        if (v) {
          // Fill serial field
          if (serialEl) serialEl.value = v;

          setScanStatus("ok", "Scan accepted ✅");

          // Auto-log if checked and form has required fields
          if (autoLogEl?.checked) {
            const fv = getFormValues();
            // serial already set from scan
            fv.serial = v;
            // only auto-log if the location fields exist
            if (fv.unit && fv.room && fv.bed) {
              addLogEntry({ ...fv, source: "scan" });
            } else {
              // Prompt user to complete location
              setScanStatus("info", "Scan accepted ✅ — enter Unit/Room/Bed then Log");
            }
          }
        }
      }
    } catch {
      // Ignore per-frame errors; Safari can throw occasionally on detect()
    }

    rafId = requestAnimationFrame(scanLoop);
  }

  async function onStartScan() {
    try {
      btnStartScan.disabled = true;
      btnStopScan.disabled = false;

      if (!canScan()) {
        setScanStatus("err", "Scanner not supported on this iPhone/Safari. Use manual entry.");
        // Still show camera preview if you want:
        await startCamera();
        return;
      }

      setScanStatus("info", "Starting camera…");
      detector = await buildDetector();
      await startCamera();

      scanning = true;
      setScanStatus("info", "Aim at barcode / QR");
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
    if (ok) {
      // keep Unit/Room/Bed to speed repeated logging
      clearForm(true);
    }
  }

  function onClear() {
    clearForm(true);
    setScanStatus("info", "Cleared form");
  }

  // -------------------------
  // App init / lifecycle
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

    // Stop camera if tab is backgrounded
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        try { onStopScan(); } catch {}
      }
    });

    // If user reloads with camera running (rare), ensure stopped
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
