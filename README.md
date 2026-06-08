<div align="center">
  <h1>⚽ TACTIC-FP Annotator</h1>
  <p><strong>A professional web tooling environment for football tactical intent annotation.</strong><br/>
  Fast clip review, team-focused label decisions, and benchmark-ready dataset exports for the TACTIC-Bench research framework.</p>

  <p>
    <a href="README.md">🇬🇧 English</a> ·
    <a href="README_JP.md">🇯🇵 日本語</a>
  </p>

  <p>
    <a href="https://github.com/shafayatsaad"><img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"/></a>
    <a href="https://www.linkedin.com/in/shafayatsaad"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"/></a>
    <a href="https://shafayatsaad.vercel.app/"><img src="https://img.shields.io/badge/Portfolio-101010?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Portfolio"/></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-14.2-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js 14"/>
    <img src="https://img.shields.io/badge/React-18.3-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 18"/>
    <img src="https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
    <img src="https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind"/>
    <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python"/>
    <img src="https://img.shields.io/badge/ffmpeg-required-007808?style=flat-square&logo=ffmpeg&logoColor=white" alt="ffmpeg"/>
  </p>
</div>

---

## 📋 Table of Contents

- [🎯 Overview](#-overview)
- [✨ Key Features](#-key-features)
- [🖼️ Interface at a Glance](#-interface-at-a-glance)
- [🏗️ Architecture Review](#-architecture-review)
- [🛠️ Tech Stack](#-tech-stack)
- [📁 Project Structure](#-project-structure)
- [⚡ Getting Started](#-getting-started)
- [🔌 API Reference](#-api-reference)
- [🧬 Pipeline & Data Workflow](#-pipeline--data-workflow)
- [📐 Annotation Schema](#-annotation-schema)
- [⌨️ Keyboard Shortcuts](#-keyboard-shortcuts)
- [🏷️ TACTIC Intents Reference](#-tactic-intents-reference)
- [📤 Export Formats](#-export-formats)
- [🐞 Troubleshooting](#-troubleshooting)
- [🗺️ Roadmap](#-roadmap)
- [👥 Maintainer](#-maintainer)
- [📝 Design Notes](#-design-notes)

---

## 🎯 Overview

**TACTIC-FP Annotator** is a modern, full-stack web application for annotating football (soccer) tactical intent at the **clip level**. It is purpose-built for producing clean, benchmark-ready labels for the **TACTIC-FP / TACTIC-Bench** research framework.

The annotator is centered on a realistic match review workflow:

- **18-second** clip playback with a **10-second central label window** (configurable via the Python pipeline).
- Direct, side-by-side annotation for **Team A** and **Team B** with team-aware possession logic.
- Clear separation of **tactical intent labels** from **exclusion labels** (DeadBall, ContestedPlay).
- Validation rules that enforce possession for attack vs. defense labels.
- A pipeline that generates clip manifests + mock trajectory `.npz` files from raw match videos.
- Dataset export to **JSON** and **CSV** in a TACTIC-Bench-compatible schema.

> 🎓 Whether you are building a tactical dataset for research, prototyping a sports-analytics product, or running model-evaluation benchmarks, TACTIC-FP Annotator gives you a fast, keyboard-friendly, single-screen workflow.

---

## ✨ Key Features

### 🎬 Annotation Workflow

- **3-pane layout** — clip explorer (left) · video player + intent grid (center) · annotation panel (right).
- **18 s clip / 10 s central label window** with sub-second boundary nudging, auto-segment, manual split, merge, and delete.
- **Manual possession override** (Team A / Team B / Contested / Auto-follow-trajectory) with full UI feedback.
- **Quality gate** — submits are blocked unless ≥ 18/22 players are tracked and the clip quality score is ≥ 0.8.
- **Session cap** of 50 annotations and **forced breaks** every 20 clips to keep annotator focus sharp.
- **Auto-Next** — automatically advance to the next clip after a successful submit.

### 🏷️ Tactical Intent Vocabulary

- **14 labels** organised into **6 groups**: BuildUp · Attack · Press · Transition · SetPiece · Exclusion.
- Each label has a **single-character hotkey** (`1`–`9`, `0`, `Q`, `W`, `R`, `T`) for lightning-fast input.
- **Cross-team possession rules** — attack intents are automatically disabled for the team without the ball.
- **Exclusion shortcuts** — DeadBall auto-fills both teams and toggles game state to `dead_ball: true`.

### 🎥 Video Player

- Native HTML5 `<video>` with custom controls: play/pause, mute, fullscreen, loop, playback speed (0.25×–2×).
- **Range-request streaming** through `/api/videos/[...path]` for fast seek and resume.
- **MKV → MP4** auto-conversion via `ffmpeg` (remux first, transcode fallback).
- **Mark workflow** (`M` start, `N` end, `Enter` to create) for ad-hoc segment creation.
- **Split at playhead** (`X`) for breaking a clip into two sub-segments.
- **Auto-scroll** the timeline progress bar to the current annotation window.

### 📊 Pipeline & Data

- `pipeline.py` — generates contiguous clip windows from `raw_videos/`, writes `data/clip_manifest.json` + `data/trajectories/<match>/*.npz`.
- `generate_manifest.py` — heuristic helpers: `extract_enhanced_features`, `compute_clip_quality`, `detect_possession_state`, `detect_intent_shift_points`, `propose_segments_from_shifts`, `determine_half`, `add_video_metadata`.
- **One-click manifest generation** from the UI (also available as `POST /api/pipeline/generate`).

### 📤 Export & Integration

- **JSON** export with full TACTIC-Bench schema (model-sample shape) and **CSV** export with a flat per-annotation column list.
- Browser-side download + server-side save into `data/exports/`.
- **Reset session** clears annotations, manifest, exports, and converted MP4s (raw videos are preserved).

### 🧑‍💻 Developer Experience

- **100% client-side state** with React `useState` + `useRef` (no external state library).
- **Stable keyboard handler** — every key action is bound to a `useRef`-backed callback, so hotkeys keep working across re-renders.
- **Cancel-safe video streaming** — the `/api/videos/[...path]` route uses a custom abort-aware `ReadableStream` that destroys the underlying Node stream on client disconnect, so a tab close never crashes the server.
- TypeScript with the `@/*` path alias to `src/*`.

---

## 🖼️ Interface at a Glance

The UI is designed to look and feel like a high-end sports-analysis dashboard:

| Region                                            | Contents                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Top bar** (`Header`)                            | Brand mark · current match ID + segment counter · **Match progress** (annotated / planned) · `Load Video` action · live status pill · Dev Portfolio link                                                                                                                                                                                                                        |
| **Left rail** (`ClipExplorer`)                    | Search box · All / Todo / Done filter · scrollable clip list with anchor-event icons, half-clock, possession dot, and per-clip progress state                                                                                                                                                                                                                                   |
| **Center stage** (`VideoPlayer` + `IntentLabels`) | 16:9 video · timeline progress bar with click-to-seek · playback controls (play, replay, speed, mute, fullscreen, loop) · mark start/end buttons · split & convert-MKV actions · grouped intent grid with hotkey chips                                                                                                                                                          |
| **Right panel** (`AnnotationPanel`)               | Team A / Team B cards with color-coded borders · **Ball Possession** selector (A / B / Contested / Auto) · **Game State** editor (score, set-piece, dead-ball) · **Submit Annotation** form (confidence stars, certainty, coverage %, Flag Review, Auto-Next, Skip, Submit) · Quality indicator (22 tracker dots) · Class Distribution bars · JSON / CSV export · Reset Session |

> The layout is optimized for **rapid review**, **consistent labeling**, and **minimal context switching**.

---

## 🏗️ Architecture Review

TACTIC-FP Annotator is a **single-process full-stack app** with three cooperating layers:

1. **Frontend** — Next.js App Router (RSC + client components). The whole annotation experience lives in `src/components/AnnotatorClient.tsx`, with state, keyboard handlers, and persistence all handled there.
2. **Backend** — Next.js Route Handlers under `src/app/api/**` covering manifest, annotations, video streaming, video conversion, pipeline execution, and exports.
3. **Pipeline** — Two Python scripts:
   - `pipeline.py` — iterates `raw_videos/`, builds 18 s windows with 10 s label spans, and writes the manifest + trajectory `.npz` files.
   - `generate_manifest.py` — heuristic helpers consumed by `pipeline.py` (quality, possession, shift-points, half-detection, metadata).

### Architecture Diagram

```mermaid
flowchart TD
  subgraph Source[Input Layer]
    RawVideos[Raw Match Videos<br/>.mp4 / .mkv / .avi / .mov / .webm]
    Trajectories[Trajectory Data<br/>.npz, generated by pipeline.py]
  end

  subgraph Pipeline[Pipeline Layer · Python]
    ClipGen[pipeline.py<br/>--clip-duration 18 --annotation-window 10]
    Helpers[generate_manifest.py<br/>features · quality · possession · shifts]
  end

  subgraph Backend[Backend Layer · Next.js Route Handlers]
    ManifestAPI["/api/manifest (GET)"]
    AnnotAPI["/api/annotations (GET, POST)"]
    ResetAPI["/api/annotations/reset (POST)"]
    PipeAPI["/api/pipeline/generate (POST)"]
    VideoAPI["/api/videos/[...path] (GET, HEAD)"]
    ListAPI["/api/videos/list (GET)"]
    ConvertAPI["/api/videos/convert (POST)"]
    JSONAPI["/api/export/json (POST)"]
    CSVAPI["/api/export/csv (POST)"]
    Storage[(data/annotations.json<br/>data/clip_manifest.json<br/>data/exports/*<br/>data/trajectories/*)]
    FFmpeg[ffmpeg remux / transcode]
  end

  subgraph Frontend[UI Layer · React Client]
    App[AnnotatorClient + Header + ClipExplorer<br/>+ VideoPlayer + IntentLabels + AnnotationPanel]
  end

  RawVideos -->|scan + split| ClipGen
  ClipGen -->|uses| Helpers
  ClipGen -->|writes| Storage
  Trajectories -.->|reads| App

  App -->|fetch clips| ManifestAPI
  App -->|load / save annotations| AnnotAPI
  App -->|clear session| ResetAPI
  App -->|run pipeline| PipeAPI
  PipeAPI -->|spawn python3 pipeline.py| ClipGen
  App -->|list videos| ListAPI
  App -->|stream video (Range)| VideoAPI
  App -->|convert MKV → MP4| ConvertAPI
  ConvertAPI -->|spawn ffmpeg| FFmpeg
  FFmpeg -->|produces .mp4| Storage
  App -->|export JSON| JSONAPI
  App -->|export CSV| CSVAPI
  ManifestAPI --> Storage
  AnnotAPI --> Storage
  JSONAPI --> Storage
  CSVAPI --> Storage
```

---

## 🛠️ Tech Stack

| Layer              | Technology                                       | Version |
| ------------------ | ------------------------------------------------ | ------- |
| Frontend framework | Next.js (App Router)                             | 14.2.x  |
| UI library         | React + React DOM                                | 18.3.x  |
| Language           | TypeScript                                       | 5.4.x   |
| Styling            | Tailwind CSS + PostCSS + Autoprefixer            | 3.4.x   |
| Icons              | lucide-react                                     | 0.400+  |
| Motion             | framer-motion                                    | 11.x    |
| Class utilities    | class-variance-authority · clsx · tailwind-merge | latest  |
| Backend runtime    | Next.js Route Handlers (Node)                    | –       |
| Pipeline           | Python 3.10+ with OpenCV (`cv2`) and NumPy       | –       |
| Video tooling      | `ffmpeg` (system binary, on `$PATH`)             | –       |
| Linting            | ESLint + `eslint-config-next`                    | 8.57.x  |

---

## 📁 Project Structure

```text
TACTIC-FP-Annotator/
├── package.json                      # Workspace root: delegates to tactic-fp-nextjs
├── tech-spec.md                      # Internal technical specification
└── tactic-fp-nextjs/
    ├── package.json                  # All runtime + dev dependencies
    ├── package-lock.json
    ├── tsconfig.json                 # TS config (paths: @/* → ./src/*)
    ├── next.config.js                # Next 14 config (serverComponentsExternalPackages)
    ├── tailwind.config.ts            # Tailwind 3.4 content + font extensions
    ├── postcss.config.js             # Tailwind + autoprefixer pipeline
    ├── next-env.d.ts
    ├── generate_manifest.py          # Heuristic helpers (features, quality, possession, shifts)
    ├── pipeline.py                   # Main Python pipeline: raw_videos → clip_manifest.json + .npz
    ├── pipeline_validator.py         # Optional validation helper for the manifest
    ├── favicon.png
    ├── README.md                     # ← you are here
    ├── README_JP.md                  # 日本語版
    ├── data/                         # Auto-created on first run
    │   ├── clip_manifest.json        # Generated by pipeline.py
    │   ├── annotations.json          # Live annotation session
    │   ├── exports/                  # JSON/CSV exports
    │   └── trajectories/             # <match_id>/*.npz (from pipeline.py)
    ├── raw_videos/                   # Drop your .mp4/.mkv files here
    └── src/
        ├── app/                      # Next.js App Router
        │   ├── layout.tsx            # Root layout, metadata, fonts
        │   ├── page.tsx              # Composes <AnnotatorClient />
        │   ├── globals.css           # Tailwind + custom utilities
        │   ├── icon.png
        │   └── api/
        │       ├── manifest/route.ts             # GET — read clip_manifest.json
        │       ├── annotations/route.ts          # GET / POST — load & save
        │       ├── annotations/reset/route.ts    # POST — clear session
        │       ├── pipeline/generate/route.ts    # POST — spawn pipeline.py
        │       ├── videos/[[...path]]/route.ts   # GET / HEAD — range video stream
        │       ├── videos/convert/route.ts       # POST — MKV → MP4 via ffmpeg
        │       ├── export/json/route.ts          # POST — write JSON export
        │       └── export/csv/route.ts           # POST — write CSV export
        ├── components/
        │   ├── AnnotatorClient.tsx   # Main client wrapper (all state + keyboard)
        │   ├── Header.tsx            # Top bar
        │   ├── ClipExplorer.tsx      # Left sidebar (list, search, filters)
        │   ├── VideoPlayer.tsx       # Center video + controls
        │   ├── IntentLabels.tsx      # 6-group grid of 14 label buttons
        │   └── AnnotationPanel.tsx   # Right panel (team, possession, game state, submit, export)
        └── lib/
            ├── constants.ts          # TACTIC_INTENTS, HOTKEY_MAP, Annotation/Clip types
            ├── utils.ts              # cn, formatTime, formatMatchClock, normalizeClip
            └── server-utils.ts       # fs helpers for API routes
```

---

## ⚡ Getting Started

### 1. Prerequisites

| Tool              | Required version            | Used for                              |
| ----------------- | --------------------------- | ------------------------------------- |
| **Node.js**       | 18.17+ (LTS recommended)    | Next.js dev server, build, lint       |
| **npm**           | 9+ (bundled with Node 18)   | Dependency management                 |
| **Python**        | 3.10+                       | `pipeline.py`, `generate_manifest.py` |
| **ffmpeg**        | 4.4+ (any modern build)     | MKV → MP4 conversion, video streaming |
| **opencv-python** | `pip install opencv-python` | Pipeline reads video metadata         |
| **NumPy**         | `pip install numpy`         | Trajectory generation                 |

> The Next.js app itself does **not** require Python or ffmpeg to start — they are only needed when you run the pipeline or convert MKV files. You can still browse and annotate MP4 clips without them.

#### Installing ffmpeg per OS

| OS                  | Command                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows**         | `winget install Gyan.FFmpeg` · or download a build from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) and add `bin/` to your `PATH` |
| **macOS**           | `brew install ffmpeg`                                                                                                                 |
| **Ubuntu / Debian** | `sudo apt update && sudo apt install -y ffmpeg python3-opencv`                                                                        |
| **Fedora**          | `sudo dnf install -y ffmpeg python3-opencv`                                                                                           |
| **Arch**            | `sudo pacman -S ffmpeg opencv python-numpy`                                                                                           |

Verify with `ffmpeg -version` — it should print a build line.

### 2. Install dependencies

```bash
# From the workspace root (delegates to tactic-fp-nextjs/)
npm install

# …or, equivalently, from inside the Next.js project
cd tactic-fp-nextjs
npm install

# Python pipeline deps (one-time)
pip install numpy opencv-python
```

### 3. Add raw match videos

Drop your match videos into `tactic-fp-nextjs/raw_videos/`. Supported extensions: `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`.

```bash
tactic-fp-nextjs/raw_videos/
├── match_01.mp4
├── match_02.mkv
└── match_03.mp4
```

> Tip: If you only have MKV files, the annotator will prompt you to **Convert MKV → MP4** the first time you select a clip. The original MKV is preserved.

### 4. Generate the clip manifest

**Option A — from the UI:** open the app, then in the left sidebar click **Generate Manifest**.

**Option B — from the API:**

```bash
curl -X POST http://localhost:3000/api/pipeline/generate \
  -H "Content-Type: application/json" \
  -d '{"clip_duration": 18, "annotation_window": 10, "step_duration": 10}'
```

**Option C — from Python directly (inside `tactic-fp-nextjs/`):**

```bash
python pipeline.py --input-dir raw_videos --clip-duration 18 --annotation-window 10 --step-duration 10
```

The pipeline writes `data/clip_manifest.json` plus per-match trajectory files under `data/trajectories/<match_id>/*.npz`.

### 5. Start the dev server

```bash
# Workspace root (port 5173, hostname 127.0.0.1)
npm run dev

# …or inside tactic-fp-nextjs/
npm run dev    # default port 3000
```

Then open the URL printed in the terminal (usually `http://localhost:3000` or `http://127.0.0.1:5173`).

### 6. Build for production

```bash
npm run build
npm run start
```

### 7. Lint

```bash
npm run lint
```

### 8. Reset your session (optional)

Use the **Reset Session** button in the right panel, or call the API:

```bash
curl -X POST http://localhost:3000/api/annotations/reset
```

This clears `data/annotations.json`, `data/clip_manifest.json`, `data/exports/`, and any `*_720p.mp4` files in `raw_videos/`. **Your original raw videos are kept.**

---

## 🔌 API Reference

All routes are Next.js Route Handlers. `Content-Type` for request/response bodies is `application/json` unless noted.

| Method | Route                    | Purpose                                                               | Request body                                          | Response                                                              |
| ------ | ------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `GET`  | `/api/manifest`          | Read `data/clip_manifest.json` (auto-flattens `{clips: [...]}` shape) | –                                                     | `Clip[]`                                                              |
| `GET`  | `/api/annotations`       | Read the current `data/annotations.json` session                      | –                                                     | `{ schema_version, dataset, team_config, annotations: Annotation[] }` |
| `POST` | `/api/annotations`       | Save / replace the entire annotation session                          | `{ annotations, team_config }`                        | `{ success: true }`                                                   |
| `POST` | `/api/annotations/reset` | Clear session (annotations, manifest, exports, generated MP4s)        | –                                                     | `{ success, cleared: string[] }`                                      |
| `POST` | `/api/pipeline/generate` | Run `pipeline.py` with the given windowing config                     | `{ clip_duration, annotation_window, step_duration }` | `{ success, output, manifest }`                                       |
| `GET`  | `/api/videos/list`       | List available video files in `raw_videos/`                           | –                                                     | `{ videos: string[] }`                                                |
| `GET`  | `/api/videos/[...path]`  | Stream a video file (supports HTTP `Range` for seeking)               | –                                                     | `video/<ext>` binary, `206 Partial Content` for ranges                |
| `HEAD` | `/api/videos/[...path]`  | Probe whether a video is reachable (used to detect pre-converted MP4) | –                                                     | headers only                                                          |
| `POST` | `/api/videos/convert`    | Convert a source video to a browser-ready `*_720p.mp4` via `ffmpeg`   | `{ source: "match_02.mkv" }`                          | `{ success, filename, message }`                                      |
| `POST` | `/api/export/json`       | Write TACTIC-Bench JSON model-samples to `data/exports/`              | `{ annotations, match_id? }`                          | `{ success, fileName }`                                               |
| `POST` | `/api/export/csv`        | Write a flat CSV to `data/exports/`                                   | `{ annotations, team_config }`                        | `{ success, fileName }`                                               |

> Video streaming is range-aware: the route emits `Accept-Ranges: bytes` and returns `206 Partial Content` for any `Range: bytes=…` request. The streaming body is wrapped in a custom abort-safe `ReadableStream` that destroys the underlying Node file stream on client disconnect, so closing the tab cannot crash the server.

---

## 🧬 Pipeline & Data Workflow

The end-to-end flow from raw video to exported dataset:

```text
   raw_videos/*.mp4 ───► pipeline.py ──► data/clip_manifest.json
                                │
                                ├─► data/trajectories/<match>/*.npz
                                │
                                ▼
                       Browser (AnnotatorClient)
                                │
                                ▼
                       data/annotations.json
                                │
                                ▼
                       data/exports/TACTIC_FP_Annotated_<match>.{json,csv}
```

### `pipeline.py` CLI flags

| Flag                  | Default      | Choices / Notes                                   |
| --------------------- | ------------ | ------------------------------------------------- |
| `--input-dir`         | `raw_videos` | Folder containing source match videos             |
| `--clip-duration`     | `30`         | `10`, `18`, or `30` seconds (window length)       |
| `--annotation-window` | `6`          | Central label window inside each clip (seconds)   |
| `--step-duration`     | `7`          | Step between consecutive windows (seconds)        |
| `--no-trajectories`   | off          | Skip writing `.npz` files (faster, manifest-only) |

### `generate_manifest.py` helper functions

| Function                                         | Purpose                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `add_video_metadata(path)`                       | OpenCV probe → `{ width, height, fps, total_frames, duration_seconds, tier }` |
| `extract_enhanced_features(traj)`                | Ball x/y/speed/height, team spread, press intensity, pass sequence length     |
| `compute_clip_quality(traj)`                     | Quality score, issue list, per-team tracking coverage                         |
| `detect_possession_state(traj)`                  | Heuristic ball-proximity possession → `{ type, team, confidence, method }`    |
| `detect_intent_shift_points(traj, fps)`          | Find likely intent shifts (possession change, formation compactness)          |
| `propose_segments_from_shifts(...)`              | Convert shift points into segment windows with proposal metadata              |
| `determine_half(timestamp, match_duration=5400)` | First-half / second-half classifier with `game_clock` string                  |

### Output shapes

**`data/clip_manifest.json`** — array of clip objects with fields like:

```jsonc
{
  "id": "match_01_0042_seg00",
  "match_id": "match_01",
  "path": "raw_videos/match_01.mp4",
  "start": 38.0,
  "end": 56.0,
  "annotation_start": 42.0,
  "annotation_end": 52.0,
  "annotation_window": 10.0,
  "half": 1,
  "game_clock": "00:42",
  "quality_score": 0.95,
  "quality_issues": [],
  "tracking_coverage": {
    "team_a_avg": 10.8,
    "team_b_avg": 10.6,
    "ball_frames": 248,
    "total_frames": 250,
  },
  "possession_state": {
    "type": "POSSESSION",
    "team": "A",
    "confidence": 0.8,
    "method": "proximity",
  },
  "team_perspective": {
    "team_a_color": "white",
    "team_b_color": "red",
    "team_a_attacking_direction": "right",
    "recommended_annotate_team": "A",
  },
  "anchor_event": {
    "type": "shot",
    "timestamp": 47.0,
    "description": "Shot on goal near match time 47s",
  },
  "segment_proposal": {
    "reason": "possession_change",
    "shift_frame": 96,
    "confidence": 0.9,
  },
}
```

**`data/trajectories/<match_id>/<match>_<start>_<end>.npz`** — `numpy.savez` with key `trajectory`, shape `(T, 23, 5)`:

| Axis | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| `T`  | Number of frames in the window                                |
| `23` | Players 0–10 (Team A), 11–21 (Team B), 22 (ball)              |
| `5`  | `x, y, vx, vy, height` (last dim is ball height for index 22) |

---

## 📐 Annotation Schema

Every annotation submitted through the UI conforms to this shape (mirrored in `src/lib/constants.ts`):

```ts
interface Annotation {
  schema_version: "1.0.0";
  dataset: "TACTIC-Bench";
  clip_id: string;
  match_id: string;
  match_name: string;
  half: "1st" | "2nd";
  window_idx: number;

  game_state: {
    half: "1st" | "2nd" | "ET1" | "ET2";
    match_clock_sec: number;
    score_home: number;
    score_away: number;
    set_piece?: boolean;
    set_piece_type?: "corner" | "free_kick" | "throw_in" | "penalty";
    dead_ball?: boolean;
    dead_ball_reason?: string;
  };

  video_source: {
    video_path: string;
    seek_start_sec: number;
    label_start_sec: number;
    label_end_sec: number;
    seek_end_sec: number;
    fps: number;
    tensor_fps: number; // 10
    source_frame_count: number;
    tensor_frame_count: number; // = round(duration * 10), clamped [20, 2000]
  };

  segment_metadata: {
    start_sec: number;
    end_sec: number;
    duration_sec: number;
    tensor_frames: number;
    preceding_event?: string;
    following_event?: string;
    coverage_estimate: number; // 0..1
    is_mixed_phase: boolean;
  };

  reconstruction: {
    npz_path: string;
    tensor_shape: [number, number, number]; // [T, 23, 4]
    tensor_fps: number;
    quality_pass: boolean;
    tracked_players: number;
    padding_mask: boolean[];
  };

  team_a: {
    team_id: "Team_A";
    team_name: string;
    jersey_color: string;
    is_home: boolean;
    is_primary: boolean; // = possession
    label: {
      intent_class: string | null;
      confidence: number; // 1..5
      certainty: "low" | "medium" | "high";
    };
    possession: boolean;
  };

  team_b: {
    /* same shape as team_a, mirrored */
  };

  team_config?: { team_a: TeamConfig; team_b: TeamConfig };

  exclusion: "DeadBall" | "ContestedPlay" | null;

  annotation_meta: {
    annotator_id: string; // default: "coach_001"
    session_id: string; // e.g. "sess_20260607"
    annotation_timestamp: string; // ISO 8601
    annotation_duration_sec: number;
    tool_version: string; // "tactic-annotator-v3.0"
  };

  agreement: {
    annotated_at: string; // ISO 8601
    flagged_review: boolean; // mirrors "Flag Review" checkbox
    skipped: boolean;
  };

  model_split: { assigned_split: "train" | "val" | "test" };
}
```

### Validation rules

| Rule                                                                          | Where                         | Effect                              |
| ----------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| Both teams must have an `intent_class` (unless `exclusion` is set)            | `saveAnnotation`              | Block submit, show status           |
| CounterAttack cannot be assigned to **both** teams                            | `saveAnnotation`              | Block submit                        |
| Attack intent on a team without possession is disabled                        | `disabledIntentIdsA/B`        | Buttons greyed out                  |
| `DeadBall` → both teams auto-set to `DeadBall`, `game_state.dead_ball = true` | intent click                  | Auto-fill                           |
| Submit blocked if quality gate fails (<18/22 tracked, ≤3 red, score <0.8)     | `saveAnnotation`              | Status message                      |
| Forced break every 20 annotations                                             | `sessionBreakDue`             | "Resume After Break" button         |
| Hard cap of 50 annotations per session                                        | `saveAnnotation`              | "Export or reset before continuing" |
| Minimum segment length 2.0 s                                                  | `saveAnnotation`, split/merge | Blocked below threshold             |

---

## ⌨️ Keyboard Shortcuts

Shortcuts are ignored while focus is in an `<input>`, `<textarea>`, or `<select>`. `Ctrl` / `Cmd` / `Alt` combinations are passed through to the browser.

### Playback

| Key            | Action            |
| -------------- | ----------------- |
| `Space` or `K` | Play / pause      |
| `J`            | Seek −10 s        |
| `L`            | Seek +10 s        |
| `←`            | Seek −5 s         |
| `→`            | Seek +5 s         |
| `Shift` + `←`  | Seek −1 s         |
| `Shift` + `→`  | Seek +1 s         |
| `[`            | Previous clip     |
| `]`            | Next clip         |
| `U`            | Mute / unmute     |
| `F`            | Toggle fullscreen |

### Team & Annotation

| Key     | Action                                                     |
| ------- | ---------------------------------------------------------- |
| `A`     | Switch active team to A                                    |
| `B`     | Switch active team to B                                    |
| `S`     | Skip current clip (saves `agreement.skipped = true`)       |
| `Enter` | Submit annotation, or create segment if both marks are set |

### Mark / Split Workflow

| Key   | Action                                                   |
| ----- | -------------------------------------------------------- |
| `M`   | Mark start at current playhead                           |
| `N`   | Mark end at current playhead (or set both marks if none) |
| `X`   | Split current clip at playhead                           |
| `Esc` | Cancel marks, close help modal                           |

### Intent Hotkeys

Pressing a hotkey while annotating a team toggles that intent for the **active** team:

| Hotkey | Intent            | Group      |
| ------ | ----------------- | ---------- |
| `1`    | `BuildUp_Short`   | BuildUp    |
| `2`    | `BuildUp_Long`    | BuildUp    |
| `Q`    | `PossCirculation` | BuildUp    |
| `3`    | `CounterAttack`   | Attack     |
| `W`    | `DirectAttack`    | Attack     |
| `4`    | `HighPress`       | Press      |
| `5`    | `MidBlockPress`   | Press      |
| `6`    | `LowBlock`        | Press      |
| `7`    | `AttackingTrans`  | Transition |
| `8`    | `DefensiveTrans`  | Transition |
| `9`    | `SetPieceAttack`  | SetPiece   |
| `0`    | `SetPieceDefend`  | SetPiece   |
| `R`    | `DeadBall`        | Exclusion  |
| `T`    | `ContestedPlay`   | Exclusion  |

### Help

| Key                    | Action                                      |
| ---------------------- | ------------------------------------------- |
| `?` (or `Shift` + `/`) | Toggle the on-screen help / shortcuts modal |

---

## 🏷️ TACTIC Intents Reference

All 14 labels, in the exact order they appear in `src/lib/constants.ts`. The hex colors are used by the UI for the per-group accent borders and chips.

| Group          | Color               | Intent ID | Label             | Hotkey | Tactical Role                                           |
| -------------- | ------------------- | --------- | ----------------- | ------ | ------------------------------------------------------- |
| **BuildUp**    | 🟢 Teal `#2dd4bf`   | 1         | `BuildUp_Short`   | `1`    | Short-range possession circulation in own half          |
| **BuildUp**    | 🟢 Teal `#2dd4bf`   | 2         | `BuildUp_Long`    | `2`    | Long-ball progression out of defence                    |
| **BuildUp**    | 🟢 Teal `#2dd4bf`   | 3         | `PossCirculation` | `Q`    | Patient side-to-side possession                         |
| **Attack**     | 🟣 Indigo `#818cf8` | 4         | `CounterAttack`   | `3`    | Fast transition after winning the ball                  |
| **Attack**     | 🟣 Indigo `#818cf8` | 5         | `DirectAttack`    | `W`    | Direct forward play, minimal midfield                   |
| **Press**      | 🔴 Rose `#fb7185`   | 6         | `HighPress`       | `4`    | Aggressive press in the opponent's half                 |
| **Press**      | 🔴 Rose `#fb7185`   | 7         | `MidBlockPress`   | `5`    | Mid-field press / mid block                             |
| **Press**      | 🔴 Rose `#fb7185`   | 8         | `LowBlock`        | `6`    | Deep defensive block                                    |
| **Transition** | 🟪 Purple `#c084fc` | 9         | `AttackingTrans`  | `7`    | Off-ball run / attacking transition                     |
| **Transition** | 🟪 Purple `#c084fc` | 10        | `DefensiveTrans`  | `8`    | Counter-press / defensive transition                    |
| **SetPiece**   | 🩷 Pink `#f472b6`   | 11        | `SetPieceAttack`  | `9`    | Attacking set-piece (corner, FK, etc.)                  |
| **SetPiece**   | 🩷 Pink `#f472b6`   | 12        | `SetPieceDefend`  | `0`    | Defending a set-piece                                   |
| **Exclusion**  | ⚪ Slate `#94a3b8`  | 13        | `DeadBall`        | `R`    | Play stopped — saved in `exclusion`, not `intent_class` |
| **Exclusion**  | ⚪ Slate `#94a3b8`  | 14        | `ContestedPlay`   | `T`    | Possession too unclear to label — saved in `exclusion`  |

### Possession-aware label rules

- The **attacking intents** (`BuildUp_*`, `PossCirculation`, `CounterAttack`, `DirectAttack`, `SetPieceAttack`, `AttackingTrans`) require the labelling team to be in possession.
- The **defensive intents** (`HighPress`, `MidBlockPress`, `LowBlock`, `SetPieceDefend`, `DefensiveTrans`) require the labelling team to be **out of** possession.
- `CounterAttack` may be assigned to **one** team only — never both.
- `ContestedPlay` and `DeadBall` go into the `exclusion` field; the per-team `intent_class` is set to `null`.

---

## 📤 Export Formats

The annotator supports two export formats. Both files are written **server-side** into `data/exports/` and also downloaded to your browser.

### JSON — `TACTIC_FP_Annotated_<match_id>.json`

TACTIC-Bench "model-sample" shape (one record per segment):

```jsonc
[
  {
    "segment_id": "match_01_0042_seg00",
    "match_id": "match_01",
    "half": "1st",
    "start_sec": 42.0,
    "end_sec": 52.0,
    "duration_sec": 10.0,
    "coverage_estimate": 0.95,
    "reconstruction": {
      "npz_path": "data/trajectories/match_01/match_01_0042_0052.npz",
      "tensor_shape": [100, 23, 4],
      "tensor_fps": 10,
      "quality_pass": true,
      "tracked_players": 22,
      "padding_mask": [1, 1, 1, "…"],
    },
    "team_a": {
      "label": {
        "intent_class": "BuildUp_Short",
        "confidence": 4,
        "certainty": "high",
      },
      "is_primary": true,
      "possession": true,
    },
    "team_b": {
      "label": {
        "intent_class": "HighPress",
        "confidence": 4,
        "certainty": "high",
      },
      "is_primary": false,
      "possession": false,
    },
    "exclusion": null,
    "model_split": "train",
  },
]
```

For clips that are pure exclusions, the record collapses to `{ segment_id, match_id, half, start_sec, end_sec, duration_sec, coverage_estimate, reconstruction, exclusion, model_split }` (no team_a / team_b).

### CSV — `TACTIC_FP_Annotated_<match_id>.csv`

A flat, spreadsheet-friendly file with one row per annotation and these columns (in order):

```
clip_id, match_id, match_name, half, window_idx,
video_path, seek_start_sec, label_start_sec, label_end_sec, seek_end_sec,
team_a_id, team_a_name, team_a_jersey_color,
team_a_intent, team_a_confidence, team_a_possession,
team_b_id, team_b_name, team_b_jersey_color,
team_b_intent, team_b_confidence, team_b_possession,
exclusion, flagged_review, skipped, annotated_at
```

Values are RFC-4180-quoted (commas, quotes, and newlines are escaped). Booleans render as `true` / `false`, and missing values are empty strings.

### Default team identity (editable in the right panel)

| Field          | Team A              | Team B              |
| -------------- | ------------------- | ------------------- |
| `team_id`      | `Team_A`            | `Team_B`            |
| `name`         | `Team A` (editable) | `Team B` (editable) |
| `jersey_color` | `#ef233c` (red)     | `#3b82f6` (blue)    |
| `is_home`      | `true`              | `false`             |

---

## 🐞 Troubleshooting

| Symptom                                                          | Likely cause                                           | Fix                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Error: spawn python3 ENOENT` when running **Generate Manifest** | `python3` is not on `$PATH`                            | Install Python 3.10+ and ensure `python3 --version` works in your shell. The route auto-falls-back to `python` on 500, but if both fail, the pipeline cannot run. |
| `ffmpeg not found` when converting MKV                           | `ffmpeg` binary not installed or not on `PATH`         | See the per-OS install table above. Verify with `ffmpeg -version`.                                                                                                |
| Video plays nothing / "MKV needs a browser-ready MP4"            | Browsers don't decode MKV in `<video>`                 | Click the **Convert to MP4** button in the player, or run the API: `curl -X POST .../api/videos/convert -d '{"source":"match_02.mkv"}'`.                          |
| `EADDRINUSE` on `npm run dev`                                    | Another process owns port 3000 / 5173                  | Stop the other process, or run `PORT=3001 npm run dev` (Next.js picks up `PORT`).                                                                                 |
| Submit blocked with "Quality gate failed"                        | Trackers below 18/22 or quality score < 0.8            | Either improve the source video, mark the clip for review, or use `Skip` to record it as `ContestedPlay`.                                                         |
| "Session hard cap reached at 50 clips"                           | 50 annotations in one session                          | Click **JSON** or **CSV** to export, then **Reset Session** to continue.                                                                                          |
| Server crashes when changing clips                               | Usually an old Node bug with `Readable.toWeb`          | Already fixed — the route uses a custom abort-safe `ReadableStream`. If you still see it, make sure you're on Node 18.17+.                                        |
| Annotations not persisting after refresh                         | `data/annotations.json` not writable                   | Check filesystem permissions on the `data/` directory.                                                                                                            |
| `Cannot find module '@/lib/...'`                                 | TS path alias not picked up                            | Verify `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }` and restart the TS server in your editor.                                                            |
| `Module not found: Can't resolve 'child_process'`                | `child_process` must run on the server, not the client | The route already runs in a Route Handler (server). If you see this in the browser, you have accidentally imported a server module into a client component.       |

---

## 🗺️ Roadmap

- [ ] Multi-user collaboration with reviewer roles and per-clip assignments
- [ ] Inter-annotator agreement scoring (Cohen's κ, Krippendorff's α)
- [ ] Model-assisted suggestion mode (LLM/VLM proposes intents from clip frames)
- [ ] Batch export across multiple matches in one archive
- [ ] Dedicated QA workflow (audit queue, override, sign-off)
- [ ] Tracker quality diagnostics panel (per-player coverage heatmap)
- [ ] Configurable 6-group / 14-label taxonomy (drop-in YAML)
- [ ] One-click Docker Compose (Next.js + pipeline + MinIO for raw videos)
- [ ] WebSocket live annotation feed for shared sessions

---

## 👥 Maintainer

<div align="center">
<table>
<tr>
<td align="center">
  <a href="https://github.com/shafayatsaad">
    <img src="https://github.com/shafayatsaad.png" width="120px" style="border-radius: 50%;" alt="Shafayat Saad" />
    <br />
    <strong>Shafayat Saad</strong>
  </a>
  <br />
  <sub>Project Lead · Football Analytics & AI</sub>
  <br /><br />
  <a href="https://www.linkedin.com/in/shafayatsaad">
    <img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white" />
  </a>
  <a href="https://shafayatsaad.vercel.app/">
    <img src="https://img.shields.io/badge/Portfolio-101010?style=flat-square&logo=google-chrome&logoColor=white" />
  </a>
  <a href="https://github.com/shafayatsaad">
    <img src="https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white" />
  </a>
</td>
</tr>
</table>
</div>

---

## 📝 Design Notes

- **`DeadBall` and `ContestedPlay`** are stored in the top-level `exclusion` field, **not** in `team_a.label.intent_class` or `team_b.label.intent_class`. This is by design — it lets downstream model training treat exclusions as a separate classification head.
- **Attack intents enforce `possession: true`**; defense intents enforce `possession: false`. Violations are blocked at submit time and surfaced in the status pill.
- **Annotation cap = 50**, **forced break = every 20**, **min segment length = 2.0 s**, **quality gate = ≥ 18/22 tracked + score ≥ 0.8**. These constants live in `src/components/AnnotatorClient.tsx` and are easy to tweak.
- **The `reconstruction.padding_mask`** is a 0/1 array that tells the trainer which tensor positions are real vs. zero-padded. It's generated from `tensor_frames` (clamped to `[20, 2000]`).
- **The `Clip` and `Annotation` types in `src/lib/constants.ts`** are the single source of truth — keep them in sync if you extend the schema. The Python pipeline and the API routes all serialize through the same field names.
- **See [`tech-spec.md`](../tech-spec.md)** for the deeper design notes (component inventory, hook contracts, animation table, state shape).

---

<div align="center">
  <sub>Built with Next.js · React · TypeScript · Tailwind · Python · ffmpeg · and a lot of match footage.</sub>
  <br />
  <sub>© TACTIC-FP Annotator · Licensed under the project's repository license.</sub>
</div>
