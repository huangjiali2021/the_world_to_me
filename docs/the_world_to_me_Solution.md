# the_world_to_me — Solution

## 概念

**核心反转**：睁眼时世界是粒子化的混沌；闭眼时记忆里的画面反而清晰、温暖、定格。

> 我们以为在"看"世界，但真正"看见"的是记忆里那个被沉淀过的画面。
> 当下的现实总是模糊、流动、抓不住。
> 闭眼那一刻，世界才被记起。

## 视觉两态

| 状态 | EAR / maxEAR | 摄像头 | 视觉处理 |
|---|---|---|---|
| 完全睁眼 | ≥ 0.80 | 实时 | 像素采样为 ~14400 颗柔粒子；最大抖动半径 50px；颜色去饱和 0.45 |
| 中间过渡 | 0.30 - 0.80 | 实时 | 抖动半径 / 饱和度 / 粒子大小同步线性插值 |
| 完全闭眼 | < 0.30 | **冻结上一帧** | Orange-teal 分级 + halation 高光晕 + 漂移漏光 + 多相位呼吸 + Ken Burns 微漂移 + 彩色 grain（v2 详见 Decision #5） |

## 搜索结论

跨边界调用只有一个：MediaPipe FaceLandmarker。

1. **WebSearch（外部最佳实践）**：MediaPipe 官方 web sample 推荐组合 = `tasks-vision` ESM 包 + `FilesetResolver.forVisionTasks(wasmBase)` + `FaceLandmarker.createFromOptions({ runningMode: "VIDEO", numFaces: 1 })`。CDN 只用 jsdelivr 的官方 demo 在国内偶发 502，需要自己加备份。
2. **本项目历史**：仓库初创，无历史调用点。
3. **Grep / Glob**：项目内无 FaceLandmarker 既有实现。

→ 调用形态在 `face-tracker.js` 内自洽，CDN 三档（jsdelivr / unpkg / esm.sh）+ wasm 同域兜底。

## 方案选择

### Decision #1：粒子化方式 → p5 像素采样 + 抖动绘制

- **选了**：从低分辨率视频缓冲（160×90）逐像素读 RGB，每个采样点在主画布上画一颗带随机偏移的小圆，眼睁度直接驱动偏移半径
- **放弃了**：
  - WebGL fragment shader（视觉更炫，但 p5 + WEBGL 模式与 2D context 切换复杂，丢失 retain-mode 调试便利性）
  - RGB 通道分离故障艺术（语义偏离"模糊看不清"，更像电视雪花）
- **理由**：p5 2D 模式纯 CPU、零额外依赖；柔粒子最贴"现实是被噪声晃糊的"这一意象；参数对人友好

### Decision #2：闭眼=冻结上一帧 + 1-2% 呼吸缩放

- **选了**：闭眼态绘制时不再从摄像头取新帧，而是把"最后一次睁眼时的画面"从 `memoryGfx` 缓冲里取出，外加 `1 + 0.014 · sin(2π·t/7800ms)` 的整体缩放
- **放弃了**：
  - 完全静止冻结（过于死板，失去"画面是被人回忆着"的温度）
  - 闭眼后实时刷新 + 暖滤镜（弱化"现实/记忆"对比）
- **理由**：呼吸感暗示记忆是被某个人持续注视的活物；定格保留"凝固"语义。两者矛盾但互补

### Decision #3：眼睁开度 = 双眼 EAR 平均 + 自适应基线

- EAR = `|top.y − bottom.y| / |outer.x − inner.x|`，左右眼独立算后取平均
- 头 60 帧（约 1s @60fps）只采集 `maxEAR`，作为"该用户睁到 100%"的基线
- 阈值用比例：`EYE_FULLY_OPEN_RATIO = 0.80` / `EYE_FULLY_CLOSED_RATIO = 0.30`
- EMA 平滑系数 0.35：足够跟手又能吃掉 MediaPipe 单帧跳变
- **理由**：直接用绝对 EAR 阈值在不同人脸上偏差大（眼形、距离都影响）；自适应基线让作品对每个观众重新校准

### Decision #4：粒子层渲染策略 → 半透明黑底 trail

- **选了**：每帧 `background(0, α)` 半透明叠加 + 全量粒子重绘；α 在睁/闭两态之间双向插值（睁眼 22 / 闭眼 80）
- **放弃了**：每帧完整 `clear()`（粒子瞬间消失，运动感太硬）
- **理由**：留约 4-5 帧的轨迹尾迹，加强"流动看不清"的感觉；切到闭眼时 α 加大让残影迅速被记忆层盖掉，避免两层混叠脏画

### Decision #5：闭眼态升级到电影记忆质感（v2）

v1 用单色暖叠 + vignette + 单色 grain + 单频呼吸，色彩太"单调暖"，缺艺术家做"记忆"的层次感。v2 借鉴电影 / 胶片美学经验，把闭眼态拆成 6 个独立可调的视觉层。

**外部灵感来源（WebSearch）**

- 王家卫 *In the Mood for Love* / *Fallen Angels*：smudge motion（快门 + 帧重叠把动作糊住）+ lush framing；记忆是"凝住即将消逝的瞬间"
- Tarkovsky *Nostalghia*：sculpting in time，"现在被过去叠加"——画面应有多重时间相位
- 胶片美学四件套：halation（乳剂物理光溢出）/ light leak（漏光）/ colored grain / orange-teal grading

**新增视觉层（按渲染顺序，从底到顶）**

1. **主图 + Ken Burns 微漂移**：±5px 二维漂移（次相位 + 三相位驱动），主相位驱动 ±1.8% 缩放，tint α 也呼吸
2. **Orange-teal color grading**：用 canvas blendMode 做近似 LUT
   - SCREEN 暖色 (255, 200, 140) α=30 → 推高光偏橙
   - MULTIPLY 青色 (70, 95, 115) α=38 → 推阴影偏青
   - 分级强度也跟三相位呼吸 ±10%
3. **Halation 高光晕**：从 memoryGfx 烘焙缓存（懒计算，记忆帧不变时只算一次）
   - blur 6 → threshold 0.62 → blur 14 → 暖色 tint (255,175,110) → SCREEN 叠回
   - 强度跟主相位呼吸 ±15%
4. **Light leak 漂移漏光**：径向暖色 gradient
   - 中心位置 (0.68w, 0.22h) 缓慢漂移（0.12Hz 主频 + 0.83 倍频错位）
   - peak α 跟次相位呼吸 60%↔100%
   - SCREEN 叠加，加性不压暗
5. **Vignette**：强度跟三相位呼吸 ±20%
6. **Colored grain**：RGB 三通道独立噪声（暖偏区间），420 颗 / 帧；视觉上比单色白点更胶片

**多相位呼吸**

| 相位 | 周期 | 驱动 |
|---|---|---|
| 主 | 7.8s | scale + tint α + halation 强度 |
| 次 | 11s | vignette + light leak 呼吸 + 轻微 drift Y |
| 三 | 5.4s | drift X + color grading 强度 |

三个错频不重合，避免"齐步呼吸"那种机械感。

**性能**

闭眼态没有粒子层，每帧只有几张 image / radial gradient / rect blendMode。Halation 用 lazy bake 避免每帧 filter（filter 全屏是真贵），记忆帧不变时只算一次。

**放弃的元素**

- **Chromatic aberration（红蓝分离）**：容易过头变 glitch，偏离"温柔记忆"语义
- **Edge smudge**：和 halation 视觉重叠，性价比低

## 文件结构

```
the_world_to_me/
├── index.html                            # 入口：p5 CDN + 项目命名空间 + 全局错误兜底
├── style.css                             # 全黑底 + canvas 居中 + 状态浮层
├── face-tracker.js                       # MediaPipe FaceLandmarker driver
├── sketch.js                             # 粒子层 + 记忆层 + vignette / grain
├── README.md                             # 项目说明 + 本地运行
├── .gitignore                            # 标准 web 项目忽略集
└── docs/
    └── the_world_to_me_Solution.md       # 本文件
```

## 模块约定

face-tracker 和 sketch 之间通过 `window.__twtm` 命名空间通信：

| 字段 | 写入方 | 读取方 | 含义 |
|---|---|---|---|
| `__twtm.video` | sketch | face-tracker | sketch 拿到 getUserMedia stream 后回写 `<video>` 元素引用 |
| `__twtm.eye` | face-tracker | sketch | 每帧推断结果 `{ openness, left, right, ts }` |
| `__twtm.status` | face-tracker | sketch | 启动阶段文字（fetching package / GPU / CPU / ready） |
| `__twtm.error` | face-tracker / inline | sketch | 致命错误，sketch 用红字摊到屏底 |
| `__twtm.ready` | face-tracker | sketch | landmarker 就绪，可以开始 detect |

## 主要参数（sketch.js 头部 `CFG` 集中）

```js
const CFG = {
  EYE_FULLY_CLOSED_RATIO: 0.30,
  EYE_FULLY_OPEN_RATIO:   0.80,
  EAR_WARMUP_FRAMES:      60,
  OPENNESS_EMA:           0.35,
  MEMORY_REFRESH_OPENNESS: 0.5,

  // 粒子化（睁眼态）
  SAMPLE_W: 160, SAMPLE_H: 90,
  PARTICLE_SIZE_BASE: 4,
  PARTICLE_SIZE_OPEN: 7,
  MAX_JITTER_PX:    50,
  TRAIL_ALPHA_OPEN: 22,
  TRAIL_ALPHA_CLOSE: 80,
  DESATURATION_OPEN: 0.45,
  PARTICLE_ALPHA: 200,

  // 记忆态 v2 · 多相位呼吸
  BREATH_MAIN_MS:       7800,
  BREATH_SECONDARY_MS:  11000,
  BREATH_TERTIARY_MS:   5400,
  BREATHE_SCALE_AMPL:   0.018,
  BREATHE_TINT_AMPL:    0.18,
  BREATHE_VIG_AMPL:     0.20,
  DRIFT_PX:             5,
  TINT_BASE_ALPHA:      0.92,

  // 记忆态 v2 · Orange-teal grading
  GRADE_HIGHLIGHT_RGB:   [255, 200, 140], GRADE_HIGHLIGHT_ALPHA: 30,  // SCREEN
  GRADE_SHADOW_RGB:      [70, 95, 115],   GRADE_SHADOW_ALPHA:    38,  // MULTIPLY

  // 记忆态 v2 · Halation
  HALATION_BLUR1: 6, HALATION_THRESHOLD: 0.62, HALATION_BLUR2: 14,
  HALATION_TINT: [255, 175, 110], HALATION_ALPHA: 130,

  // 记忆态 v2 · Light leak
  LIGHT_LEAK_RGB: [255, 195, 130],
  LIGHT_LEAK_PEAK: 0.30,
  LIGHT_LEAK_DRIFT_HZ: 0.12,

  // 记忆态 v2 · Vignette + Grain
  VIGNETTE_INTENSITY: 0.72,
  GRAIN_DENSITY:      420,
  GRAIN_ALPHA:        24,
};
```

## 审美自检

- **焦点**：粒子主体始终是用户面前的世界；vignette 把视线收向中心
- **层次**：粒子层（动）→ 记忆叠色（半透明）→ vignette + grain（极淡覆盖）；只三层，每层都有理由
- **留白**：黑底 + vignette 自然衰减，不撑满
- **色彩**：睁眼去饱和 ↘ 冷感；闭眼暖偏移 ↗；少而准
- **强对比**：睁眼"看不清的运动" vs 闭眼"清晰但凝固"——全片唯一对比

## 实现记录

### 与方案的差异

- **trail alpha 改双向插值**：原计划只有一个值；实际中粒子残影在闭眼态切换时拖累记忆层观感，改成 `lerp(80, 22, mix)`（睁=22 / 闭=80）
- **粒子大小双端值**：原计划固定 3px；实际"睁眼很散"的视觉感不够，给睁眼端放大到 7px，从大→小也是"看清"过程的一部分
- **memoryGfx 用 cover 适配**：摄像头 16:9 vs canvas 任意比例，方案没说怎么对齐。实现时按 cover（短边铺满，长边裁剪），保证不变形不留黑边
- **状态浮层**：方案没规划，落地时加了左下角小字 `<div id="status">`，提示校准进度 / 错误，不抢主画面

### 验证方式

```bash
cd the_world_to_me
python -m http.server 8000
# 浏览器打开 http://localhost:8000，允许摄像头
```

期望体验：
1. 第一次访问请求摄像头权限。
2. 头 ~1 秒底部小字显示"校准中… N/60"，采集你的 maxEAR 基线，请保持自然睁眼。
3. 校准完成后：
   - 自然睁眼 → 画面成为 14400 颗柔粒子，每颗带最多 50px 随机偏移，颜色稍微去饱和
   - 慢慢眯眼 → 抖动半径渐缩，颜色饱和度回升，画面渐渐清晰
   - 完全闭眼 → 上一次清楚看见的画面被定格，加暖色叠加 (255,218,175) α=55，四周 vignette，film grain 飘动，画面整体在 7.8s 周期内做 ±1.4% 缓慢呼吸缩放

### 静态冒烟（已通过）

- ReadLints：无错误
- HTTP 200：index.html / style.css / sketch.js / face-tracker.js / README.md / docs/Solution.md 全部 200

### 真实形态门禁（待用户在浏览器测）

浏览器交互无法在 agent 端验证，留给用户在 Chrome / Edge 实测。已知风险点：
1. **性能**：14400 粒子 + 14400 像素读 + 每帧 RAF MediaPipe 推理。单帧 ~16ms 是基线。如 fps 跌破 30，第一档优化是 `SAMPLE_W=120 / SAMPLE_H=68`（→ 8160 粒子）
2. **镜像**：部分笔记本前置摄像头驱动会自动镜像，叠加代码内 `scale(-1,1)` 反而错了。如出现"挥右手画面动左手"反过来，去掉 `refreshSampleBuf` / `refreshMemoryGfx` 里的镜像变换
3. **WebGL 拒绝**：极少数显卡 / 远程桌面会让 GPU delegate 失败。face-tracker 已自动回退 CPU，但 CPU 推理 ~25ms/帧会拉低 fps，可观察控制台 `[twtm/face] GPU delegate failed`

## Code Review

### Must

- [x] **EAR 自适应基线**：warmup 期采集 maxEAR；warmup 后 maxEAR 仍可向上抬（防止用户后来睁更大眼时基线过低）
- [x] **丢脸不归零**：face-tracker 的 `tick()` 里 `faceLandmarks.length === 0` 直接 return，不更新 `__twtm.eye`；避免假闭眼触发记忆态
- [x] **memoryGfx 重建保护**：`windowResized` 时清 `memoryHasFrame`，下一次睁眼自动重新捕获，不会拉伸旧帧
- [x] **错误兜底**：index.html inline 监听 `error` + `unhandledrejection`，所有阶段的异常都能摊到 `__twtm.error`，sketch 状态条变红显示
- [x] **20s 超时**：face-tracker 末尾 `setTimeout` 把当前 `__twtm.status` 摊成错误，避免黑屏无解释

### Should

- [x] **常量集中**：sketch.js 所有可调参数收在 `CFG`
- [x] **状态可视**：`#status` div 把校准 / 加载 / 错误透出给用户
- [x] **审美自检**：见上"审美自检"段，三层视觉、留白、强对比都按设计落地

### Nice（未做，留作后续）

- [ ] 性能监控：把 `frameRate()` 写到状态条
- [ ] 全屏快捷键 F：让作品填满显示器
- [ ] 录屏导出按钮：当前体验录成 mp4 / gif

### 结论

**通过。** 静态冒烟过；浏览器交互留给用户终验。

实现没有偏离方案设计意图，仅在小细节（trail 双端值、粒子大小双端值、cover 适配、状态浮层）做了对体验友好的补充。

## Decision 索引（便于 git log --grep）

- Decision #1：粒子化方式 → p5 像素采样 + 抖动绘制
- Decision #2：闭眼=冻结上一帧 + 1-2% 呼吸缩放
- Decision #3：眼睁开度 = 双眼 EAR 平均 + 自适应基线
- Decision #4：粒子层渲染策略 → 半透明黑底 trail，不每帧 clear
- Decision #5：闭眼态升级到电影记忆质感 v2（orange-teal + halation + light leak + multi-phase breathing + Ken Burns + colored grain）
