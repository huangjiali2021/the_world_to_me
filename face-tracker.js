// the world, to me · face tracker
//
// 这个文件只回答一个问题：此刻用户的眼睛睁开了多少？
// 它把摄像头的每一帧喂给 MediaPipe FaceLandmarker，量出双眼平均 EAR
// （eye aspect ratio = 眼高 / 眼宽），写到 window.__twtm.eye.openness。
// 整个体验里 sketch 只关心这一个标量。
//
// ── 设计取舍 ────────────────────────────────────────────────────────
//   ▸ 模型：MediaPipe FaceLandmarker
//        浏览器端 478-point 面网格事实标准；wasm + GPU delegate 60fps。
//   ▸ 关闭 blendshape / facialTransformationMatrix
//        本项目用不上，关掉省 wasm 推理算力。
//   ▸ 不取虹膜 / gaze 方向
//        "睁开度"是一维标量，不需要凝视方向。
//   ▸ 包从三档 CDN 找；wasm 必须从同一域取
//        否则 wasm/glue 版本错配会在 fileset 创建时炸。
//   ▸ GPU delegate 不可用回退 CPU
//        某些浏览器/显卡下 WebGL 拒绝创建 GL context；CPU 单脸 ~25ms 也够。
//   ▸ 单帧 detect 失败 / 丢脸 → 不更新输出
//        防止瞬间空帧误触发"闭眼=记忆"态。
//
// ── 输出契约 ────────────────────────────────────────────────────────
//   window.__twtm.eye = {
//     openness: number,   // 双眼 EAR 平均（raw，未归一化）
//     left:     number,   // 左眼 EAR
//     right:    number,   // 右眼 EAR
//     ts:       number,   // performance.now() 写入时刻
//   }
//   window.__twtm.video  = HTMLVideoElement   // 由 sketch 写入
//   window.__twtm.status = string             // 启动阶段文字
//   window.__twtm.error  = string | undefined // 致命错误
//   window.__twtm.ready  = boolean            // landmarker 就绪标志

const MP_VERSION = "0.10.34";
const PKG_CDNS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}`,
  `https://esm.sh/@mediapipe/tasks-vision@${MP_VERSION}`,
];
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// 每只眼 4 个 landmark：内外眦定眼宽，上下睑定眼高。
// 索引来自 MediaPipe FACEMESH_LEFT_EYE / RIGHT_EYE 官方表（image 视角，非镜像）。
const EYE = {
  left:  { outer: 33,  inner: 133, top: 159, bottom: 145 },
  right: { outer: 263, inner: 362, top: 386, bottom: 374 },
};

const ns = (window.__twtm = window.__twtm || {});
ns.status = ns.status || "module loaded";

let landmarker = null;
let lastFrameT = -1;

const log  = (...a) => console.log("[twtm/face]", ...a);
const warn = (...a) => console.warn("[twtm/face]", ...a);

function setStatus(m) {
  ns.status = m;
  log(m);
}

function setError(e) {
  ns.error = e && e.message ? e.message : String(e);
  console.error("[twtm/face]", e);
}

async function loadPackage() {
  let lastErr;
  for (const url of PKG_CDNS) {
    const host = new URL(url).host;
    try {
      setStatus(`fetching package · ${host}`);
      const mod = await import(/* @vite-ignore */ url);
      if (!mod || !mod.FaceLandmarker || !mod.FilesetResolver) {
        throw new Error("package loaded but FaceLandmarker missing");
      }
      ns._wasmBase = url + "/wasm";
      setStatus(`package ready · ${host}`);
      return mod;
    } catch (err) {
      warn("package CDN failed:", host, err);
      lastErr = err;
    }
  }
  throw lastErr || new Error("all package CDNs failed");
}

async function buildLandmarker(FaceLandmarker, fileset, delegate) {
  setStatus(`creating FaceLandmarker on ${delegate}`);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

async function start() {
  try {
    const { FaceLandmarker, FilesetResolver } = await loadPackage();
    setStatus(`fetching wasm · ${new URL(ns._wasmBase).host}`);
    const fileset = await FilesetResolver.forVisionTasks(ns._wasmBase);

    setStatus("downloading model");
    try {
      landmarker = await buildLandmarker(FaceLandmarker, fileset, "GPU");
    } catch (gpuErr) {
      warn("GPU delegate failed, falling back to CPU:", gpuErr);
      setStatus("GPU unavailable · using CPU");
      landmarker = await buildLandmarker(FaceLandmarker, fileset, "CPU");
    }

    setStatus("ready");
    ns.ready = true;
    requestAnimationFrame(tick);
  } catch (err) {
    setError(err);
  }
}

function tick(nowMs) {
  requestAnimationFrame(tick);

  const v = ns.video;
  if (!v || !landmarker || v.readyState < 2) return;

  // detectForVideo 要求严格递增的时间戳，相同 currentTime 等同同一帧 → 跳过
  const t = v.currentTime;
  if (t === lastFrameT) return;
  lastFrameT = t;

  let result;
  try {
    result = landmarker.detectForVideo(v, nowMs);
  } catch (err) {
    warn("detect threw:", err);
    return;
  }

  const faces = result && result.faceLandmarks;
  if (!faces || faces.length === 0) return; // 丢脸保留旧值

  ns.eye = readEye(faces[0], v.videoWidth, v.videoHeight);
}

function readEye(lm, W, H) {
  const l = singleEAR(lm, EYE.left,  W, H);
  const r = singleEAR(lm, EYE.right, W, H);
  return {
    openness: (l + r) / 2,
    left:  l,
    right: r,
    ts: performance.now(),
  };
}

// 单眼 EAR：(top.y - bottom.y) / (outer.x - inner.x)
// MediaPipe 给的是 0..1 归一化坐标，乘 W/H 得像素值；
// 高/宽都取绝对值（左右眼内外眦的水平顺序是镜像的）。
function singleEAR(lm, p, W, H) {
  const dy = Math.abs(lm[p.top].y    - lm[p.bottom].y) * H;
  const dx = Math.abs(lm[p.outer].x  - lm[p.inner].x)  * W;
  return dx > 1 ? dy / dx : 0;
}

// 起不来兜底：20s 还没就绪就把当前进度摊成错误，让 UI 能解释为什么黑屏
setTimeout(() => {
  if (!ns.ready && !ns.error) {
    setError(new Error(`init timeout · stuck at "${ns.status || "unknown"}"`));
  }
}, 20000);

start();
