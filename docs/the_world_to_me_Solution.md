# the_world_to_me — Solution

## 概念

**核心反转**：睁眼时世界是粒子化的混沌；闭眼时记忆里的画面反而清晰、温暖、定格。

> 我们以为在"看"世界，但真正"看见"的是记忆里那个被沉淀过的画面。
> 当下的现实总是模糊、流动、抓不住。
> 闭眼那一刻，世界才被记起。

## 视觉两态

| 状态 | EAR | 摄像头 | 视觉处理 |
|---|---|---|---|
| 完全睁眼 | ≥ 0.30 | 实时 | 像素采样为粒子；最大抖动半径 40px；颜色去饱和 0.7 |
| 中间过渡 | 0.10-0.30 | 实时 | 抖动半径线性插值；饱和度回升 |
| 完全闭眼 | < 0.10 | **冻结上一帧** | 暖色叠加 (255,220,180,30)；vignette；film grain；1-2% 呼吸缩放 |

## 搜索结论

1. **WebSearch（跨边界）**：不再单独搜，已有项目内验证过的范本。
2. **`git log -S 'FaceLandmarker'`**：项目根目录 (`CREATE/`) 不是 git 仓库；同级 `thousands_of_me/` 是独立 git 仓库且已用过 `FaceLandmarker.createFromOptions` 调用，附带 GPU→CPU 回退、CDN 多源、20s 超时。**直接复用其 `mediapipe.js`**。
3. **Grep / Glob**：`thousands_of_me/mediapipe.js` 算 EAR 用 `eye.h/eye.w` 作为 raw EAR（line 47-49 的 `SNAPSHOT_EAR_MIN=0.22` / `EAR_HIGH_RATIO=0.80` / `EAR_LOW_RATIO=0.40`）—— 直接照抄。

## 方案选择

### Decision #1：粒子化方式 → p5 像素采样 + 抖动绘制

- **选了**：从 video 元素每 `PARTICLE_GRID=4` 像素取一个采样点，按颜色画小圆，眼睁度直接驱动抖动半径
- **放弃了**：
  - WebGL fragment shader（炫但 fallback 麻烦，p5 + WEBGL 模式与现有栈耦合复杂）
  - RGB 通道分离故障艺术（偏离"模糊看不清"的语义）
- **理由**：纯 CPU、零依赖、参数好调；和 thousands_of_me 同栈；柔粒子最贴"看不清的现实"

### Decision #2：闭眼=冻结上一帧 + 1-2% 呼吸缩放

- **选了**：闭眼瞬间锁定最后一张视频帧到 `p5.Graphics` 缓存，闭眼期间不更新摄像头帧；缓存帧绘制时按 `1.00 + 0.012 * sin(t * 0.0008)` 做缩放
- **放弃了**：
  - 完全静止冻结（用户选了 breathe，因为完全静止过于死板）
  - 闭眼后实时刷新 + 暖滤镜（弱化"记忆"对比）
- **理由**："呼吸"暗示画面是活的、是被回忆者的心跳带动着；又不至于丢掉"凝固"语义

### Decision #3：眼睁开度走双眼 EAR 平均 + 自适应基线

- EAR = `(top.y - bottom.y) / (outer.x - inner.x)`，左右眼独立算后取平均
- 头 `EAR_WARMUP_FRAMES=60` 帧（约 1s）收集 maxEAR 做"该用户的 100% 睁开"基线
- 阈值 ratio：`EYE_FULLY_OPEN_RATIO=0.80`（高于 maxEAR×0.80 算全开）；`EYE_FULLY_CLOSED_RATIO=0.30`（低于 maxEAR×0.30 算全闭）
- EMA 平滑系数 0.35（同 thousands_of_me），避免单帧 MediaPipe 跳变误触

### Decision #4：粒子层渲染策略 → 不每帧 clear，每帧低 alpha 黑色覆盖叠加

- **选了**：每帧 `background(0, 25)` 半透明黑底叠加，粒子层在其上绘制
- **放弃了**：每帧完整 clear（粒子瞬间消失，太硬）
- **理由**：保留约 5 帧的轨迹尾迹，加强"流动看不清"的感觉；闭眼态切换时 alpha 加大到 80 让残影快速清掉

## 文件结构

```
the_world_to_me/
├── index.html              # 入口：p5.js CDN + 模块入口
├── style.css               # 全黑底 + canvas 居中
├── mediapipe.js            # 改自 thousands_of_me，新增 eyeOpenness 字段
├── sketch.js               # 核心：粒子化 + 记忆质感
├── README.md               # 项目说明 + 本地运行
├── .gitignore              # 复用 thousands_of_me
└── docs/
    └── the_world_to_me_Solution.md   # 本文件
```

## 主要参数（sketch.js 头部集中）

```js
const CFG = {
  // 眼睁度（基于 maxEAR 自适应基线的比例）
  EYE_FULLY_CLOSED_RATIO: 0.30,
  EYE_FULLY_OPEN_RATIO:   0.80,
  EAR_WARMUP_FRAMES:      60,
  OPENNESS_EMA:           0.35,

  // 粒子化（睁眼态）
  PARTICLE_GRID:    4,      // 每 N 像素一个粒子
  PARTICLE_SIZE:    3,
  MAX_JITTER_PX:    40,     // 完全睁眼时的最大抖动
  TRAIL_ALPHA_OPEN: 25,     // 睁眼态的尾迹（小=尾迹长）
  TRAIL_ALPHA_CLOSE: 80,    // 闭眼态切换时残影快速清掉
  DESATURATION:     0.30,   // 睁眼态去饱和强度

  // 记忆态（闭眼）
  MEMORY_TINT:        [255, 220, 180],
  MEMORY_TINT_ALPHA:  30,
  VIGNETTE_INTENSITY: 0.6,
  GRAIN_INTENSITY:    0.08,
  BREATHE_AMPL:       0.012,    // 呼吸缩放幅度（1.012 - 0.988）
  BREATHE_PERIOD_MS:  7800,     // 呼吸周期
};
```

## 审美自检

- **焦点**：粒子主体始终是用户面前的世界，画面中心是观线焦点；vignette 把视线收进中心
- **层次**：粒子层（动）→ 记忆叠色（半透明）→ vignette + grain（极淡覆盖）；只有三层，每层有理由
- **留白**：黑底 + vignette 自然衰减，不撑满
- **色彩**：睁眼去饱和 ↘ 冷感；闭眼暖偏移 ↗；少而准，和谐里仅一处强对比（睁眼碎 vs 闭眼整）
- **强对比**：睁眼"看不清"的运动感 vs 闭眼"清晰但凝固"的静——全片唯一对比

## 实现记录

### 与方案的差异

- **Decision #4 调整**：trail 黑底 alpha 改为 `lerp(80, 22, mix)` 双向插值。理由：闭眼态更需要清掉粒子残影，22→80 双端值更符合实际效果。
- **粒子大小新增 `PARTICLE_SIZE_OPEN=7`**：完全睁眼时粒子放大到 7px，让"散"的视觉感更强；闭眼时收回到 4px。原方案只有一个固定大小。
- **memoryGfx 用 cover 适配**：摄像头 16:9 vs canvas 任意比例，方案没说怎么对齐。实现时做了 cover（短边铺满，长边裁剪）保证不变形不留黑边。
- **状态文本浮层**：方案没规划，实现时加了 `<div id="status">` 在左下角小字提示（"校准中…/睁眼是粒子，闭眼是记忆。"）。错误时变红。

### 验证方式

```bash
cd the_world_to_me
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

期望体验：
1. 第一次打开请求摄像头权限。
2. 头 ~1 秒底部小字显示"校准中… N/60"——这是采集你的 maxEAR。校准期间请保持自然睁眼。
3. 校准完成后：
   - 自然睁眼 → 画面被采样为 ~14400 颗柔粒子，每颗带最多 50px 抖动，颜色稍微去饱和——像隔着雾看世界。
   - 慢慢闭眼 → 粒子抖动半径渐缩，颜色饱和度回升，画面渐渐清晰。
   - 完全闭眼 → 上一次睁眼时的画面被定格、加暖色叠加 (255,218,175) at α=55、四周 vignette、有 film grain、画面整体在 7.8s 周期内做 ±1.4% 缓慢呼吸缩放。

### 静态冒烟（已通过）

- ReadLints：无错误
- HTTP 200 全部 6 个端点（index.html / style.css / sketch.js / mediapipe.js / README.md / docs/Solution.md）

### 真实形态门禁（待用户在浏览器测）

浏览器交互项无法在 agent 端验证，留给用户在 Chrome/Edge 打开 localhost 测试。已知风险点：
1. p5 每帧 14400 ellipse + 14400 像素读取，性能瓶颈点。如果 fps 掉到 30 以下，第一档优化是降 `SAMPLE_W=120, SAMPLE_H=68`（变 8160 粒子）。
2. 部分笔记本前置摄像头驱动会自动镜像，叠加代码里的镜像可能导致左右反转。如出现"挥右手画面动左手"反过来，去掉 `refreshSampleBuf` 和 `refreshMemoryGfx` 里的 `scale(-1,1)`。
3. `EAR_WARMUP_FRAMES=60` 假设 60fps；性能差时 warmup 时间会变长（依然以 60 帧计），可接受。

## Code Review

### Must

- [x] **EAR 自适应基线**：`maxEAR` 在 warmup 后仍持续放大（防止用户后来睁更大眼时基线过低）。已实现。
- [x] **丢脸不归零 openness**：mediapipe.js 的 `loop()` 里 `result.faceLandmarks.length === 0` 时 return 不更新 gazeData——避免假闭眼触发记忆态。已实现。
- [x] **memoryGfx 重建保护**：`windowResized` 时清空 `memoryHasFrame`，防止用拉伸过的旧帧。已实现。
- [x] **错误兜底**：`window.addEventListener('error')` + `unhandledrejection` 在 index.html 内联，确保 MediaPipe 加载失败时显示友好错误。已实现。
- [x] **20s 超时**：mediapipe.js 末尾 setTimeout 把 `__mpStatus` 摊成错误。复用范本逻辑。已实现。

### Should

- [x] **常量集中**：所有可调参数集中在 `CFG` 对象。已实现。
- [x] **状态可视**：有 `#status` div，校准/错误状态对用户透明。已实现。
- [x] **审美自检**：见方案"审美自检"段，三层视觉、留白、强对比都按设计落地。

### Nice（未做，留作后续）

- [ ] 性能监控：`frameRate()` 显示在状态条
- [ ] 全屏快捷键 F：让作品填满显示器
- [ ] 录屏导出按钮：把当前体验录成 mp4 / gif

### 结论

**通过。** 静态冒烟过；真实浏览器交互留给用户终验。

实现没有偏离方案设计意图，仅在小细节（trail 双端值、粒子大小双端值、cover 适配、状态浮层）做了对体验友好的补充。

## Decision #N footer 索引（便于 git log --grep）

- Decision #1：粒子化方式 → p5 像素采样 + 抖动绘制
- Decision #2：闭眼=冻结上一帧 + 1-2% 呼吸缩放
- Decision #3：眼睁开度走双眼 EAR 平均 + 自适应基线
- Decision #4：粒子层渲染策略 → 不每帧 clear，每帧低 alpha 黑色覆盖叠加

