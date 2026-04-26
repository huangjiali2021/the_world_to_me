# the_world_to_me

> 我们以为在"看"世界，但真正"看见"的是记忆里那个被沉淀过的画面。

An interactive web piece about perception and memory.

- **Eyes open** — the world in front of you dissolves into particles. The wider you open them, the blurrier it gets. The present is always too fast to grasp.
- **Eyes closed** — the last frame freezes, warms up, and breathes gently. The world only becomes clear when remembered.

Built with [p5.js](https://p5js.org/) and [MediaPipe FaceLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).

## Live demo

**https://the-world-to-me.vercel.app/**

Deployed on Vercel. Auto-updates 30-60s after each push to `main`.

## Run locally

The page uses ES modules and the camera API, so it must be served over HTTP (not `file://`).

```bash
# any static server works, e.g.:
python -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000` in Chrome / Edge.

> Camera access requires HTTPS or `localhost`.

## How it works

| Eye state | EAR | What you see |
|---|---|---|
| Fully open | ≥ 80% of your max | Live frame sampled into ~16k particles, each jittered up to 40 px, slightly desaturated |
| In between | 30–80% | Particle jitter and saturation interpolate smoothly |
| Fully closed | < 30% of your max | Last frame is frozen, tinted warm, vignetted, grained, breathing slowly |

The first ~1 s after the camera starts is a warm-up phase that learns *your* personal "fully open" baseline, so the experience adapts to different eye shapes.

## Tech

- `index.html` — entry
- `style.css` — black background, centered canvas
- `face-tracker.js` — MediaPipe FaceLandmarker driver, writes `window.__twtm.eye.openness`
- `sketch.js` — particle layer + memory layer
- `docs/the_world_to_me_Solution.md` — design notes & decisions

## License

All rights reserved. © 2026 huangjiali2021
