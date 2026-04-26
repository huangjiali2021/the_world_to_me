// the world, to me — sketch
// 睁眼 = 摄像头画面粒子化模糊
// 闭眼 = latent-echo 多帧叠加 + orange-teal 分级 + halation 高光晕 + 漂移漏光 + 多相位呼吸 + film grain
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
  // 印象派厚涂：cell 仅 12×12px，OPEN=40 → 粒子直径 ≈ cell 3.3 倍 → 高度重叠
  // 14400 颗大圆 + POSTERIZE 64 色 + 径向焦点衰减 → "色域绘画 / 莫奈式涂抹"质感
  PARTICLE_SIZE_BASE: 8,
  PARTICLE_SIZE_OPEN:  40,
  MAX_JITTER_PX:    60,           // v3.7 50→60，颗粒更迷散
  TRAIL_ALPHA_OPEN: 22,
  TRAIL_ALPHA_CLOSE: 80,
  DESATURATION_OPEN: 0.25,        // v3.6 调小：让 POSTERIZE 后的色块色彩留下来，不被灰化
  PARTICLE_ALPHA: 200,
  // 跟闭眼 echo 共享"立体主义平涂"美学语言：在 sampleBuf 上做 POSTERIZE，
  // 粒子读出的颜色就是几色平涂（每通道 4 级 = 64 色，比 echo 的 3 级稍温和）。
  // 桥接的是色彩颗粒度，不是色板——粒子仍是摄像头采样色（保留"看世界"语义）。
  PARTICLE_POSTERIZE_LEVEL: 4,
  // 径向 alpha 衰减：体现"前路迷茫"——中心还算焦点，越往外越溶进迷雾
  // alpha *= 1 - FALLOFF * (dist/maxDist)^2  （平方衰减，避免每帧 14400 次 Math.pow）
  // 跟 mix（睁眼度）联动：完全闭眼时不衰减（粒子层本就近消失，无需扣 alpha）
  // FALLOFF=0.6 → 中心 1.0、半径中点 ~0.85、四角 ~0.4
  RADIAL_FOCUS_FALLOFF:    0.6,

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

  // ============ Latent-echo（多帧"过去"叠加） ============
  // 灵感：Refik Anadol 的 latent walk + Memo Akten 的 Deep Meditations
  // —— 现在被过去叠住，记忆是高维空间里的近邻游走。
  // 实现：env 一个 N 张全屏 graphics 的环形缓冲，每隔 INTERVAL 在睁眼时
  // 偷拍一张当前 memoryGfx 进 [0]；旧 entry 整体右挪，每挪一格做一次
  // 增量 BLUR；最老的释放。闭眼合成时从老到新画 echo，主 memoryGfx 在最上层。
  ECHO_LAYERS:                   4,        // memoryGfx 之外保留 4 张快照
  ECHO_COMMIT_INTERVAL_MS:    1100,        // 每 ~1.1s 偷拍一张
  ECHO_COMMIT_OPENNESS_MIN:   0.45,        // openness < 此值不 commit（闭眼时缓冲冻结）
  ECHO_DECAY:        [0.75, 0.55, 0.38, 0.22], // 加大 alpha：色块覆盖力更强（毕加索面片）
  ECHO_OFFSET_PX:    [25,   55,   95,   150 ], // 大幅加大，让 echo 真的探到主体外
  ECHO_BLUR_PER_COMMIT:        0.0,        // 不累积 BLUR：echo 保持原始锐度 → 色块感强
  // 毕加索立体主义色阶量化：commit 时对 echo 做一次 POSTERIZE，
  // 把每通道压到 N 级（256→3）→ 渐变变平涂色块。配合 tint 染色 → 一张脸被分成几片纯色面。
  ECHO_POSTERIZE_LEVEL:        3,          // 每通道 3 级 = 27 色 = 立体主义平涂感
  // 毕加索玫瑰-蓝色时期混合色板：饱和度更高、跨度更大的 4 段调子
  // echo[0] 玫瑰时期暖橙红 / echo[1] 《梦》玫红 / echo[2] 蓝色立体主义蓝紫 / echo[3] 冷青绿
  ECHO_PALETTE_RGB: [
    [255, 145,  80], // echo[0] 暖橙红
    [210,  75, 110], // echo[1] 玫红
    [ 90,  80, 165], // echo[2] 蓝紫
    [ 45, 130, 145], // echo[3] 冷青绿
  ],
  // Wong/Gush smudge motion：所有 echo 沿同一 trail 方向拖尾（不再各自随机），
  // 方向缓慢旋转一周，闭眼瞬间冻结当时的方向 → 时间拖尾感
  ECHO_TRAIL_ROTATE_MS:    18000,
};

// ============== 状态 ==============
let video;
let videoReady = false;
let sampleBuf;          // 低分辨率视频缓冲（粒子化用）
let memoryGfx;          // 与 canvas 同尺寸的"记忆帧"
let memoryHasFrame = false;

let halationGfx;        // 高光晕缓存（从 memoryGfx 烘焙得到）
let halationStale = true;

// Latent-echo 环形缓冲：[0] = 最近一次 commit 的快照，[N-1] = 最老
// 每项 { gfx: p5.Graphics }
// 注：v3.4 起所有 echo 共享同一 trail 方向（缓慢旋转），不再每个 echo 独立随机方向。
let memoryEchoes = [];
let echoCommitTimer = 0;
let echoesCommitted = 0; // 已经真正写入快照的层数（启动时为 0，最大 = ECHO_LAYERS）

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

  initEchoes();

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

  initEchoes();

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

  // Latent-echo：节奏性偷拍当前 memoryGfx 进环形缓冲
  // 闭眼时 commitEcho 内部会拒绝（openness 门槛），缓冲自然冻结
  if (millis() - echoCommitTimer >= CFG.ECHO_COMMIT_INTERVAL_MS) {
    commitEcho();
    echoCommitTimer = millis();
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
  // POSTERIZE：跟闭眼 echo 共享平涂色块美学语言
  // sampleBuf 仅 160×90，每帧 filter 开销 < 0.1ms，可忽略
  if (CFG.PARTICLE_POSTERIZE_LEVEL && CFG.PARTICLE_POSTERIZE_LEVEL > 1) {
    sampleBuf.filter(POSTERIZE, CFG.PARTICLE_POSTERIZE_LEVEL);
  }
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

// ============== Latent-echo 环形缓冲 ==============
// 把过去几个时间点的 memoryGfx 快照保留下来，闭眼合成时叠加，
// 模拟 latent space 里"附近游走"——记忆是高维空间里的近邻插值。
// commitEcho 是 commit 时机的唯一入口，门槛包括睁眼度 + warmup 完成。

function disposeEchoes() {
  for (const e of memoryEchoes) {
    if (e && e.gfx) e.gfx.remove();
  }
  memoryEchoes = [];
  echoesCommitted = 0;
}

function initEchoes() {
  disposeEchoes();
  for (let i = 0; i < CFG.ECHO_LAYERS; i++) {
    const g = createGraphics(width, height);
    g.pixelDensity(1);
    g.noStroke();
    g.background(0);
    memoryEchoes.push({ gfx: g });
  }
}

function commitEcho() {
  // 三道门槛：必须有可拷贝的最新帧 / EAR 校准完成 / 睁眼度足够
  if (!memoryHasFrame) return;
  if (earWarmupFrames < CFG.EAR_WARMUP_FRAMES) return;
  if (smoothOpenness < CFG.ECHO_COMMIT_OPENNESS_MIN) return;

  // 1. 释放最老一张（数组末尾）
  const oldest = memoryEchoes[memoryEchoes.length - 1];
  if (oldest && oldest.gfx) oldest.gfx.remove();

  // 2. 给除尾巴外的现有 entry 各做一次增量模糊
  // 累积下来：进入 [1] 模糊 1 次、[2] 2 次、...、[N-1] N-1 次
  for (let i = 0; i < memoryEchoes.length - 1; i++) {
    const e = memoryEchoes[i];
    if (e && e.gfx) e.gfx.filter(BLUR, CFG.ECHO_BLUR_PER_COMMIT);
  }

  // 3. 整体右挪：[i] ← [i-1]，从尾往头复制引用（不踩自己）
  for (let i = memoryEchoes.length - 1; i > 0; i--) {
    memoryEchoes[i] = memoryEchoes[i - 1];
  }

  // 4. 在 [0] 写入当前 memoryGfx 的全新快照
  //    立刻做 POSTERIZE：把渐变压成平涂色块（毕加索立体主义面片感）
  //    一次性付出，之后该 echo 在缓冲里始终是"几色平涂版"
  const fresh = createGraphics(width, height);
  fresh.pixelDensity(1);
  fresh.noStroke();
  fresh.image(memoryGfx, 0, 0, width, height);
  if (CFG.ECHO_POSTERIZE_LEVEL && CFG.ECHO_POSTERIZE_LEVEL > 1) {
    fresh.filter(POSTERIZE, CFG.ECHO_POSTERIZE_LEVEL);
  }
  memoryEchoes[0] = { gfx: fresh };

  if (echoesCommitted < memoryEchoes.length) echoesCommitted++;
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
  // 径向焦点：mix 越大（越睁眼）边缘越糊；闭眼瞬间 falloff=0 不衰减
  const falloff = mix * CFG.RADIAL_FOCUS_FALLOFF;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const invMaxDist2 = 1 / (cx * cx + cy * cy);

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

      const cellCx = x * cellW + cellW * 0.5;
      const cellCy = y * cellH + cellH * 0.5;
      const dx = cellCx - cx;
      const dy = cellCy - cy;
      const distNorm2 = (dx * dx + dy * dy) * invMaxDist2;
      const focus = 1 - falloff * distNorm2;

      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * jitter;
      const px = cellCx + Math.cos(angle) * dist;
      const py = cellCy + Math.sin(angle) * dist;

      fill(r, g, b, pa * focus);
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

// ============== 记忆层主流程：主图 + echo alpha 上叠 + 分级 + 高光晕 + 漏光 ==============
// 渲染顺序（从底到顶）：
//   memoryGfx                        ← 当前最锐利帧（按原 v2 α，整体打底）
//   echoes[N-1] → ... → echoes[0]    ← 普通 alpha 透叠在主图之上，色块感强
//   color grading
//   halation
//   light leak
//
// blend 演化：v3.0/3.1 alpha 下叠（echo 被主图遮）→ v3.2 SCREEN 上叠（亮度加性、太柔光雾）
// → v3.3 alpha 上叠（半透明色块叠在主图上，色块边缘清脆，像 multi-exposure 实物感）
// 配合 ECHO_BLUR_PER_COMMIT=0：echo 全程不模糊，4 张快照都是清晰的"过去自己"。
function drawMemoryLayer(strength, phase) {
  const scl = 1 + CFG.BREATHE_SCALE_AMPL * phase.main;
  const driftX = CFG.DRIFT_PX * phase.tertiary;
  const driftY = CFG.DRIFT_PX * 0.7 * phase.secondary;
  const tintFactor =
    CFG.TINT_BASE_ALPHA *
    (1 + CFG.BREATHE_TINT_AMPL * 0.5 * (phase.main + 1) * 0.5);
  const baseTintMult = constrain(tintFactor, 0, 1);

  // ── 1. 主图：当前帧、最锐利、按原 v2 α ────────────────────────────
  const tintA = baseTintMult * 255 * strength;
  push();
  translate(width / 2 + driftX, height / 2 + driftY);
  scale(scl);
  imageMode(CENTER);
  tint(255, tintA);
  image(memoryGfx, 0, 0, width, height);
  noTint();
  imageMode(CORNER);
  pop();

  // ── 2. Echo 层：Warhol 多重网版 × Wong 时间拖尾 ─────────────────────
  // (a) 所有 echo 共享同一 trail 方向（缓慢旋转）→ 时间拖尾感，不再各自乱飞
  // (b) 每张 echo 用独立色板染色（暖→冷）→ 多重网版式色块叠加
  // 从老到新画（[committed-1] → [0]）：较新色块覆盖较老
  const trailAngle =
    ((millis() % CFG.ECHO_TRAIL_ROTATE_MS) / CFG.ECHO_TRAIL_ROTATE_MS) *
    Math.PI *
    2;
  const trailCos = Math.cos(trailAngle);
  const trailSin = Math.sin(trailAngle);

  for (let i = echoesCommitted - 1; i >= 0; i--) {
    const e = memoryEchoes[i];
    if (!e || !e.gfx) continue;
    const layerDecay = CFG.ECHO_DECAY[i] || 0;
    if (layerDecay < 0.01) continue;

    const off = CFG.ECHO_OFFSET_PX[i] || 0;
    const ex = off * trailCos;
    const ey = off * trailSin;
    const a = baseTintMult * 255 * strength * layerDecay;
    const palette =
      CFG.ECHO_PALETTE_RGB[i] || [255, 255, 255];

    push();
    translate(width / 2 + driftX + ex, height / 2 + driftY + ey);
    scale(scl);
    imageMode(CENTER);
    tint(palette[0], palette[1], palette[2], a);
    image(e.gfx, 0, 0, width, height);
    noTint();
    imageMode(CORNER);
    pop();
  }

  // ── 3. Orange-teal color grading：高光暖、阴影青 ───────────────────
  drawColorGrading(strength, phase);

  // ── 4. Halation 高光晕（lazy bake，只来源于 memoryGfx 最锐利层） ──
  if (halationStale) bakeHalation();
  drawHalation(strength, phase);

  // ── 5. Light leak 漂移漏光 ───────────────────────────────────────
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
// 沉浸优先：正常运行态完全无字。
// 只在两种异常态显示：
//   1. 错误（红字）— 排错唯一线索
//   2. 摄像头未授权 — 不提示用户不知道点"允许"
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
  statusDiv.html("");
}
