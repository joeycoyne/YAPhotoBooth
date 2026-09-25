# YAPhotoBooth

Yet Another Photo Booth — an offline-first Chromebook photo booth designed for touchscreen use and an external USB camera.

## v0.1 goal

Prove the Chromebook camera path before building the full booth:

- enumerate all video cameras
- allow an adult to select the intended USB camera
- remember that camera choice
- use the selected camera by exact device ID
- refuse to silently fall back to another camera if the selected camera is unavailable
- provide a large touchscreen-friendly live preview

## Test

1. Open the app in Chrome on the Chromebook.
2. Allow camera permission.
3. Connect the USB webcam.
4. Tap **Refresh cameras** if necessary.
5. Select the USB camera.
6. Tap **Use this camera**.
7. Reload the page and verify the same camera is selected automatically.
8. Unplug the USB camera and reload. The app should show a camera-unavailable message instead of using the Chromebook lid camera.

The photo-strip flow, local gallery, PWA/offline packaging, and effects will be added after this milestone is proven on the actual Chromebook.
