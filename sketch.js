// the world, to me — sketch
// 睁眼 = 摄像头画面粒子化模糊；闭眼 = 上一帧定格 + 暖色 + vignette + 缓慢呼吸
// 详见 docs/the_world_to_me_Solution.md

// ============== 调参（集中放，方便调） ==============
const CFG = {
  // 眼睁度（基于 maxEAR 自适应基线的比例）
  EYE_FULLY_CLOSED_RATIO: 0.30,   // < 此比例 = 完全闭眼态
  EYE_FULLY_OPEN_RATIO:   0.80,   // > 此比例 = 完全睁眼态
  EAR_WARMUP_FRAMES:      60,     // 头 60 帧（~1s @ 60fps）只采集 maxEAR
  OPENNESS_EMA:           0.35,   // 平滑系数（高=更跟手，低=更稳定）
  MEMORY_REFRESH_OPENNESS: 0.5,   // openness > 此值时持续刷新记忆帧

  // 粒子化（睁眼态）
  SAMPLE_W: 160,                  // 低分辨率采样宽（决定粒子列数）
  SAMPLE_H: 90,                   // 低分辨率采样高（决定粒子行数）—— 共 14400 粒子
  PARTICLE_SIZE_BASE: 4,          // 粒子基础大小（像素）
  PARTICLE_SIZE_OPEN: 7,          // 完全睁眼时粒子放大到此值（更"散"）
  MAX_JITTER_PX:    50,           // 完全睁眼时的最大随机偏移半径
  TRAIL_ALPHA_OPEN: 22,           // 睁眼态半透明黑底（小=尾迹长）
  TRAIL_ALPHA_CLOSE: 80,          // 闭眼态切换时残影快速清掉
  DESATURATION_OPEN: 0.45,        // 完全睁眼时的去饱和强度（0=原色 1=灰度）
  PARTICLE_ALPHA: 200,

  // 记忆态（闭眼）
  MEMORY_TINT:        [255, 218, 175],
  MEMORY_TINT_ALPHA:  55,
  VIGNETTE_INTENSITY: 0.7,
  GRAIN_DENSITY:      350,        // 每帧颗粒数量
  GRAIN_ALPHA:        22,
  BREATHE_AMPL:       0.014,      // 呼吸缩放幅度（1.014 - 0.986）
  BREATHE_PERIOD_MS:  7800,
};

// ============== 状态 ==============
let video;
let videoReady = false;
let sampleBuf;          // 低分辨率视频缓冲（粒子化用）
let memoryGfx;          // 与 canvas 同尺寸的"记忆帧"
let memoryHasFrame = false;

let earWarmupFrames = 0;
let maxEAR = 0;
let smoothOpenness = 0; // 0..1：1=全开 0=全闭

let statusDiv;

// ============== p5 生命周期 ==============
function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  noStroke();

  video = createCapture(
    { video: { facingMode: "user" }, audio: false },
    () => {
      videoReady = true;
      window.__twtm.video = video.elt;
    }
  );
  video.size(640, 360);
  video.hide();

  sampleBuf = createGraphics(CFG.SAMPLE_W, CFG.SAMPLE_H);
  sampleBuf.pixelDensity(1);
  sampleBuf.noStroke();

  memoryGfx = createGraphics(width, height);
  memoryGfx.pixelDensity(1);
  memoryGfx.noStroke();
  memoryGfx.background(0);

  background(0);

  statusDiv = createDiv("");
  statusDiv.id("status");
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  // 重建 memoryGfx 以匹配新尺寸；旧记忆丢失，等待下一次睁眼自动重新捕获
  memoryGfx = createGraphics(width, height);
  memoryGfx.pixelDensity(1);
  memoryGfx.noStroke();
  memoryGfx.background(0);
  memoryHasFrame = false;
  background(0);
}

function draw() {
  updateStatus();

  // 1. 视频未就绪：黑底等
  if (!videoReady || !window.__twtm.video || video.elt.readyState < 2) {
    return;
  }

  // 2. 更新眼睁度（自适应基线 + EMA）
  updateOpenness();

  // 3. 把摄像头帧采样到 sampleBuf（镜像）
  refreshSampleBuf();

  // 4. 较开时持续刷新记忆帧（"最后一次清楚看见"）
  if (smoothOpenness > CFG.MEMORY_REFRESH_OPENNESS || !memoryHasFrame) {
    refreshMemoryGfx();
  }

  // 5. 计算混合系数 mix：1=纯粒子，0=纯记忆
  const mix = constrain(
    map(
      smoothOpenness,
      CFG.EYE_FULLY_CLOSED_RATIO,
      CFG.EYE_FULLY_OPEN_RATIO,
      0,
      1
    ),
    0,
    1
  );

  // 6. 半透明黑底（trail）—— 让粒子留尾迹
  const trailA = lerp(CFG.TRAIL_ALPHA_CLOSE, CFG.TRAIL_ALPHA_OPEN, mix);
  background(0, trailA);

  // 7. 粒子层
  if (mix > 0.02) {
    drawParticleLayer(mix);
  }

  // 8. 记忆层（叠加在粒子上方，alpha 由 1-mix 控制）
  if (mix < 0.98 && memoryHasFrame) {
    drawMemoryLayer(1 - mix);
  }

  // 9. vignette + grain（仅闭眼侧明显）
  drawVignetteAndGrain(1 - mix);
}

// ============== 眼睁度 ==============
function updateOpenness() {
  const eye = window.__twtm.eye;
  if (!eye || typeof eye.openness !== "number") return;

  const ear = eye.openness;

  // 自适应基线：warmup 期纯采 max；warmup 后用最大值更新（仅在更高时）
  if (earWarmupFrames < CFG.EAR_WARMUP_FRAMES) {
    if (ear > maxEAR) maxEAR = ear;
    earWarmupFrames++;
    return; // warmup 期不输出 openness（保持初始 0）
  } else {
    if (ear > maxEAR) maxEAR = ear;
  }

  if (maxEAR <= 0.01) return;

  // 当前 EAR 相对基线的比例
  const ratio = constrain(ear / maxEAR, 0, 1.5);
  // EMA 平滑
  smoothOpenness =
    smoothOpenness * (1 - CFG.OPENNESS_EMA) + ratio * CFG.OPENNESS_EMA;
}

// ============== 视频采样到低分辨率缓冲（镜像） ==============
function refreshSampleBuf() {
  sampleBuf.push();
  sampleBuf.translate(CFG.SAMPLE_W, 0);
  sampleBuf.scale(-1, 1);
  sampleBuf.image(video, 0, 0, CFG.SAMPLE_W, CFG.SAMPLE_H);
  sampleBuf.pop();
}

// ============== 把当前视频帧拷到记忆 graphics（镜像，按比例 cover） ==============
function refreshMemoryGfx() {
  const vw = video.elt.videoWidth || 640;
  const vh = video.elt.videoHeight || 360;
  if (vw === 0 || vh === 0) return;

  // cover：按短边裁剪，让画面铺满 canvas 不变形
  const canvasRatio = width / height;
  const videoRatio = vw / vh;
  let drawW, drawH;
  if (videoRatio > canvasRatio) {
    drawH = height;
    drawW = drawH * videoRatio;
  } else {
    drawW = width;
    drawH = drawW / videoRatio;
  }
  const offX = (width - drawW) / 2;
  const offY = (height - drawH) / 2;

  memoryGfx.push();
  memoryGfx.translate(width, 0);
  memoryGfx.scale(-1, 1);
  // 镜像后 x 也要变换
  memoryGfx.image(video, width - offX - drawW, offY, drawW, drawH);
  memoryGfx.pop();
  memoryHasFrame = true;
}

// ============== 粒子层 ==============
function drawParticleLayer(mix) {
  sampleBuf.loadPixels();
  if (!sampleBuf.pixels || sampleBuf.pixels.length === 0) return;

  const sw = CFG.SAMPLE_W;
  const sh = CFG.SAMPLE_H;
  const cellW = width / sw;
  const cellH = height / sh;
  const jitter = mix * CFG.MAX_JITTER_PX;
  const desat = mix * CFG.DESATURATION_OPEN;
  const psize = lerp(CFG.PARTICLE_SIZE_BASE, CFG.PARTICLE_SIZE_OPEN, mix);
  const pa = CFG.PARTICLE_ALPHA;

  noStroke();
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      let r = sampleBuf.pixels[i];
      let g = sampleBuf.pixels[i + 1];
      let b = sampleBuf.pixels[i + 2];

      // 去饱和：向亮度灰度插值
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = r + (gray - r) * desat;
      g = g + (gray - g) * desat;
      b = b + (gray - b) * desat;

      // 抖动
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * jitter;
      const px = x * cellW + cellW * 0.5 + Math.cos(angle) * dist;
      const py = y * cellH + cellH * 0.5 + Math.sin(angle) * dist;

      fill(r, g, b, pa);
      ellipse(px, py, psize, psize);
    }
  }
}

// ============== 记忆层 ==============
function drawMemoryLayer(strength) {
  // strength: 0..1，1=完全闭眼
  push();
  translate(width / 2, height / 2);

  // 呼吸缩放
  const t = millis();
  const breath =
    1 + CFG.BREATHE_AMPL * Math.sin((t / CFG.BREATHE_PERIOD_MS) * Math.PI * 2);
  scale(breath);

  // 用 tint 让 image() 的 alpha 走 strength
  imageMode(CENTER);
  tint(255, 255 * strength);
  image(memoryGfx, 0, 0, width, height);
  noTint();
  imageMode(CORNER);

  pop();

  // 暖色叠加（仅闭眼侧）
  noStroke();
  fill(
    CFG.MEMORY_TINT[0],
    CFG.MEMORY_TINT[1],
    CFG.MEMORY_TINT[2],
    CFG.MEMORY_TINT_ALPHA * strength
  );
  rect(0, 0, width, height);
}

// ============== Vignette + Grain ==============
function drawVignetteAndGrain(strength) {
  // strength: 0..1，1=完全闭眼时最强
  if (strength < 0.05) return;

  const ctx = drawingContext;
  const cx = width / 2;
  const cy = height / 2;
  const r0 = Math.min(width, height) * 0.32;
  const r1 = Math.max(width, height) * 0.75;

  ctx.save();
  const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(
    1,
    `rgba(0,0,0,${(CFG.VIGNETTE_INTENSITY * strength).toFixed(3)})`
  );
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // film grain：散布微小白点
  noStroke();
  const grainA = CFG.GRAIN_ALPHA * strength;
  fill(255, grainA);
  for (let i = 0; i < CFG.GRAIN_DENSITY; i++) {
    rect(Math.random() * width, Math.random() * height, 1, 1);
  }
}

// ============== 状态文本 ==============
function updateStatus() {
  if (!statusDiv) return;
  const err = window.__twtm.error;
  if (err) {
    statusDiv.html(err);
    statusDiv.addClass("error");
    return;
  }
  statusDiv.removeClass("error");

  if (!videoReady) {
    statusDiv.html("请允许摄像头访问…");
    return;
  }
  if (!window.__twtm.ready) {
    statusDiv.html(window.__twtm.status || "加载中…");
    return;
  }
  if (earWarmupFrames < CFG.EAR_WARMUP_FRAMES) {
    statusDiv.html(
      `校准中… ${earWarmupFrames}/${CFG.EAR_WARMUP_FRAMES}（请保持自然睁眼）`
    );
    return;
  }
  // 就绪：留一行小提示，但不抢眼
  statusDiv.html("睁眼是粒子，闭眼是记忆。");
}
