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

    const name = err?.name || "UnknownError";
    const msg  = err?.message || "";
    const hint =
      name === "NotAllowedError" ? "Permission blocked (Safari/Screen Time/MDM)." :
      name === "NotReadableError" ? "Camera is in use by another app or Safari bug (force-close Camera/FaceTime/Instagram, then restart iPhone if needed)." :
      name === "AbortError" ? "Safari glitch. Reload or force-close Safari." :
      name === "OverconstrainedError" ? "Constraint issue. We will relax constraints." :
      "Unknown. We'll adjust based on this name.";

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
