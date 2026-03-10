const MIN_OUTPUT_EDGE = 1;
const MAX_OUTPUT_EDGE = 6000;
const MIN_CROP_EDGE = 10;
const PREVIEW_PADDING = 32;

const presets = {
  clean: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
  portrait: { brightness: 8, contrast: 10, saturation: 8, temperature: 7 },
  sunset: { brightness: 6, contrast: 18, saturation: 24, temperature: 20 },
  mono: { brightness: 12, contrast: -10, saturation: -100, temperature: 0 },
  cool: { brightness: -4, contrast: 14, saturation: 10, temperature: -16 },
};

const state = {
  fileName: "",
  originalFormat: "",
  originalWidth: 0,
  originalHeight: 0,
  originalCanvas: document.createElement("canvas"),
  crop: { x: 0, y: 0, width: 0, height: 0 },
  rotation: 0,
  outputWidth: 0,
  outputHeight: 0,
  aspectLock: true,
  sizeTouched: false,
  cropMode: false,
  activePreset: "clean",
  adjustments: { ...presets.clean },
  renderQueued: false,
  displayImageRect: null,
  cropInteraction: null,
};

const refs = {
  uploadInput: document.querySelector("#uploadInput"),
  dropzone: document.querySelector("#dropzone"),
  previewStage: document.querySelector("#previewStage"),
  previewCanvas: document.querySelector("#previewCanvas"),
  stagePlaceholder: document.querySelector("#stagePlaceholder"),
  cropOverlay: document.querySelector("#cropOverlay"),
  cropBox: document.querySelector("#cropBox"),
  statusText: document.querySelector("#statusText"),
  modeText: document.querySelector("#modeText"),
  modeChip: document.querySelector("#modeChip"),
  dimensionChip: document.querySelector("#dimensionChip"),
  fileNameText: document.querySelector("#fileNameText"),
  originalDimensionText: document.querySelector("#originalDimensionText"),
  originalFormatText: document.querySelector("#originalFormatText"),
  sourceSummary: document.querySelector("#sourceSummary"),
  adjustmentSummary: document.querySelector("#adjustmentSummary"),
  exportSummary: document.querySelector("#exportSummary"),
  resetAllBtn: document.querySelector("#resetAllBtn"),
  rotateLeftBtn: document.querySelector("#rotateLeftBtn"),
  rotateRightBtn: document.querySelector("#rotateRightBtn"),
  resetRotationBtn: document.querySelector("#resetRotationBtn"),
  rotationInput: document.querySelector("#rotationInput"),
  rotationValue: document.querySelector("#rotationValue"),
  outputWidthInput: document.querySelector("#outputWidthInput"),
  outputHeightInput: document.querySelector("#outputHeightInput"),
  aspectLockInput: document.querySelector("#aspectLockInput"),
  syncSizeBtn: document.querySelector("#syncSizeBtn"),
  toggleCropModeBtn: document.querySelector("#toggleCropModeBtn"),
  resetCropBtn: document.querySelector("#resetCropBtn"),
  cropXInput: document.querySelector("#cropXInput"),
  cropYInput: document.querySelector("#cropYInput"),
  cropWidthInput: document.querySelector("#cropWidthInput"),
  cropHeightInput: document.querySelector("#cropHeightInput"),
  brightnessInput: document.querySelector("#brightnessInput"),
  contrastInput: document.querySelector("#contrastInput"),
  saturationInput: document.querySelector("#saturationInput"),
  temperatureInput: document.querySelector("#temperatureInput"),
  brightnessValue: document.querySelector("#brightnessValue"),
  contrastValue: document.querySelector("#contrastValue"),
  saturationValue: document.querySelector("#saturationValue"),
  temperatureValue: document.querySelector("#temperatureValue"),
  presetButtons: [...document.querySelectorAll("[data-preset]")],
  exportFormatInput: document.querySelector("#exportFormatInput"),
  qualityField: document.querySelector("#qualityField"),
  qualityInput: document.querySelector("#qualityInput"),
  qualityValue: document.querySelector("#qualityValue"),
  exportBtn: document.querySelector("#exportBtn"),
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value) {
  return Math.round(Number(value) || 0);
}

function hasImage() {
  return state.originalWidth > 0 && state.originalHeight > 0;
}

function baseName(fileName) {
  return (fileName || "edited-image").replace(/\.[^.]+$/, "") || "edited-image";
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-Hant").format(round(value));
}

function fitSize(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function getNaturalBounds(width, height, angle) {
  const radians = (angle * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  return {
    width: Math.max(1, Math.round(width * cos + height * sin)),
    height: Math.max(1, Math.round(width * sin + height * cos)),
  };
}

function fitToExportBounds(width, height) {
  const largestEdge = Math.max(width, height);
  if (largestEdge <= MAX_OUTPUT_EDGE) {
    return { width, height };
  }

  const scale = MAX_OUTPUT_EDGE / largestEdge;
  return {
    width: Math.max(MIN_OUTPUT_EDGE, Math.round(width * scale)),
    height: Math.max(MIN_OUTPUT_EDGE, Math.round(height * scale)),
  };
}

function currentOutputRatio() {
  if (state.outputWidth > 0 && state.outputHeight > 0) {
    return state.outputWidth / state.outputHeight;
  }
  const natural = getNaturalBounds(state.crop.width, state.crop.height, state.rotation);
  return natural.width / natural.height;
}

function syncOutputSizeToContent() {
  if (!hasImage()) {
    return;
  }

  const natural = getNaturalBounds(state.crop.width, state.crop.height, state.rotation);
  const fitted = fitToExportBounds(natural.width, natural.height);
  state.outputWidth = fitted.width;
  state.outputHeight = fitted.height;
}

function normalizeCrop(crop) {
  const minWidth = Math.min(MIN_CROP_EDGE, state.originalWidth);
  const minHeight = Math.min(MIN_CROP_EDGE, state.originalHeight);
  const width = clamp(round(crop.width), minWidth, state.originalWidth);
  const height = clamp(round(crop.height), minHeight, state.originalHeight);
  const x = clamp(round(crop.x), 0, state.originalWidth - width);
  const y = clamp(round(crop.y), 0, state.originalHeight - height);
  return { x, y, width, height };
}

function setCrop(nextCrop, { syncSize = false } = {}) {
  state.crop = normalizeCrop(nextCrop);
  if (syncSize || !state.sizeTouched) {
    syncOutputSizeToContent();
  }
  syncControlValues();
  scheduleRender();
}

function resetEditor() {
  if (!hasImage()) {
    return;
  }

  state.crop = {
    x: 0,
    y: 0,
    width: state.originalWidth,
    height: state.originalHeight,
  };
  state.rotation = 0;
  state.adjustments = { ...presets.clean };
  state.activePreset = "clean";
  state.cropMode = false;
  state.aspectLock = true;
  state.sizeTouched = false;
  syncOutputSizeToContent();
  syncControlValues();
  setStatus("已重設到剛載入的狀態。");
  scheduleRender();
}

function normalizeAngle(angle) {
  let next = round(angle);
  while (next > 180) {
    next -= 360;
  }
  while (next < -180) {
    next += 360;
  }
  return next;
}

function setStatus(message) {
  refs.statusText.textContent = message;
}

function updatePresetState() {
  const matched = Object.entries(presets).find(([, preset]) =>
    Object.entries(preset).every(([key, value]) => state.adjustments[key] === value)
  );
  state.activePreset = matched ? matched[0] : "custom";

  refs.presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === state.activePreset);
  });
}

function syncControlValues() {
  refs.modeText.textContent = hasImage() ? (state.cropMode ? "裁切中" : "編輯中") : "待機";
  refs.modeChip.textContent = hasImage()
    ? (state.cropMode ? "Crop 模式" : "Preview 模式")
    : "Preview 模式";
  refs.dimensionChip.textContent = state.outputWidth && state.outputHeight
    ? `${formatNumber(state.outputWidth)} × ${formatNumber(state.outputHeight)}`
    : "0 × 0";

  refs.fileNameText.textContent = state.fileName || "尚未載入";
  refs.originalDimensionText.textContent = hasImage()
    ? `${formatNumber(state.originalWidth)} × ${formatNumber(state.originalHeight)}`
    : "-";
  refs.originalFormatText.textContent = state.originalFormat || "-";

  refs.rotationInput.value = String(state.rotation);
  refs.rotationValue.textContent = `${state.rotation}°`;

  refs.outputWidthInput.value = state.outputWidth ? String(state.outputWidth) : "0";
  refs.outputHeightInput.value = state.outputHeight ? String(state.outputHeight) : "0";
  refs.aspectLockInput.checked = state.aspectLock;

  refs.cropXInput.value = String(state.crop.x);
  refs.cropYInput.value = String(state.crop.y);
  refs.cropWidthInput.value = String(state.crop.width);
  refs.cropHeightInput.value = String(state.crop.height);

  refs.cropXInput.max = String(Math.max(0, state.originalWidth - Math.max(1, state.crop.width)));
  refs.cropYInput.max = String(Math.max(0, state.originalHeight - Math.max(1, state.crop.height)));
  refs.cropWidthInput.max = String(Math.max(1, state.originalWidth - state.crop.x));
  refs.cropHeightInput.max = String(Math.max(1, state.originalHeight - state.crop.y));

  refs.brightnessInput.value = String(state.adjustments.brightness);
  refs.contrastInput.value = String(state.adjustments.contrast);
  refs.saturationInput.value = String(state.adjustments.saturation);
  refs.temperatureInput.value = String(state.adjustments.temperature);
  refs.brightnessValue.textContent = String(state.adjustments.brightness);
  refs.contrastValue.textContent = String(state.adjustments.contrast);
  refs.saturationValue.textContent = String(state.adjustments.saturation);
  refs.temperatureValue.textContent = String(state.adjustments.temperature);

  refs.qualityValue.textContent = refs.qualityInput.value;
  refs.toggleCropModeBtn.textContent = state.cropMode ? "關閉裁切模式" : "開啟裁切模式";

  const pngMode = refs.exportFormatInput.value === "image/png";
  refs.qualityInput.disabled = pngMode;
  refs.qualityField.classList.toggle("disabled", pngMode);
  refs.qualityField.querySelector(".quality-wrap").classList.toggle("disabled", pngMode);

  refs.sourceSummary.textContent = hasImage()
    ? `原始檔為 ${state.originalFormat}，尺寸 ${formatNumber(state.originalWidth)} × ${formatNumber(state.originalHeight)}，目前裁切區域為 ${formatNumber(state.crop.width)} × ${formatNumber(state.crop.height)}。`
    : "等待載入圖片。";

  refs.adjustmentSummary.textContent = hasImage()
    ? `亮度 ${state.adjustments.brightness}、對比 ${state.adjustments.contrast}、飽和度 ${state.adjustments.saturation}、色溫 ${state.adjustments.temperature}${state.activePreset !== "custom" ? `，preset 為 ${state.activePreset}` : ""}。`
    : "亮度、對比、飽和度與色溫皆為 0。";

  refs.exportSummary.textContent = hasImage()
    ? `輸出將會是 ${formatNumber(state.outputWidth)} × ${formatNumber(state.outputHeight)}，格式 ${refs.exportFormatInput.value === "image/png" ? "PNG" : "JPG"}${refs.exportFormatInput.value === "image/jpeg" ? `，品質 ${refs.qualityInput.value}` : ""}。`
    : "未設定輸出尺寸。";

  updatePresetState();
}

function applyPreset(name) {
  const preset = presets[name];
  if (!preset) {
    return;
  }
  state.adjustments = { ...preset };
  state.activePreset = name;
  syncControlValues();
  setStatus(`已套用 ${name} preset。`);
  scheduleRender();
}

function updateAdjustment(key, value) {
  state.adjustments[key] = round(value);
  syncControlValues();
  scheduleRender();
}

function drawProcessedImage(canvas, width, height) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const bounds = getNaturalBounds(state.crop.width, state.crop.height, state.rotation);
  const radians = (state.rotation * Math.PI) / 180;

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(width / bounds.width, height / bounds.height);
  ctx.rotate(radians);
  ctx.drawImage(
    state.originalCanvas,
    state.crop.x,
    state.crop.y,
    state.crop.width,
    state.crop.height,
    -state.crop.width / 2,
    -state.crop.height / 2,
    state.crop.width,
    state.crop.height
  );
  ctx.restore();

  const { brightness, contrast, saturation, temperature } = state.adjustments;
  if (!brightness && !contrast && !saturation && !temperature) {
    return;
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const brightnessShift = brightness * 2.55;
  const contrastFactor = contrast === 0
    ? 1
    : (259 * (contrast + 255)) / (255 * (259 - contrast));
  const saturationFactor = (100 + saturation) / 100;
  const temperatureShift = temperature * 1.15;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + brightnessShift;
    let g = data[i + 1] + brightnessShift;
    let b = data[i + 2] + brightnessShift;

    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * saturationFactor;
    g = gray + (g - gray) * saturationFactor;
    b = gray + (b - gray) * saturationFactor;

    r += temperatureShift;
    g += temperatureShift * 0.18;
    b -= temperatureShift;

    data[i] = clamp(Math.round(r), 0, 255);
    data[i + 1] = clamp(Math.round(g), 0, 255);
    data[i + 2] = clamp(Math.round(b), 0, 255);
  }

  ctx.putImageData(imageData, 0, 0);
}

function renderPreviewMode() {
  const stageWidth = Math.max(1, refs.previewStage.clientWidth - PREVIEW_PADDING);
  const stageHeight = Math.max(1, refs.previewStage.clientHeight - PREVIEW_PADDING);
  const fitted = fitSize(state.outputWidth, state.outputHeight, stageWidth, stageHeight);
  const dpr = window.devicePixelRatio || 1;

  refs.previewCanvas.width = fitted.width * dpr;
  refs.previewCanvas.height = fitted.height * dpr;
  refs.previewCanvas.style.width = `${fitted.width}px`;
  refs.previewCanvas.style.height = `${fitted.height}px`;
  refs.previewCanvas.style.display = "block";

  drawProcessedImage(refs.previewCanvas, refs.previewCanvas.width, refs.previewCanvas.height);
  refs.cropOverlay.hidden = true;
}

function renderCropMode() {
  const stageWidth = Math.max(1, refs.previewStage.clientWidth);
  const stageHeight = Math.max(1, refs.previewStage.clientHeight);
  const display = fitSize(
    state.originalWidth,
    state.originalHeight,
    stageWidth - PREVIEW_PADDING,
    stageHeight - PREVIEW_PADDING
  );
  const dpr = window.devicePixelRatio || 1;

  refs.previewCanvas.width = display.width * dpr;
  refs.previewCanvas.height = display.height * dpr;
  refs.previewCanvas.style.width = `${display.width}px`;
  refs.previewCanvas.style.height = `${display.height}px`;
  refs.previewCanvas.style.display = "block";

  const ctx = refs.previewCanvas.getContext("2d");
  ctx.clearRect(0, 0, refs.previewCanvas.width, refs.previewCanvas.height);
  ctx.drawImage(state.originalCanvas, 0, 0, refs.previewCanvas.width, refs.previewCanvas.height);

  const x = Math.round((stageWidth - display.width) / 2);
  const y = Math.round((stageHeight - display.height) / 2);
  state.displayImageRect = { x, y, width: display.width, height: display.height };

  refs.cropOverlay.hidden = false;
  const left = x + (state.crop.x / state.originalWidth) * display.width;
  const top = y + (state.crop.y / state.originalHeight) * display.height;
  const width = (state.crop.width / state.originalWidth) * display.width;
  const height = (state.crop.height / state.originalHeight) * display.height;

  refs.cropBox.style.left = `${left}px`;
  refs.cropBox.style.top = `${top}px`;
  refs.cropBox.style.width = `${width}px`;
  refs.cropBox.style.height = `${height}px`;
}

function renderEmptyState() {
  refs.previewCanvas.style.display = "none";
  refs.cropOverlay.hidden = true;
  refs.stagePlaceholder.style.display = "grid";
  state.displayImageRect = null;
}

function render() {
  state.renderQueued = false;
  if (!hasImage()) {
    renderEmptyState();
    return;
  }

  refs.stagePlaceholder.style.display = "none";
  if (state.cropMode) {
    renderCropMode();
  } else {
    renderPreviewMode();
  }
}

function scheduleRender() {
  if (state.renderQueued) {
    return;
  }
  state.renderQueued = true;
  window.requestAnimationFrame(render);
}

function updateSizeFromInput(changedField) {
  if (!hasImage()) {
    return;
  }

  const widthInput = clamp(round(refs.outputWidthInput.value), MIN_OUTPUT_EDGE, MAX_OUTPUT_EDGE);
  const heightInput = clamp(round(refs.outputHeightInput.value), MIN_OUTPUT_EDGE, MAX_OUTPUT_EDGE);
  let nextWidth = widthInput;
  let nextHeight = heightInput;

  if (state.aspectLock) {
    const ratio = currentOutputRatio();
    if (changedField === "width") {
      nextHeight = clamp(Math.round(nextWidth / ratio), MIN_OUTPUT_EDGE, MAX_OUTPUT_EDGE);
    } else {
      nextWidth = clamp(Math.round(nextHeight * ratio), MIN_OUTPUT_EDGE, MAX_OUTPUT_EDGE);
    }
  }

  const fitted = fitToExportBounds(nextWidth, nextHeight);
  state.outputWidth = fitted.width;
  state.outputHeight = fitted.height;
  state.sizeTouched = true;
  syncControlValues();
  scheduleRender();
}

function updateCropFromInputs() {
  if (!hasImage()) {
    return;
  }

  const x = clamp(round(refs.cropXInput.value), 0, state.originalWidth - 1);
  const y = clamp(round(refs.cropYInput.value), 0, state.originalHeight - 1);
  const width = clamp(round(refs.cropWidthInput.value), 1, state.originalWidth - x);
  const height = clamp(round(refs.cropHeightInput.value), 1, state.originalHeight - y);
  setCrop({ x, y, width, height });
}

function imagePointFromEvent(event) {
  if (!state.displayImageRect) {
    return null;
  }

  const stageRect = refs.previewStage.getBoundingClientRect();
  const localX = event.clientX - stageRect.left;
  const localY = event.clientY - stageRect.top;
  const imageRect = state.displayImageRect;

  if (
    localX < imageRect.x ||
    localX > imageRect.x + imageRect.width ||
    localY < imageRect.y ||
    localY > imageRect.y + imageRect.height
  ) {
    return null;
  }

  return {
    x: ((localX - imageRect.x) / imageRect.width) * state.originalWidth,
    y: ((localY - imageRect.y) / imageRect.height) * state.originalHeight,
  };
}

function beginCropInteraction(event) {
  if (!state.cropMode || !hasImage()) {
    return;
  }

  const point = imagePointFromEvent(event);
  if (!point) {
    return;
  }

  const handle = event.target.dataset.handle || "";
  const onCropBox = event.target === refs.cropBox || refs.cropBox.contains(event.target);

  state.cropInteraction = {
    mode: handle ? "resize" : onCropBox ? "move" : "new",
    handle,
    startPoint: point,
    startCrop: { ...state.crop },
  };

  event.preventDefault();
  document.addEventListener("pointermove", handleCropInteraction);
  document.addEventListener("pointerup", endCropInteraction, { once: true });
}

function handleCropInteraction(event) {
  if (!state.cropInteraction) {
    return;
  }

  const point = imagePointFromEvent(event) || {
    x: clamp(
      ((event.clientX - refs.previewStage.getBoundingClientRect().left - state.displayImageRect.x) /
        state.displayImageRect.width) *
        state.originalWidth,
      0,
      state.originalWidth
    ),
    y: clamp(
      ((event.clientY - refs.previewStage.getBoundingClientRect().top - state.displayImageRect.y) /
        state.displayImageRect.height) *
        state.originalHeight,
      0,
      state.originalHeight
    ),
  };
  const { mode, handle, startPoint, startCrop } = state.cropInteraction;

  if (mode === "new") {
    const x1 = clamp(Math.min(startPoint.x, point.x), 0, state.originalWidth);
    const y1 = clamp(Math.min(startPoint.y, point.y), 0, state.originalHeight);
    const x2 = clamp(Math.max(startPoint.x, point.x), 0, state.originalWidth);
    const y2 = clamp(Math.max(startPoint.y, point.y), 0, state.originalHeight);
    setCrop({
      x: x1,
      y: y1,
      width: Math.max(MIN_CROP_EDGE, x2 - x1),
      height: Math.max(MIN_CROP_EDGE, y2 - y1),
    });
    return;
  }

  if (mode === "move") {
    const deltaX = point.x - startPoint.x;
    const deltaY = point.y - startPoint.y;
    setCrop({
      x: startCrop.x + deltaX,
      y: startCrop.y + deltaY,
      width: startCrop.width,
      height: startCrop.height,
    });
    return;
  }

  let left = startCrop.x;
  let top = startCrop.y;
  let right = startCrop.x + startCrop.width;
  let bottom = startCrop.y + startCrop.height;

  if (handle.includes("w")) {
    left = clamp(point.x, 0, right - MIN_CROP_EDGE);
  }
  if (handle.includes("e")) {
    right = clamp(point.x, left + MIN_CROP_EDGE, state.originalWidth);
  }
  if (handle.includes("n")) {
    top = clamp(point.y, 0, bottom - MIN_CROP_EDGE);
  }
  if (handle.includes("s")) {
    bottom = clamp(point.y, top + MIN_CROP_EDGE, state.originalHeight);
  }

  setCrop({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

function endCropInteraction() {
  state.cropInteraction = null;
  document.removeEventListener("pointermove", handleCropInteraction);
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("圖片載入失敗"));
    };
    image.src = objectUrl;
  });
}

async function loadFile(file) {
  if (!file) {
    return;
  }

  const isSupported = /image\/(jpeg|png)/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
  if (!isSupported) {
    setStatus("目前只支援 JPG / PNG。");
    return;
  }

  try {
    const image = await fileToImage(file);
    state.originalWidth = image.naturalWidth;
    state.originalHeight = image.naturalHeight;
    state.fileName = file.name;
    state.originalFormat = file.type === "image/png" ? "PNG" : "JPG";

    state.originalCanvas.width = image.naturalWidth;
    state.originalCanvas.height = image.naturalHeight;
    state.originalCanvas.getContext("2d").drawImage(image, 0, 0);

    state.crop = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    state.rotation = 0;
    state.outputWidth = image.naturalWidth;
    state.outputHeight = image.naturalHeight;
    state.aspectLock = true;
    state.sizeTouched = false;
    state.cropMode = false;
    state.adjustments = { ...presets.clean };
    state.activePreset = "clean";
    syncOutputSizeToContent();
    syncControlValues();
    setStatus("圖片已載入，可以開始裁切與調色。");
    scheduleRender();
  } catch (error) {
    setStatus(error.message || "圖片載入失敗。");
  }
}

async function exportImage() {
  if (!hasImage()) {
    setStatus("請先載入一張圖片。");
    return;
  }

  refs.exportBtn.disabled = true;
  refs.exportBtn.textContent = "匯出中...";

  const canvas = document.createElement("canvas");
  canvas.width = state.outputWidth;
  canvas.height = state.outputHeight;
  drawProcessedImage(canvas, canvas.width, canvas.height);

  const format = refs.exportFormatInput.value;
  const quality = clamp(Number(refs.qualityInput.value) / 100, 0.6, 1);
  const extension = format === "image/png" ? "png" : "jpg";

  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
            return;
          }
          reject(new Error("匯出失敗"));
        },
        format,
        format === "image/jpeg" ? quality : undefined
      );
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${baseName(state.fileName)}-edited.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`已匯出 ${extension.toUpperCase()}。`);
  } catch (error) {
    setStatus(error.message || "匯出失敗。");
  } finally {
    refs.exportBtn.disabled = false;
    refs.exportBtn.textContent = "匯出 JPG / PNG";
  }
}

function setupDropzone() {
  ["dragenter", "dragover"].forEach((eventName) => {
    refs.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      refs.dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    refs.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      refs.dropzone.classList.remove("dragover");
    });
  });

  refs.dropzone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files || [];
    loadFile(file);
  });
}

function setupEvents() {
  refs.uploadInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    loadFile(file);
  });

  refs.resetAllBtn.addEventListener("click", resetEditor);
  refs.rotateLeftBtn.addEventListener("click", () => {
    if (!hasImage()) {
      return;
    }
    state.rotation = normalizeAngle(state.rotation - 90);
    if (!state.sizeTouched) {
      syncOutputSizeToContent();
    }
    syncControlValues();
    scheduleRender();
  });

  refs.rotateRightBtn.addEventListener("click", () => {
    if (!hasImage()) {
      return;
    }
    state.rotation = normalizeAngle(state.rotation + 90);
    if (!state.sizeTouched) {
      syncOutputSizeToContent();
    }
    syncControlValues();
    scheduleRender();
  });

  refs.resetRotationBtn.addEventListener("click", () => {
    if (!hasImage()) {
      return;
    }
    state.rotation = 0;
    if (!state.sizeTouched) {
      syncOutputSizeToContent();
    }
    syncControlValues();
    scheduleRender();
  });

  refs.rotationInput.addEventListener("input", () => {
    if (!hasImage()) {
      return;
    }
    state.rotation = normalizeAngle(refs.rotationInput.value);
    if (!state.sizeTouched) {
      syncOutputSizeToContent();
    }
    syncControlValues();
    scheduleRender();
  });

  refs.outputWidthInput.addEventListener("change", () => updateSizeFromInput("width"));
  refs.outputHeightInput.addEventListener("change", () => updateSizeFromInput("height"));
  refs.aspectLockInput.addEventListener("change", () => {
    state.aspectLock = refs.aspectLockInput.checked;
    syncControlValues();
  });
  refs.syncSizeBtn.addEventListener("click", () => {
    if (!hasImage()) {
      return;
    }
    state.sizeTouched = false;
    syncOutputSizeToContent();
    syncControlValues();
    scheduleRender();
  });

  refs.toggleCropModeBtn.addEventListener("click", () => {
    if (!hasImage()) {
      return;
    }
    state.cropMode = !state.cropMode;
    syncControlValues();
    scheduleRender();
  });

  refs.resetCropBtn.addEventListener("click", () => {
    if (!hasImage()) {
      return;
    }
    setCrop({
      x: 0,
      y: 0,
      width: state.originalWidth,
      height: state.originalHeight,
    }, { syncSize: !state.sizeTouched });
  });

  refs.cropXInput.addEventListener("change", updateCropFromInputs);
  refs.cropYInput.addEventListener("change", updateCropFromInputs);
  refs.cropWidthInput.addEventListener("change", updateCropFromInputs);
  refs.cropHeightInput.addEventListener("change", updateCropFromInputs);

  refs.brightnessInput.addEventListener("input", () => updateAdjustment("brightness", refs.brightnessInput.value));
  refs.contrastInput.addEventListener("input", () => updateAdjustment("contrast", refs.contrastInput.value));
  refs.saturationInput.addEventListener("input", () => updateAdjustment("saturation", refs.saturationInput.value));
  refs.temperatureInput.addEventListener("input", () => updateAdjustment("temperature", refs.temperatureInput.value));

  refs.presetButtons.forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  refs.exportFormatInput.addEventListener("change", syncControlValues);
  refs.qualityInput.addEventListener("input", syncControlValues);
  refs.exportBtn.addEventListener("click", exportImage);

  refs.cropOverlay.addEventListener("pointerdown", beginCropInteraction);

  new ResizeObserver(() => {
    if (hasImage()) {
      scheduleRender();
    }
  }).observe(refs.previewStage);
}

setupDropzone();
setupEvents();
syncControlValues();
renderEmptyState();
