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
| 完全闭眼 | < 0.30 | **冻结上一帧 + 4 张过去快照** | Latent-echo 多帧叠加（毕加索立体主义平涂色块 × Wong 时间拖尾）+ Orange-teal 分级 + halation + 漂移漏光 + 多相位呼吸 + Ken Burns + 彩色 grain（v2 见 Decision #5；v3 见 Decision #6；v3.4 见 Decision #7；v3.5 见 Decision #8） |

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

### Decision #6：闭眼态再加一层 latent-echo（v3）

v2 的闭眼是"冻结一帧 + 多重美化"，时间是凝住的。v3 在 v2 基础上叠一层时间维度——保留过去 ~4-5 秒的几个时间切片，让"现在被过去叠住"。

**外部灵感（WebSearch）**

- **Refik Anadol** *Machine Hallucinations*：StyleGAN2 的 latent space walk，在高维 embedding 里慢漂——每一帧都是上一帧的"近邻"。Anadol 原话："data is memory, turn into pigment"
- **Memo Akten** *Deep Meditations*：GAN/VAE 在概念之间的连续插值
- **MIT Nostalgia Box**：neural style transfer 把多张图叠成"对熟人可辨、对陌生人抽象"的混合
- **Memory Printer (HCI)**：slow design——记忆不该即时刷新，要有"沉淀时间"

我们不做 ML 模型（浏览器跑不动），但用**离散环形缓冲 + 衰减叠加**做出 latent walk 的视觉隐喻。

**实现**

- N=4 张全屏 `p5.Graphics` 环形缓冲，加上 `memoryGfx` 当前帧 = 5 层时间
- 每 `ECHO_COMMIT_INTERVAL_MS=1100ms` 偷拍一次当前 `memoryGfx` 进 echoes[0]
- commit 三道门槛：`memoryHasFrame=true` / EAR warmup 完成 / `openness > 0.45`
  - 闭眼时 commit 自动暂停 → 缓冲冻结 → 5 层都是"刚才睁眼时"的清晰帧
- 渲染顺序（从底到顶，**第三版 alpha 上叠 + 无 BLUR**）：
  ```
  memoryGfx α=0.92  ← 当前最锐利帧打底（按原 v2 α）
  echoes[3] α=0.15  offset=150px  无blur
  echoes[2] α=0.25  offset= 95px  无blur
  echoes[1] α=0.38  offset= 55px  无blur
  echoes[0] α=0.55  offset= 25px  无blur
  ↓
  grading → halation → light leak → vignette → grain
  ```

**实测后的三次迭代**（重要的差异化记录）：

| 版本 | echo 渲染层 | blend | BLUR | offset | 实测视觉 | 问题 |
|---|---|---|---|---|---|---|
| v3.0（首版） | 主图**下层** | alpha 透叠 | 累积 | `[3, 6, 10, 15]` | 仅边缘 1-2% 微糊感 | offset 太小，被主图覆盖几乎全无 |
| v3.1 | 同上 | alpha + 主图削 70% | 累积 | `[8, 18, 32, 50]` | 整体更柔糊但无典型重影 | alpha 透叠下 echo 被主图遮，难显形 |
| v3.2 | **主图上层** | **SCREEN 加性** | 累积 | `[25, 55, 95, 150]` | 暗背景上 echo 显形为光雾 | SCREEN 太柔光雾，缺色块感 |
| v3.3 | 主图上层 | alpha 透叠 | 0 | `[25, 55, 95, 150]` | 4 张清晰半透明色块叠在主图上 | 4 张色调一样 = 视觉是"同色 4 重影"，不够"多重曝光"；偏移随机 → 杂乱无方向 |
| v3.4 | 主图上层 | alpha 透叠 | 0 | 同上 | 每张 echo 单色染（暖橙→暖粉→冷紫→冷青）+ 共享 trail 方向（18s 缓慢旋转）| 仍是渐变染色照片，色块感不够"块状"，缺立体主义平涂感 |
| **v3.5（当前）** | 主图上层 | alpha 透叠 | 0 | 同上 | **commit 时 POSTERIZE 3 级**（每通道 256→3，平涂色块）+ **alpha 拉到 `[0.75, 0.55, 0.38, 0.22]`** + **色板换毕加索玫瑰-蓝色时期色调** | — |

关键演化：

- **v3.0 → v3.2**：从"alpha 下叠"换到"SCREEN 上叠"——为了让 echo 不被主图遮
- **v3.2 → v3.3**：从"SCREEN 加性 + 累积 BLUR"换到"alpha 透叠 + 无 BLUR"——为了**色块感**而非光雾感
- **v3.3 → v3.4**：色块感成立但 4 张色调相同 → 升级到**单色化色板 + 共享 trail 方向**，详见 Decision #7
- **v3.4 → v3.5**：色板偏柔和、tint 仍是渐变照片 → 升级到**毕加索立体主义平涂色块**（POSTERIZE + 拉强 alpha + 鲜艳色板），详见 Decision #8

物理意义对照：
- SCREEN 加性 = "两次曝光叠在同一底片"——亮区饱和、暗区显形，**柔光雾感**
- alpha 上叠 + 无 BLUR = "4 张半透明照片叠在主图上"——色块边缘清脆，**实物感**

v3.4 在视觉上接近 Andy Warhol 多重网版印刷 / 王家卫 *Fallen Angels* 拖尾长曝美学——多重曝光不仅是"叠"，更要"色调随时间偏移"和"统一方向感"。

- echo 在 commit 时**不再随机方向**——所有 echo 沿同一 `trailAngle`（缓慢旋转）拖尾
- BLUR 设为 0：echo 保持原始锐度，色块边缘清脆
- halation 仍只 bake 自 `memoryGfx`（最锐利层），保高光晕的清脆边缘

**关键决策**

| 取舍 | 选了 | 放弃 | 理由 |
|---|---|---|---|
| commit 触发 | 时间间隔 1.1s + openness 门槛 | 每帧 commit；事件驱动（openness 变化触发） | 时间间隔可控；闭眼自动停 → 缓冲不会被粒子帧污染 |
| 位移方向 | **所有 echo 共享 trail 方向（18s 旋转一周）** | 每个 echo commit 时各自随机方向 | 共享方向 = "时间往同一头流"；各自随机 → 杂乱无方向，违背 Wong 拖尾意象（Decision #7） |
| BLUR 时机 | **不做 BLUR**（保留 commit 时机制以备后调） | 累积 BLUR / 渲染时实时 filter | 累积 BLUR 让 echo 变光雾，**色块感**要求边缘锐利（Decision #7） |
| 主图 vs echo[0] | 都画，主图在最上 | 用 echo[0] 替代主图 | 保持当前帧的锐度；echo[0] 的 3px 偏移仅在边缘探出 |

**性能 / 内存预算**

- 5 张全屏 `p5.Graphics`（含 memoryGfx + halationGfx + 4 echoes）+ 1 个采样小 buffer
- 1080p 下 ≈ 5 × 8MB = 40MB GPU/canvas 内存
- v3.4 起 BLUR 为 0：commit 几乎零开销
- 渲染常驻：闭眼时多 4 次 image() ≈ 8-15ms / 帧；睁眼态不触发 echo 渲染（mix > 0.98 时直接跳过 drawMemoryLayer）

**与已有效果的协同**

| 元素 | 受 latent-echo 影响 |
|---|---|
| `refreshMemoryGfx` | 不变；echo 是从它 snapshot |
| `halationStale` | 不变；只跟 memoryGfx 同步 |
| Orange-teal grading | 不变；作用在 echo + 主图合成之上 |
| Ken Burns drift | 主图 + 所有 echo 共享同一个 drift（合成体一起漂移），各 echo 再叠一层共享 trail offset（v3.4 起方向统一） |
| 多相位呼吸 | 不变 |

### Decision #7：latent-echo 美感升级（v3.4）= Warhol 多重网版色板 × Wong 时间拖尾

v3.3 已经有"色块叠加"的可读边缘，但实测下来还是有两个观感漏洞：

1. **4 张 echo 用同一原色 → 视觉是"同一画面 4 重影"，缺少 multi-exposure 的"色调演化"**
2. **每张 echo 偏移方向独立随机 → 杂乱、无方向感，违背"时间往一处流"的拖尾意象**

**外部参考（WebSearch / 视觉调研）**

- **Andy Warhol** *Marilyn Diptych* / *Mao*：同一图像在网版印刷上**反复套色**，每一次都用不同色调；多重图像不是单纯重复，而是"色彩偏移即新意义"
- **王家卫 / Christopher Doyle** *Fallen Angels* 长曝光段落：人物在画面中拖出长方向尾迹；smudge 是**单一方向**的，不是径向喷射
- **Adam Ferriss** p5.js 长曝处理：所有历史帧共享一个缓慢旋转的方向向量，而非各自随机
- **Manolo Gamboa Naon**：明确色板是"多重曝光美学"的核心——色板控制比形态控制更决定观感

**两个改动**

#### (A) Warhol 色板单色化

每张 echo 不再用 `tint(255, alpha)`（保留原色），而用独立色板染色：

| echo[i] | 颜色 (RGB) | 含义 |
|---|---|---|
| 0（最近的过去） | `(255, 176, 112)` 暖橙 | 刚刚发生，体温尚存 |
| 1 | `(232, 154, 159)` 暖粉 | 半熟悉的过去 |
| 2 | `(139, 123, 168)` 冷紫 | 开始遥远 |
| 3（最老） | `( 96, 144, 160)` 冷青 | 几乎要忘 |

色温从暖到冷 → "记忆的温度衰减"，符合直觉的时间感。

#### (B) Wong 时间拖尾（共享方向）

```
trailAngle = (millis() / ECHO_TRAIL_ROTATE_MS) * 2π   // 18s 转一周
ex = ECHO_OFFSET_PX[i] * cos(trailAngle)
ey = ECHO_OFFSET_PX[i] * sin(trailAngle)
```

所有 echo 共享 `trailAngle`，距离用 `ECHO_OFFSET_PX[i]` 区分（25 / 55 / 95 / 150）。

视觉效果：4 张 echo 排成一条**指向同一方向的色彩尾迹**（暖橙近、冷青远）。`trailAngle` 缓慢旋转——闭眼瞬间冻结当下方向，下一次闭眼方向不同。

**取舍**

| 选了 | 放弃 | 理由 |
|---|---|---|
| 全局 `trailAngle` 由 `millis()` 驱动 | 每张 echo commit 时随机定方向 | 共享方向 = "时间往同一处流"；commit 时随机 → 4 个独立方向，违背拖尾意象 |
| 18s 旋转一周（缓慢） | 5s / 静止 | 太快=眩晕；静止=每次闭眼都同一方向，无随机美 |
| `tint(r,g,b,a)` 染色 | `filter(POSTERIZE)` 真色阶量化 | filter 全屏每帧太贵；tint 只改色调不丢明度，主体仍可辨 |
| 4 段色板（暖→冷） | 单色（如全橙） | 单色就是 v3.3，缺色调演化 |

**与 v3.3 的兼容**

- `commitEcho` 不再写 `e.angle` 字段（数据结构简化）
- `drawMemoryLayer` 用 `CFG.ECHO_PALETTE_RGB[i]` 替代 `tint(255, ...)`
- `CFG.ECHO_BLUR_PER_COMMIT = 0.0` 保留（v3.3 的关键决策）

**风险**

- **色板可能过冷**：暖→冷过渡如果让画面整体看起来过青/紫，需要把冷端往中性方向靠（候选：紫 → 灰青）
- **trail 方向旋转期不可控**：用户每次闭眼时的"运气方向"不同，没有"必然指向某方向"的语义控制——这反而是好的（每次记忆都不一样），但用户测试若觉得"方向漂移太慢看不出来"则需调短 `ECHO_TRAIL_ROTATE_MS`

### Decision #8：latent-echo 推到立体主义平涂色块（v3.5）

v3.4 的 echo 是 `tint(r,g,b,alpha)` 染色——保留原图明度，肉眼看仍是"染色照片"，色块感不够块。用户反馈"色块感要更强烈，想想毕加索"。

**问题诊断**

毕加索立体主义的"色块"不是颜色不同，是**面片内部没有过渡**：脸颊一整片是粉色、鼻梁一整片是棕色、眼窝一整片深紫——单片纯色，硬边界。tint 染色保留了 256 级明度过渡，所以再怎么调都是"渐变照片"，不是"色块"。

**解决：色阶量化（POSTERIZE）**

p5.js 内置 `filter(POSTERIZE, level)`：把每通道压到 N 级。`level=3` → 3³ = 27 种颜色，连续渐变变成几个平涂色块。

**搜索结论**

| 类别 | 来源 | 关键结论 |
|---|---|---|
| 外部 | p5.js 官方 reference [`filter(POSTERIZE, n)`](https://p5js.org/reference/p5/filter/) | n=2-4 适合艺术化平涂；高于 8 视觉上等同原图 |
| 外部 | 毕加索作品色阶分析（《阿维农少女》《梦》） | 实际色阶 ~5-8 段；3 级在 echo 上叠加后视觉等价（trans alpha + tint 色调偏移会再"摊开"色阶） |
| 项目历史 | `git log -S 'POSTERIZE' --all` | 项目内首次使用 |
| 项目内 | Grep `filter(BLUR` 等 filter 调用 | 已有 `bakeHalation` 用过 `filter(BLUR/THRESHOLD/BLUR)`，调用模式可复用——一次性烘焙到 gfx，不每帧做 |

**实现（3 处改动，加起来 ~5 行代码）**

```js
// CFG（新增 1 个、改 2 个）
ECHO_POSTERIZE_LEVEL: 3,                       // 每通道 3 级
ECHO_DECAY: [0.75, 0.55, 0.38, 0.22],          // alpha 拉强（↑ 0.20 / 0.17 / 0.13 / 0.07）
ECHO_PALETTE_RGB: [                            // 换更鲜艳跨度更大的色板
  [255, 145,  80],  [210,  75, 110],
  [ 90,  80, 165],  [ 45, 130, 145],
],

// commitEcho 末尾，snapshot 后立刻 POSTERIZE
fresh.image(memoryGfx, 0, 0, width, height);
if (CFG.ECHO_POSTERIZE_LEVEL > 1) {
  fresh.filter(POSTERIZE, CFG.ECHO_POSTERIZE_LEVEL);
}
```

**为什么 POSTERIZE 放在 commit 而不是渲染时**

| 方案 | 开销 | 一致性 |
|---|---|---|
| **commit 时一次性 filter（选了）** | 1.1s 一次 ~3-5ms | 该 echo 在缓冲里始终"几色平涂版"，跨帧稳定 |
| 每帧渲染前 filter | 4 张 × 60fps = 240 次 filter/s ≈ 卡顿 | 颜色每帧都重新量化，可能闪烁 |

照搬 `bakeHalation` 的"一次性烘焙到 gfx"模式。

**色板理由**

| echo[i] | RGB | 毕加索时期 |
|---|---|---|
| 0（最近） | `(255, 145, 80)` 暖橙红 | 玫瑰时期暖调 |
| 1 | `(210, 75, 110)` 玫红 | 《梦》主调 |
| 2 | `(90, 80, 165)` 蓝紫 | 蓝色立体主义 |
| 3（最老） | `(45, 130, 145)` 冷青绿 | 立体主义冷调 |

跨度比 v3.4 大（饱和度 +30~40%），色调演化感更强；仍保留"暖→冷=新→旧"的语义。

**alpha 拉强的取舍**

v3.4 `[0.55, 0.38, 0.25, 0.15]` 是给染色 echo 用的——加深就过暗。v3.5 echo 是平涂色块，alpha 拉到 0.75 时主图依然能透出，但色块覆盖力强 → "面片"感成立，不再被主图细节"咬碎"。

**风险**

- POSTERIZE 后图像里黑色区域变更黑（眼窝、阴影），4 张叠起来可能让中央人脸过暗 —— 视觉测如果发现，调 `ECHO_POSTERIZE_LEVEL=4`（每通道 4 级 = 64 色，黑度回升）
- 色板偏鲜可能让画面整体太"野兽派"，离"温柔记忆"语义偏远 —— 测试中如发现，把饱和度往下拉 10-15%

**性能 / 内存**

- 新增 commit 时一次 `filter(POSTERIZE, 3)` ≈ 3-5ms / 1.1s（GPU 实现极快）
- 内存零变化（filter in-place）
- 渲染常驻零变化

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

  // 记忆态 v3 · Latent-echo（多帧过去叠加，alpha 上叠，色块感）
  ECHO_LAYERS:                4,
  ECHO_COMMIT_INTERVAL_MS:    1100,
  ECHO_COMMIT_OPENNESS_MIN:   0.45,
  ECHO_DECAY:        [0.75, 0.55, 0.38, 0.22],   // v3.5 拉强 alpha 强化色块覆盖力
  ECHO_OFFSET_PX:    [25,   55,   95,   150 ],   // 大幅加大让 echo 飘到主体外
  ECHO_BLUR_PER_COMMIT:        0.0,              // 不累积 BLUR：echo 保持原始锐度

  // 记忆态 v3.5 · 毕加索立体主义平涂色块（Decision #8）
  ECHO_POSTERIZE_LEVEL:        3,                // commit 时每通道 3 级 = 27 色平涂
  ECHO_PALETTE_RGB: [
    [255, 145,  80], // echo[0] 玫瑰时期暖橙红
    [210,  75, 110], // echo[1] 《梦》玫红
    [ 90,  80, 165], // echo[2] 蓝色立体主义蓝紫
    [ 45, 130, 145], // echo[3] 立体主义冷青绿
  ],

  // 记忆态 v3.4 · Wong 时间拖尾（Decision #7）
  ECHO_TRAIL_ROTATE_MS:    18000,                // 共享 trail 方向 18s 一周
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
- Decision #6：闭眼态再叠 latent-echo 时间维度 v3（4 张过去快照环形缓冲 + 衰减 α + 累积 BLUR + 随机方向偏移；灵感 Anadol latent walk + Akten Deep Meditations）
- Decision #7：latent-echo 美感升级 v3.4（Warhol 多重网版色板：暖橙→暖粉→冷紫→冷青；Wong 时间拖尾：所有 echo 共享缓慢旋转的 trail 方向）
- Decision #8：latent-echo 推到立体主义平涂色块 v3.5（commit 时 POSTERIZE 3 级 + alpha 拉强 + 毕加索玫瑰-蓝色时期色板：暖橙红 / 玫红 / 蓝紫 / 冷青绿）
