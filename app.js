const STORAGE_KEY = "yaphotobooth.selectedCameraId";
const PHOTO_COUNT = 4;
const INITIAL_COUNTDOWN_SECONDS = 4;
const BETWEEN_PHOTO_SECONDS = 3;

const DB_NAME = "YAPhotoBoothDB";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";

const FILTERS = {
  normal: { css: "none", canvas: "none" },
  bw: { css: "grayscale(1) contrast(1.08)", canvas: "grayscale(1) contrast(1.08)" },
  pop: { css: "saturate(1.65) contrast(1.12)", canvas: "saturate(1.65) contrast(1.12)" },
  warm: { css: "sepia(0.22) saturate(1.25) hue-rotate(-8deg)", canvas: "sepia(0.22) saturate(1.25) hue-rotate(-8deg)" },
};

const preview = document.getElementById("preview");
const cameraSelect = document.getElementById("cameraSelect");
const useCameraButton = document.getElementById("useCameraButton");
const refreshButton = document.getElementById("refreshButton");
const previewMessage = document.getElementById("previewMessage");
const statusBadge = document.getElementById("statusBadge");
const detailText = document.getElementById("detailText");
const filterChips = [...document.querySelectorAll(".filter-chip")];
const stickerChips = [...document.querySelectorAll(".sticker-chip")];
const clearStickersButton = document.getElementById("clearStickersButton");
const recentSession = document.getElementById("recentSession");
const recentEmptyText = document.getElementById("recentEmptyText");
const takePhotosButton = document.getElementById("takePhotosButton");
const countdownOverlay = document.getElementById("countdownOverlay");
const countdownLabel = document.getElementById("countdownLabel");
const countdownNumber = document.getElementById("countdownNumber");
const flashOverlay = document.getElementById("flashOverlay");
const crownSticker = document.getElementById("crownSticker");
const sunglassesSticker = document.getElementById("sunglassesSticker");
const birthdaySticker = document.getElementById("birthdaySticker");
const balloonBorder = document.getElementById("balloonBorder");
const confettiBorder = document.getElementById("confettiBorder");
const starBorder = document.getElementById("starBorder");

let activeStream = null;
let videoDevices = [];
let isCapturing = false;
let selectedFilter = "normal";
let selectedStickers = new Set();
let recentObjectUrls = [];
let dbPromise = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStatus(text, kind = "") {
  statusBadge.textContent = text;
  statusBadge.className = "status-badge";
  if (kind) statusBadge.classList.add(kind);
}

function showPreviewMessage(title, message) {
  previewMessage.innerHTML = `
    <div>
      <h2>${title}</h2>
      <p>${message}</p>
    </div>
  `;
  previewMessage.classList.remove("hidden");
}

function hidePreviewMessage() {
  previewMessage.classList.add("hidden");
}

function setCaptureControlsEnabled(enabled) {
  takePhotosButton.disabled = !enabled;
  filterChips.forEach((chip) => {
    chip.disabled = !enabled;
  });
  stickerChips.forEach((chip) => {
    chip.disabled = !enabled;
  });
  clearStickersButton.disabled = !enabled;
}

function stopActiveStream() {
  if (!activeStream) return;
  activeStream.getTracks().forEach((track) => track.stop());
  activeStream = null;
  preview.srcObject = null;
  setCaptureControlsEnabled(false);
}

async function ensurePermission() {
  const permissionStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });

  permissionStream.getTracks().forEach((track) => track.stop());
}

async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
}

function populateCameraList(devices) {
  cameraSelect.innerHTML = "";

  if (!devices.length) {
    const option = document.createElement("option");
    option.textContent = "No cameras detected";
    option.value = "";
    cameraSelect.appendChild(option);
    useCameraButton.disabled = true;
    return;
  }

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;
    cameraSelect.appendChild(option);
  });

  useCameraButton.disabled = false;

  const savedId = localStorage.getItem(STORAGE_KEY);
  if (savedId && devices.some((device) => device.deviceId === savedId)) {
    cameraSelect.value = savedId;
  }
}

async function refreshCameras({ requestPermission = false } = {}) {
  if (isCapturing) return;

  setStatus("Checking…");
  refreshButton.disabled = true;
  useCameraButton.disabled = true;
  setCaptureControlsEnabled(false);

  try {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
      throw new Error("This browser does not support the required camera APIs.");
    }

    if (requestPermission) {
      await ensurePermission();
    }

    videoDevices = await getVideoDevices();
    populateCameraList(videoDevices);

    const savedId = localStorage.getItem(STORAGE_KEY);
    const savedCameraPresent =
      savedId && videoDevices.some((device) => device.deviceId === savedId);

    if (savedId && !savedCameraPresent) {
      stopActiveStream();
      setStatus("Camera missing", "error");
      showPreviewMessage(
        "Photo booth camera disconnected",
        "The saved camera is not available. Reconnect it or choose another camera."
      );
      detailText.textContent =
        "The app will not silently switch to another camera.";
      return;
    }

    if (savedCameraPresent) {
      cameraSelect.value = savedId;
      await startExactCamera(savedId, false);
      return;
    }

    setStatus(
      videoDevices.length ? "Choose camera" : "No camera",
      videoDevices.length ? "" : "error"
    );
    showPreviewMessage(
      videoDevices.length ? "Choose the photo booth camera" : "No cameras detected",
      videoDevices.length
        ? "Select the USB camera below, then tap “Use this camera.”"
        : "Connect a camera, then tap “Refresh cameras.”"
    );
    detailText.textContent = videoDevices.length
      ? `${videoDevices.length} camera${videoDevices.length === 1 ? "" : "s"} detected.`
      : "No video-input devices are currently available.";
  } catch (error) {
    console.error(error);
    stopActiveStream();
    setStatus("Camera error", "error");
    showPreviewMessage("Camera access failed", error.message || String(error));
    detailText.textContent =
      "Check Chrome camera permission and make sure another app is not using the webcam.";
  } finally {
    refreshButton.disabled = false;
    useCameraButton.disabled = !cameraSelect.value;
  }
}

async function startExactCamera(deviceId, saveChoice = true) {
  if (!deviceId || isCapturing) return;

  stopActiveStream();
  setStatus("Starting…");
  showPreviewMessage("Starting camera", "One moment…");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();

    if (settings.deviceId && settings.deviceId !== deviceId) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Chrome opened a different camera than the one selected.");
    }

    activeStream = stream;
    preview.srcObject = stream;
    await preview.play();

    if (saveChoice) {
      localStorage.setItem(STORAGE_KEY, deviceId);
    }

    const selected = videoDevices.find((device) => device.deviceId === deviceId);
    setStatus("Camera ready", "ready");
    hidePreviewMessage();
    setCaptureControlsEnabled(true);
    detailText.textContent =
      `Locked to: ${selected?.label || "selected camera"} · Photos save locally on this Chromebook.`;
  } catch (error) {
    console.error(error);
    stopActiveStream();
    setStatus("Camera unavailable", "error");

    if (saveChoice) {
      localStorage.setItem(STORAGE_KEY, deviceId);
    }

    showPreviewMessage(
      "Selected camera unavailable",
      "YAPhotoBooth did not switch to another camera."
    );
    detailText.textContent =
      error.name === "OverconstrainedError" || error.name === "NotFoundError"
        ? "Reconnect the selected camera, then tap “Refresh cameras.”"
        : (error.message || String(error));
  }
}

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function saveSession(photos, filter, stickers) {
  const db = await openDatabase();
  const renderedPhotos = await Promise.all(
    photos.map((photo) => photo.arrayBuffer())
  );
  const record = {
    id: Date.now(),
    formatVersion: 2,
    createdAt: new Date().toISOString(),
    filter,
    stickers: [...stickers],
    renderedPhotos,
  };

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, "readwrite");
    const store = transaction.objectStore(SESSION_STORE);
    store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  return record;
}

async function getLatestSession() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, "readonly");
    const store = transaction.objectStore(SESSION_STORE);
    const request = store.openCursor(null, "prev");

    request.onsuccess = () => {
      resolve(request.result ? request.result.value : null);
    };
    request.onerror = () => reject(request.error);
  });
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch (error) {
    console.warn("Persistent storage request was not available:", error);
  }
}

function updateLiveEffects() {
  const filter = FILTERS[selectedFilter] || FILTERS.normal;
  preview.style.filter = filter.css;

  crownSticker.classList.toggle("hidden", !selectedStickers.has("crown"));
  sunglassesSticker.classList.toggle("hidden", !selectedStickers.has("sunglasses"));
  birthdaySticker.classList.toggle("hidden", !selectedStickers.has("gianna"));
  balloonBorder.classList.toggle("hidden", !selectedStickers.has("balloons"));
  confettiBorder.classList.toggle("hidden", !selectedStickers.has("confetti"));
  starBorder.classList.toggle("hidden", !selectedStickers.has("stars"));
}

function selectFilter(chip) {
  if (isCapturing) return;
  selectedFilter = chip.dataset.filter || "normal";

  filterChips.forEach((item) => {
    item.classList.toggle("selected", item === chip);
  });

  updateLiveEffects();
}

function toggleSticker(chip) {
  if (isCapturing) return;

  const sticker = chip.dataset.sticker;
  if (!sticker) return;

  if (selectedStickers.has(sticker)) {
    selectedStickers.delete(sticker);
  } else {
    selectedStickers.add(sticker);
  }

  const selected = selectedStickers.has(sticker);
  chip.classList.toggle("selected", selected);
  chip.setAttribute("aria-pressed", String(selected));
  updateLiveEffects();
}

function clearStickers() {
  if (isCapturing) return;

  selectedStickers.clear();
  stickerChips.forEach((chip) => {
    chip.classList.remove("selected");
    chip.setAttribute("aria-pressed", "false");
  });
  updateLiveEffects();
}

function clearRecentObjectUrls() {
  recentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  recentObjectUrls = [];
}

function renderRecentSession(photos = []) {
  clearRecentObjectUrls();
  recentSession.innerHTML = "";

  for (let index = 0; index < PHOTO_COUNT; index += 1) {
    const slot = document.createElement("div");
    slot.className = "recent-photo";

    if (photos[index]) {
      const image = document.createElement("img");
      const source =
        photos[index] instanceof Blob
          ? URL.createObjectURL(photos[index])
          : photos[index];

      if (photos[index] instanceof Blob) {
        recentObjectUrls.push(source);
      }

      image.src = source;
      image.alt = `Most recent session photo ${index + 1}`;
      slot.appendChild(image);
    } else {
      slot.classList.add("empty");
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      slot.appendChild(number);
    }

    recentSession.appendChild(slot);
  }

  recentEmptyText.hidden = photos.length > 0;
}

function getStoredSessionPhotos(session) {
  if (session?.renderedPhotos?.length) {
    return session.renderedPhotos.map(
      (bytes) => new Blob([bytes], { type: "image/jpeg" })
    );
  }

  // Backward compatibility with v0.4 sessions.
  if (session?.photos?.length) {
    return session.photos;
  }

  return [];
}

async function restoreLatestSession() {
  try {
    const session = await getLatestSession();
    renderRecentSession(getStoredSessionPhotos(session));
  } catch (error) {
    console.warn("Could not restore the latest photo session:", error);
    renderRecentSession([]);
  }
}

async function runCountdown(seconds, label) {
  countdownLabel.textContent = label;
  countdownOverlay.classList.remove("hidden");

  for (let count = seconds; count >= 1; count -= 1) {
    countdownNumber.textContent = String(count);
    await delay(1000);
  }

  countdownOverlay.classList.add("hidden");
}

function triggerFlash() {
  flashOverlay.classList.remove("flash");
  void flashOverlay.offsetWidth;
  flashOverlay.classList.add("flash");
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}


function drawStar(context, cx, cy, outerRadius, innerRadius) {
  context.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (point === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

function drawBalloon(context, cx, cy, radius, color) {
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.ellipse(cx, cy, radius * 0.82, radius, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(255,255,255,0.55)";
  context.lineWidth = Math.max(2, radius * 0.06);
  context.stroke();

  context.fillStyle = color;
  context.beginPath();
  context.moveTo(cx, cy + radius);
  context.lineTo(cx - radius * 0.16, cy + radius * 1.18);
  context.lineTo(cx + radius * 0.16, cy + radius * 1.18);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(255,255,255,0.72)";
  context.lineWidth = Math.max(1.5, radius * 0.035);
  context.beginPath();
  context.moveTo(cx, cy + radius * 1.18);
  context.quadraticCurveTo(cx + radius * 0.35, cy + radius * 2.0, cx, cy + radius * 2.7);
  context.stroke();
  context.restore();
}

function drawEdgeDecorations(context, width, height, stickers) {
  const marginX = width * 0.055;
  const marginY = height * 0.08;

  if (stickers.has("balloons")) {
    const r = Math.max(26, height * 0.065);
    drawBalloon(context, marginX, marginY, r, "#ec4899");
    drawBalloon(context, width - marginX, marginY, r, "#3b82f6");
    drawBalloon(context, marginX, height - marginY * 1.1, r, "#8b5cf6");
    drawBalloon(context, width - marginX, height - marginY * 1.1, r, "#f59e0b");
  }

  if (stickers.has("confetti")) {
    const pieces = [
      [0.04,0.08,18,"#f59e0b"], [0.95,0.12,-28,"#22c55e"],
      [0.025,0.42,63,"#ec4899"], [0.975,0.37,-61,"#3b82f6"],
      [0.07,0.92,-15,"#8b5cf6"], [0.93,0.90,28,"#ef4444"],
      [0.02,0.22,42,"#06b6d4"], [0.98,0.73,-36,"#facc15"],
      [0.16,0.025,52,"#ef4444"], [0.82,0.025,-44,"#a855f7"],
      [0.14,0.975,-24,"#14b8a6"], [0.84,0.975,31,"#fb7185"],
    ];
    const pieceW = Math.max(8, width * 0.009);
    const pieceH = Math.max(16, height * 0.035);
    for (const [px, py, degrees, color] of pieces) {
      context.save();
      context.translate(width * px, height * py);
      context.rotate((degrees * Math.PI) / 180);
      context.fillStyle = color;
      context.fillRect(-pieceW / 2, -pieceH / 2, pieceW, pieceH);
      context.restore();
    }
  }

  if (stickers.has("stars")) {
    const positions = [
      [0.05,0.08], [0.95,0.08], [0.04,0.92], [0.96,0.92],
      [0.02,0.48], [0.98,0.48]
    ];
    const outer = Math.max(20, height * 0.045);
    context.fillStyle = "#fde047";
    context.strokeStyle = "rgba(0,0,0,0.35)";
    context.lineWidth = Math.max(2, outer * 0.08);
    for (const [px, py] of positions) {
      drawStar(context, width * px, height * py, outer, outer * 0.45);
      context.fill();
      context.stroke();
    }
  }
}

function drawStickers(context, width, height, stickers) {
  context.save();
  context.filter = "none";
  context.textAlign = "center";
  context.textBaseline = "middle";

  if (stickers.has("crown")) {
    context.font = `${Math.round(height * 0.18)}px "Noto Color Emoji", "Segoe UI Emoji", sans-serif`;
    context.fillText("👑", width * 0.5, height * 0.15 - 10);
  }

  if (stickers.has("sunglasses")) {
    context.font = `${Math.round(height * 0.16)}px "Noto Color Emoji", "Segoe UI Emoji", sans-serif`;
    context.fillText("🕶️", width * 0.5, height * 0.43);
  }

  if (stickers.has("gianna")) {
    const text = "Gianna's 11th!";
    const fontSize = Math.max(34, Math.round(height * 0.075));
    context.font = `900 ${fontSize}px system-ui, sans-serif`;

    const metrics = context.measureText(text);
    const paddingX = fontSize * 0.5;
    const paddingY = fontSize * 0.24;
    const bannerWidth = Math.min(width * 0.74, metrics.width + paddingX * 2);
    const bannerHeight = fontSize + paddingY * 2;
    const x = width * 0.035;
    const y = height - bannerHeight - height * 0.045;

    context.fillStyle = "rgba(124, 58, 237, 0.90)";
    drawRoundedRect(context, x, y, bannerWidth, bannerHeight, bannerHeight / 2);
    context.fill();

    context.lineWidth = Math.max(3, fontSize * 0.06);
    context.strokeStyle = "rgba(255,255,255,0.92)";
    context.stroke();

    context.fillStyle = "#ffffff";
    context.textAlign = "left";
    context.fillText(
      text,
      x + paddingX,
      y + bannerHeight / 2 + fontSize * 0.02
    );
    context.textAlign = "center";
  }

  drawEdgeDecorations(context, width, height, stickers);
  context.restore();
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode the captured photo."));
      },
      "image/jpeg",
      0.92
    );
  });
}

async function captureCurrentFrame(filterName, stickers) {
  if (!preview.videoWidth || !preview.videoHeight) {
    throw new Error("The camera preview is not ready to capture.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;

  const context = canvas.getContext("2d");
  const filter = FILTERS[filterName] || FILTERS.normal;

  context.filter = filter.canvas;
  context.drawImage(preview, 0, 0, canvas.width, canvas.height);
  drawStickers(context, canvas.width, canvas.height, stickers);

  return canvasToJpegBlob(canvas);
}

async function capturePhotoSession() {
  if (isCapturing || !activeStream) return;

  isCapturing = true;
  setCaptureControlsEnabled(false);
  useCameraButton.disabled = true;
  refreshButton.disabled = true;
  cameraSelect.disabled = true;
  setStatus("Photo session");
  takePhotosButton.textContent = "Taking photos…";

  const sessionFilter = selectedFilter;
  const sessionStickers = new Set(selectedStickers);
  const newSession = [];

  try {
    for (let index = 0; index < PHOTO_COUNT; index += 1) {
      const countdownSeconds =
        index === 0 ? INITIAL_COUNTDOWN_SECONDS : BETWEEN_PHOTO_SECONDS;
      const label =
        index === 0
          ? "Get ready!"
          : `Photo ${index + 1} of ${PHOTO_COUNT}`;

      await runCountdown(countdownSeconds, label);

      const imageBlob = await captureCurrentFrame(sessionFilter, sessionStickers);
      newSession.push(imageBlob);
      triggerFlash();

      setStatus(`Photo ${index + 1} / ${PHOTO_COUNT}`, "ready");
    }

    renderRecentSession(newSession);

    try {
      await saveSession(newSession, sessionFilter, sessionStickers);
      const persistedSession = await getLatestSession();
      renderRecentSession(getStoredSessionPhotos(persistedSession));
      setStatus("Saved locally", "ready");
      detailText.textContent = "Session saved as flattened JPEG data on this Chromebook.";
    } catch (storageError) {
      console.error("Photo storage failed:", storageError);
      setStatus("Photos not saved", "error");
      detailText.textContent = "The photos were captured, but browser storage failed.";
    }

    takePhotosButton.textContent = "Take Photos";
  } catch (error) {
    console.error(error);
    setStatus("Capture error", "error");
    showPreviewMessage("Photo session stopped", error.message || String(error));
  } finally {
    countdownOverlay.classList.add("hidden");
    isCapturing = false;
    cameraSelect.disabled = false;
    refreshButton.disabled = false;
    useCameraButton.disabled = !cameraSelect.value;

    if (activeStream) {
      hidePreviewMessage();
      setCaptureControlsEnabled(true);
      if (takePhotosButton.textContent !== "Take Photos") {
        takePhotosButton.textContent = "Take Photos";
      }
    }
  }
}

useCameraButton.addEventListener("click", () => {
  startExactCamera(cameraSelect.value, true);
});

refreshButton.addEventListener("click", () => {
  refreshCameras({ requestPermission: true });
});

takePhotosButton.addEventListener("click", capturePhotoSession);

filterChips.forEach((chip) => {
  chip.addEventListener("click", () => selectFilter(chip));
});

stickerChips.forEach((chip) => {
  chip.addEventListener("click", () => toggleSticker(chip));
});

clearStickersButton.addEventListener("click", clearStickers);

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  refreshCameras({ requestPermission: false });
});

window.addEventListener("beforeunload", () => {
  stopActiveStream();
  clearRecentObjectUrls();
});

updateLiveEffects();
requestPersistentStorage();
restoreLatestSession();
refreshCameras({ requestPermission: true });
