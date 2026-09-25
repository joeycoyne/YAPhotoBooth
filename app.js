const STORAGE_KEY = "yaphotobooth.selectedCameraId";

const preview = document.getElementById("preview");
const cameraSelect = document.getElementById("cameraSelect");
const useCameraButton = document.getElementById("useCameraButton");
const refreshButton = document.getElementById("refreshButton");
const previewMessage = document.getElementById("previewMessage");
const statusBadge = document.getElementById("statusBadge");
const detailText = document.getElementById("detailText");

let activeStream = null;
let videoDevices = [];

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

function stopActiveStream() {
  if (!activeStream) return;
  activeStream.getTracks().forEach((track) => track.stop());
  activeStream = null;
  preview.srcObject = null;
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
  setStatus("Checking…");
  refreshButton.disabled = true;
  useCameraButton.disabled = true;

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

    setStatus(videoDevices.length ? "Choose camera" : "No camera", videoDevices.length ? "" : "error");
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
  if (!deviceId) return;

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

useCameraButton.addEventListener("click", () => {
  startExactCamera(cameraSelect.value, true);
});

refreshButton.addEventListener("click", () => {
  refreshCameras({ requestPermission: true });
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  refreshCameras({ requestPermission: false });
});

window.addEventListener("beforeunload", stopActiveStream);

refreshCameras({ requestPermission: true });
