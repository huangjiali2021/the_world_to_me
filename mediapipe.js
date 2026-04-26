// MediaPipe FaceLandmarker 接入
// 改自姊妹项目 thousands_of_me/mediapipe.js（已在本机环境验证 GPU/CPU/CDN 三层回退）
// 区别：本项目只需要"双眼睁开度（EAR）"，不需要 gaze 方向 / iris ring / 眼轮廓
// 参考：https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js

console.log("[mediapipe] module start");
window.__mpStatus = "模块开始执行";

const TASKS_VERSION = "0.10.34";
const LIB_CDNS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`,
  `https://unpkg.com/@mediapipe/tasks-vision@${TASKS_VERSION}`,
  `https://esm.sh/@mediapipe/tasks-vision@${TASKS_VERSION}`,
];
const WASM_CDNS = LIB_CDNS.map((u) => u + "/wasm");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// FaceMesh 478-point 索引（image 视角，非镜像）
// 我们只关心眼睛的 4 个端点：外眦 / 内眦 / 上睑 / 下睑
const IDX = {
  left:  { outer: 33,  inner: 133, top: 159, bottom: 145 },
  right: { outer: 263, inner: 362, top: 386, bottom: 374 },
};

let landmarker = null;
let lastVideoTime = -1;

function setStatus(msg) {
  console.log("[mediapipe]", msg);
  window.__mpStatus = msg;
}

function setError(err) {
  const msg = err && err.message ? err.message : String(err);
  console.error("[mediapipe] error:", err);
  window.__mpError = msg;
}

async function loadVisionLib() {
  let lastErr;
  for (const url of LIB_CDNS) {
    const host = new URL(url).host;
    try {
      setStatus(`加载库: ${host}…`);
      const mod = await import(/* @vite-ignore */ url);
      if (!mod || !mod.FaceLandmarker || !mod.FilesetResolver) {
        throw new Error("模块没有 FaceLandmarker 导出");
      }
      setStatus(`库加载成功: ${host}`);
      window.__mpWasmBase =
        WASM_CDNS[LIB_CDNS.indexOf(url)] || WASM_CDNS[0];
      return mod;
    } catch (err) {
      console.warn("[mediapipe] CDN 失败", host, err);
      lastErr = err;
    }
  }
  throw lastErr || new Error("所有 CDN 均失败");
}

async function createLandmarker(FaceLandmarker, fileset, delegate) {
  setStatus(`创建 FaceLandmarker (${delegate})…`);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate,
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

async function init() {
  try {
    const { FaceLandmarker, FilesetResolver } = await loadVisionLib();

    setStatus(`加载 WASM: ${new URL(window.__mpWasmBase).host}…`);
    const fileset = await FilesetResolver.forVisionTasks(window.__mpWasmBase);

    setStatus("下载模型…");
    try {
      landmarker = await createLandmarker(FaceLandmarker, fileset, "GPU");
    } catch (gpuErr) {
      console.warn("[mediapipe] GPU delegate 失败，回退 CPU：", gpuErr);
      setStatus("GPU 失败，改用 CPU…");
      landmarker = await createLandmarker(FaceLandmarker, fileset, "CPU");
    }

    setStatus("就绪");
    window.__landmarkerReady = true;
    requestAnimationFrame(loop);
  } catch (err) {
    setError(err);
  }
}

function loop(nowMs) {
  requestAnimationFrame(loop);
  const video = window.__video;
  if (!video || !landmarker) return;
  if (video.readyState < 2) return;

  const t = video.currentTime;
  if (t === lastVideoTime) return;
  lastVideoTime = t;

  let result;
  try {
    result = landmarker.detectForVideo(video, nowMs);
  } catch (err) {
    console.warn("[mediapipe] detect error", err);
    return;
  }
  if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
    // 丢脸时不归零 eyeOpenness，避免假"闭眼"触发记忆态
    return;
  }
  const lm = result.faceLandmarks[0];
  window.gazeData = computeEyeData(lm, video.videoWidth, video.videoHeight);
}

// 计算单眼 EAR：(top.y - bottom.y) / (outer.x - inner.x)
// 注意 MediaPipe 返回的是归一化坐标 (0..1)，乘上 W/H 得像素坐标
// 高度差用绝对值；水平宽度也用绝对值（左右眼内外眦顺序在两边相反）
function singleEyeEAR(lm, idx, W, H) {
  const top    = { x: lm[idx.top].x    * W, y: lm[idx.top].y    * H };
  const bottom = { x: lm[idx.bottom].x * W, y: lm[idx.bottom].y * H };
  const outer  = { x: lm[idx.outer].x  * W, y: lm[idx.outer].y  * H };
  const inner  = { x: lm[idx.inner].x  * W, y: lm[idx.inner].y  * H };

  const h = Math.abs(top.y - bottom.y);
  const w = Math.max(1, Math.abs(outer.x - inner.x));
  return h / w;
}

function computeEyeData(lm, W, H) {
  const earL = singleEyeEAR(lm, IDX.left,  W, H);
  const earR = singleEyeEAR(lm, IDX.right, W, H);
  const ear = (earL + earR) / 2;
  return {
    eyeOpenness: ear,    // 当前帧双眼 EAR 平均（raw）
    earLeft: earL,
    earRight: earR,
    W,
    H,
    ts: performance.now(),
  };
}

setTimeout(() => {
  if (!window.__landmarkerReady && !window.__mpError) {
    setError(
      new Error(`初始化超时（卡在：${window.__mpStatus || "未知"}）`)
    );
  }
}, 20000);

init();
