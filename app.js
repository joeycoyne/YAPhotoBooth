const STORAGE_KEY = "yaphotobooth.selectedCameraId";
const PHOTO_COUNT = 4;
const INITIAL_COUNTDOWN_SECONDS = 4;
const BETWEEN_PHOTO_SECONDS = 3;

const preview = document.getElementById("preview");
const cameraSelect = document.getElementById("cameraSelect");
const useCameraButton = document.getElementById("useCameraButton");
const refreshButton = document.getElementById("refreshButton");
const previewMessage = document.getElementById("previewMessage");
const statusBadge = document.getElementById("statusBadge");
const detailText = document.getElementById("detailText");
const effectChips = [...document.querySelectorAll(".effect-chip")];
const recentSession = document.getElementById("recentSession");
const recentEmptyText = document.getElementById("recentEmptyText");
const takePhotosButton = document.getElementById("takePhotosButton");
const countdownOverlay = document.getElementById("countdownOverlay");
const countdownLabel = document.getElementById("countdownLabel");
const countdownNumber = document.getElementById("countdownNumber");
const flashOverlay = document.getElementById("flashOverlay");

let activeStream = null;
let videoDevices = [];
let isCapturing = false;
let latestSession = [];

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
  effectChips.forEach((chip) => {
    chip.disabled = !enabled;
  });
}

function stopActiveStream() {
  if (!activeStream) return;
  activeStream.getTracks().forEach((track) => track.stop());
  activeStream = null;
  preview.srcObject = null;
  setCaptureControlsEnabled(false);
}

async function ensurePermission() {
  // Camera labels/device IDs are restricted until camera permission is granted.
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

    // Verify Chrome actually gave us the requested device.
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
      `Locked to: ${selected?.label || "selected camera"}`;
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

function selectEffectChip(chip) {
  if (isCapturing) return;
  effectChips.forEach((item) => item.classList.toggle("selected", item === chip));
}

function renderRecentSession(imageUrls = []) {
  recentSession.innerHTML = "";

  for (let index = 0; index < PHOTO_COUNT; index += 1) {
    const slot = document.createElement("div");
    slot.className = "recent-photo";

    if (imageUrls[index]) {
      const image = document.createElement("img");
      image.src = imageUrls[index];
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

  recentEmptyText.hidden = imageUrls.length > 0;
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
  // Force a reflow so the animation restarts for every shot.
  void flashOverlay.offsetWidth;
  flashOverlay.classList.add("flash");
}

function captureCurrentFrame() {
  if (!preview.videoWidth || !preview.videoHeight) {
    throw new Error("The camera preview is not ready to capture.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;

  const context = canvas.getContext("2d");
  context.drawImage(preview, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.92);
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

      const image = captureCurrentFrame();
      newSession.push(image);
      triggerFlash();

      setStatus(`Photo ${index + 1} / ${PHOTO_COUNT}`, "ready");
    }

    latestSession = newSession;
    renderRecentSession(latestSession);
    setStatus("Session complete", "ready");
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

effectChips.forEach((chip) => {
  chip.addEventListener("click", () => selectEffectChip(chip));
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  refreshCameras({ requestPermission: false });
});

window.addEventListener("beforeunload", stopActiveStream);

renderRecentSession([]);
refreshCameras({ requestPermission: true });
