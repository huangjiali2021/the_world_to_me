// the world, to me — sketch
// 睁眼 = 摄像头画面粒子化模糊
// 闭眼 = 上一帧定格 + orange-teal 分级 + halation 高光晕 + 漂移漏光 + 多相位呼吸 + film grain
// 详见 docs/the_world_to_me_Solution.md

// ============== 调参（集中放，方便调） ==============
const CFG = {
  // 眼睁度（基于 maxEAR 自适应基线的比例）
  EYE_FULLY_CLOSED_RATIO: 0.30,
  EYE_FULLY_OPEN_RATIO:   0.80,
  EAR_WARMUP_FRAMES:      60,
  OPENNESS_EMA:           0.35,
  MEMORY_REFRESH_OPENNESS: 0.5,

  // 粒子化（睁眼态）
  SAMPLE_W: 160,
  SAMPLE_H: 90,
  PARTICLE_SIZE_BASE: 4,
  PARTICLE_SIZE_OPEN: 7,
  MAX_JITTER_PX:    50,
  TRAIL_ALPHA_OPEN: 22,
  TRAIL_ALPHA_CLOSE: 80,
  DESATURATION_OPEN: 0.45,
  PARTICLE_ALPHA: 200,

  // ============ 记忆态（闭眼）·胶片记忆质感 ============
  // 多相位呼吸：3 个错相位的正弦，各驱动不同元素，避免"机械齐步"
  BREATH_MAIN_MS:       7800,    // 主相位：scale + tint α
  BREATH_SECONDARY_MS:  11000,   // 次相位：vignette + light leak
  BREATH_TERTIARY_MS:   5400,    // 三相位：drift + color grade
  BREATHE_SCALE_AMPL:   0.018,   // ±1.8% 缓慢缩放
  BREATHE_TINT_AMPL:    0.18,    // tint α 呼吸幅度（85%↔100%）
  BREATHE_VIG_AMPL:     0.20,    // vignette 强度呼吸
  DRIFT_PX:             5,       // Ken Burns 微漂移峰值
  TINT_BASE_ALPHA:      0.92,    // 记忆主图基础不透明度

  // Orange-teal color grading（王家卫式：高光暖橙、阴影青绿）
  GRADE_HIGHLIGHT_RGB:   [255, 200, 140],
  GRADE_HIGHLIGHT_ALPHA: 30,     // SCREEN 叠加，让高光偏暖
  GRADE_SHADOW_RGB:      [70, 95, 115],
  GRADE_SHADOW_ALPHA:    38,     // MULTIPLY 叠加，让阴影偏青

  // Halation 高光晕（胶片乳剂的物理光溢出）
  HALATION_BLUR1:        6,      // 第一次模糊
  HALATION_THRESHOLD:    0.62,   // 提取高光阈值（0..1）
  HALATION_BLUR2:        14,     // 第二次模糊（决定光晕大小）
  HALATION_TINT:         [255, 175, 110],
  HALATION_ALPHA:        130,

  // Light leak 漂移漏光（老相机偶然漏光的暖色斑）
  LIGHT_LEAK_RGB:        [255, 195, 130],
  LIGHT_LEAK_PEAK:       0.30,   // 中心 alpha 峰值（0..1）
  LIGHT_LEAK_DRIFT_HZ:   0.12,   // 位置漂移频率（极慢）

  // Vignette
  VIGNETTE_INTENSITY:    0.72,

  // Colored grain（彩色噪点 > 单色，更胶片）
  GRAIN_DENSITY:         420,
  GRAIN_ALPHA:           24,
};

// ============== 状态 ==============
let video;
let videoReady = false;
let sampleBuf;          // 低分辨率视频缓冲（粒子化用）
let memoryGfx;          // 与 canvas 同尺寸的"记忆帧"
let memoryHasFrame = false;

let halationGfx;        // 高光晕缓存（从 memoryGfx 烘焙得到）
let halationStale = true;

let earWarmupFrames = 0;
let maxEAR = 0;
let smoothOpenness = 0;

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

  halationGfx = createGraphics(width, height);
  halationGfx.pixelDensity(1);
  halationGfx.noStroke();

  background(0);

  statusDiv = createDiv("");
  statusDiv.id("status");
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  memoryGfx = createGraphics(width, height);
  memoryGfx.pixelDensity(1);
  memoryGfx.noStroke();
  memoryGfx.background(0);

  halationGfx = createGraphics(width, height);
  halationGfx.pixelDensity(1);
  halationGfx.noStroke();

  memoryHasFrame = false;
  halationStale = true;
  background(0);
}

function draw() {
  updateStatus();

  if (!videoReady || !window.__twtm.video || video.elt.readyState < 2) return;

  updateOpenness();
  refreshSampleBuf();

  if (smoothOpenness > CFG.MEMORY_REFRESH_OPENNESS || !memoryHasFrame) {
    refreshMemoryGfx();
  }

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

  const trailA = lerp(CFG.TRAIL_ALPHA_CLOSE, CFG.TRAIL_ALPHA_OPEN, mix);
  background(0, trailA);

  if (mix > 0.02) drawParticleLayer(mix);

  const phase = breathPhases();

  if (mix < 0.98 && memoryHasFrame) {
    drawMemoryLayer(1 - mix, phase);
  }

  drawVignette(1 - mix, phase);
  drawColoredGrain(1 - mix);
}

// ============== 眼睁度 ==============
function updateOpenness() {
  const eye = window.__twtm.eye;
  if (!eye || typeof eye.openness !== "number") return;

  const ear = eye.openness;

  if (earWarmupFrames < CFG.EAR_WARMUP_FRAMES) {
    if (ear > maxEAR) maxEAR = ear;
    earWarmupFrames++;
    return;
  }
  if (ear > maxEAR) maxEAR = ear;
  if (maxEAR <= 0.01) return;

  const ratio = constrain(ear / maxEAR, 0, 1.5);
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
  memoryGfx.image(video, width - offX - drawW, offY, drawW, drawH);
  memoryGfx.pop();
  memoryHasFrame = true;
  halationStale = true; // 记忆帧更新 → halation 缓存作废，待 lazy bake
}

// ============== 粒子层（睁眼态） ==============
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

      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = r + (gray - r) * desat;
      g = g + (gray - g) * desat;
      b = b + (gray - b) * desat;

      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * jitter;
      const px = x * cellW + cellW * 0.5 + Math.cos(angle) * dist;
      const py = y * cellH + cellH * 0.5 + Math.sin(angle) * dist;

      fill(r, g, b, pa);
      ellipse(px, py, psize, psize);
    }
  }
}

// ============== 三个错相位的呼吸正弦 ==============
// 主 / 次 / 三相位周期不同（7.8s / 11s / 5.4s），分别驱动不同元素，
// 互相错开避免"齐步呼吸"那种机械感。返回 [-1, 1] 的正弦值。
function breathPhases() {
  const t = millis();
  const wave = (period) => Math.sin((t / period) * Math.PI * 2);
  return {
    main:      wave(CFG.BREATH_MAIN_MS),
    secondary: wave(CFG.BREATH_SECONDARY_MS),
    tertiary:  wave(CFG.BREATH_TERTIARY_MS),
  };
}

// ============== 记忆层主流程：主图 + 分级 + 高光晕 + 漏光 ==============
function drawMemoryLayer(strength, phase) {
  // ── 1. 主图：呼吸缩放 + Ken Burns 微漂移 + tint α 呼吸 ─────────────
  const scl = 1 + CFG.BREATHE_SCALE_AMPL * phase.main;
  const driftX = CFG.DRIFT_PX * phase.tertiary;
  const driftY = CFG.DRIFT_PX * 0.7 * phase.secondary;
  const tintFactor =
    CFG.TINT_BASE_ALPHA *
    (1 + CFG.BREATHE_TINT_AMPL * 0.5 * (phase.main + 1) * 0.5);
  const tintA = constrain(tintFactor, 0, 1) * 255 * strength;

  push();
  translate(width / 2 + driftX, height / 2 + driftY);
  scale(scl);
  imageMode(CENTER);
  tint(255, tintA);
  image(memoryGfx, 0, 0, width, height);
  noTint();
  imageMode(CORNER);
  pop();

  // ── 2. Orange-teal color grading：高光暖、阴影青 ───────────────────
  drawColorGrading(strength, phase);

  // ── 3. Halation 高光晕（lazy bake） ──────────────────────────────
  if (halationStale) bakeHalation();
  drawHalation(strength, phase);

  // ── 4. Light leak 漂移漏光 ───────────────────────────────────────
  drawLightLeak(strength, phase);
}

// ============== Halation 烘焙：高光区域柔光晕 ==============
// 思路：拷贝 memoryGfx → 模糊 → 阈值化提取高光 → 二次模糊扩散
// 输出 halationGfx 是一张"只有亮部、糊开的暖色光斑"，叠回主画面用 SCREEN
// 烘焙较慢（filter 全屏），但记忆帧不变时只算一次（halationStale flag）。
function bakeHalation() {
  halationGfx.clear();
  halationGfx.image(memoryGfx, 0, 0, width, height);
  halationGfx.filter(BLUR, CFG.HALATION_BLUR1);
  halationGfx.filter(THRESHOLD, CFG.HALATION_THRESHOLD);
  halationGfx.filter(BLUR, CFG.HALATION_BLUR2);
  halationStale = false;
}

function drawHalation(strength, phase) {
  // 强度跟主相位轻微呼吸
  const breath = 0.85 + 0.15 * (phase.main + 1) * 0.5;
  const a = CFG.HALATION_ALPHA * strength * breath;

  drawingContext.save();
  drawingContext.globalCompositeOperation = "screen";
  push();
  tint(
    CFG.HALATION_TINT[0],
    CFG.HALATION_TINT[1],
    CFG.HALATION_TINT[2],
    a
  );
  image(halationGfx, 0, 0, width, height);
  noTint();
  pop();
  drawingContext.restore();
}

// ============== Orange-teal color grading ==============
// 用 canvas blendMode 实现简化版：
//   SCREEN 暖色 → 推高光偏橙（亮部反应强、暗部反应弱，符合"高光暖"）
//   MULTIPLY 青色 → 推阴影偏青（暗部反应强、亮部反应弱，符合"阴影青"）
// 不是真正 LUT 但视觉上接近王家卫《花样年华》经典分级。
function drawColorGrading(strength, phase) {
  noStroke();

  const ctx = drawingContext;
  const sway = 1 + 0.1 * phase.tertiary; // 分级强度也微弱呼吸（±10%）

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  fill(
    CFG.GRADE_HIGHLIGHT_RGB[0],
    CFG.GRADE_HIGHLIGHT_RGB[1],
    CFG.GRADE_HIGHLIGHT_RGB[2],
    CFG.GRADE_HIGHLIGHT_ALPHA * strength * sway
  );
  rect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  fill(
    CFG.GRADE_SHADOW_RGB[0],
    CFG.GRADE_SHADOW_RGB[1],
    CFG.GRADE_SHADOW_RGB[2],
    CFG.GRADE_SHADOW_ALPHA * strength * sway
  );
  rect(0, 0, width, height);
  ctx.restore();
}

// ============== Light leak 漂移漏光 ==============
// 一团暖色径向光斑在画面右上 / 左下间缓慢漂移，强度跟次相位呼吸。
// 用 SCREEN 叠加（加性），不会压暗下层。
function drawLightLeak(strength, phase) {
  const t = millis() / 1000;
  const cx = width  * (0.68 + 0.10 * Math.sin(t * CFG.LIGHT_LEAK_DRIFT_HZ));
  const cy = height * (0.22 + 0.08 * Math.cos(t * CFG.LIGHT_LEAK_DRIFT_HZ * 0.83));
  const r = Math.min(width, height) * 0.62;

  const breath = 0.6 + 0.4 * (phase.secondary + 1) * 0.5;
  const peak = CFG.LIGHT_LEAK_PEAK * strength * breath;

  const ctx = drawingContext;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const [lr, lg, lb] = CFG.LIGHT_LEAK_RGB;
  grad.addColorStop(0,    `rgba(${lr},${lg},${lb},${peak.toFixed(3)})`);
  grad.addColorStop(0.45, `rgba(${lr},${lg},${lb},${(peak * 0.45).toFixed(3)})`);
  grad.addColorStop(1,    `rgba(${lr},${lg},${lb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// ============== Vignette（强度也呼吸） ==============
function drawVignette(strength, phase) {
  if (strength < 0.05) return;

  const intensity =
    CFG.VIGNETTE_INTENSITY *
    (1 + CFG.BREATHE_VIG_AMPL * phase.tertiary) *
    strength;

  const ctx = drawingContext;
  const cx = width / 2;
  const cy = height / 2;
  const r0 = Math.min(width, height) * 0.32;
  const r1 = Math.max(width, height) * 0.75;

  ctx.save();
  const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(0,0,0,${intensity.toFixed(3)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// ============== Colored grain（彩色 1px 噪点） ==============
// 单色白点过于"数字噪声"；胶片 grain 的本质是 RGB 三通道独立噪声，
// 视觉上是带色相的随机点，更接近真实底片质感。
function drawColoredGrain(strength) {
  if (strength < 0.05) return;

  noStroke();
  const a = CFG.GRAIN_ALPHA * strength;
  for (let i = 0; i < CFG.GRAIN_DENSITY; i++) {
    const r = 200 + Math.random() * 55;
    const g = 175 + Math.random() * 75;
    const b = 145 + Math.random() * 105;
    fill(r, g, b, a);
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
  statusDiv.html("睁眼是粒子，闭眼是记忆。");
}
