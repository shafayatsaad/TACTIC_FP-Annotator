# TACTIC-FP Annotator — Project Context

> **Read this first** before making any edits. It explains the architecture,
> data flow, file layout, and coding conventions so you don't have to scan
> every source file.

---

## 1. What This Project Does

**TACTIC-FP Annotator** is a professional football (soccer) tactical intent
annotation tool built for the TACTIC-FP research framework. Researchers use it
to:

1. **Generate** clip manifests from raw match videos (`pipeline.py`).
2. **Annotate** each clip with tactical intents for both teams (A & B) through
   a rich browser-based UI.
3. **Export** annotations as structured JSON/CSV for downstream ML training.

The tool runs as a local **Next.js 14** (App Router) web app.

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS v3 + PostCSS |
| Animations | Framer Motion, CSS transitions |
| Icons | Lucide React |
| State | React `useState` / `useRef` only (no Redux/Zustand) |
| Backend | Next.js API routes (server-side `fs` operations) |
| Pipeline | Python 3 (`pipeline.py` + `generate_manifest.py`) |
| Video | ffmpeg (for MKV → MP4 conversion via API route) |
| Trajectories | NumPy `.npz` files (shape `[T, 23, 4]` — 22 players + ball × [x, y, dx, dy]) |

---

## 3. File Map

```
TACTIC_FP-Annotator/
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout (fonts, metadata)
│   │   ├── page.tsx                   # Entry page (renders AnnotatorClient)
│   │   ├── globals.css                # Global styles + Tailwind directives
│   │   ├── icon.png                   # Favicon
│   │   └── api/                       # ── API Routes ──
│   │       ├── manifest/route.ts      # GET  → reads data/clip_manifest.json
│   │       ├── annotations/
│   │       │   ├── route.ts           # GET/POST → load/save data/annotations.json
│   │       │   └── reset/route.ts     # POST → clear all annotations
│   │       ├── segments/route.ts      # GET/POST/DELETE → data/segments.json
│   │       ├── pipeline/
│   │       │   └── generate/route.ts  # POST → spawns `python pipeline.py`
│   │       ├── videos/
│   │       │   ├── [[...path]]/route.ts  # GET → streams video from raw_videos/
│   │       │   └── convert/route.ts   # POST → ffmpeg MKV→MP4 conversion
│   │       └── export/
│   │           ├── json/route.ts      # POST → JSON export to data/exports/
│   │           └── csv/route.ts       # POST → CSV export to data/exports/
│   │
│   ├── components/
│   │   ├── AnnotatorClient.tsx        # ★ Main client component (all state lives here)
│   │   ├── Header.tsx                 # Top bar — progress, actions, status
│   │   ├── ClipExplorer.tsx           # Left sidebar — clip list, search, filters
│   │   ├── VideoPlayer.tsx            # Center — <video> element + controls + progress
│   │   ├── IntentLabels.tsx           # 14 tactical intent label buttons (6 groups)
│   │   ├── AnnotationPanel.tsx        # Right panel — team toggle, confidence, submit
│   │   ├── CoverageMeter.tsx          # Tracking-coverage visual indicator
│   │   └── SplitPrompt.tsx            # Modal for splitting long segments
│   │
│   └── lib/
│       ├── constants.ts               # TACTIC_INTENTS taxonomy, types (Clip, Annotation, etc.)
│       ├── utils.ts                   # Client helpers: formatTime, cn(), normalizeClip
│       └── server-utils.ts            # Server helpers: read/write annotations, manifest, segments
│
├── pipeline.py                        # Python entry point — generates clip_manifest.json
├── generate_manifest.py               # Python helpers — feature extraction, quality gating,
│                                      #   possession detection, intent-shift detection
├── pipeline_validator.py              # Validates pipeline output
│
├── data/                              # ⚠ GITIGNORED — generated at runtime
│   ├── clip_manifest.json             # Output of pipeline.py
│   ├── annotations.json               # Saved annotations
│   ├── segments.json                  # Segment state
│   ├── exports/                       # Exported JSON/CSV files
│   └── trajectories/                  # .npz trajectory tensors
│
├── raw_videos/                        # ⚠ GITIGNORED — user-supplied match videos
│
├── .gitignore                         # Excludes .next/, data/, raw_videos/, etc.
├── package.json                       # npm deps & scripts
├── next.config.js                     # Next.js config (video streaming headers)
├── tailwind.config.ts                 # Tailwind theme config
├── tsconfig.json                      # TypeScript config
├── postcss.config.js                  # PostCSS (Tailwind + autoprefixer)
├── tech-spec.md                       # Original technical specification
├── README.md / README_JP.md           # Documentation (English + Japanese)
└── CONTEXT.md                         # ★ THIS FILE
```

---

## 4. Architecture & Data Flow

```
 ┌──────────────────────────────────────────────────────────────────┐
 │  User places .mkv/.mp4 files in raw_videos/                     │
 └───────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  pipeline.py  →  data/clip_manifest.json  +  data/trajectories/ │
 │  (invoked via UI button → POST /api/pipeline/generate)          │
 └───────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  Next.js UI  ←  GET /api/manifest  (reads clip_manifest.json)   │
 │                                                                  │
 │  AnnotatorClient.tsx — single source of truth for:               │
 │    • clips[], annotations[], currentClipIndex                    │
 │    • currentTeam (A|B), confidence, selectedIntent               │
 │    • video playback state                                        │
 │                                                                  │
 │  Children: Header, ClipExplorer, VideoPlayer, IntentLabels,      │
 │            AnnotationPanel, CoverageMeter, SplitPrompt           │
 └───────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  POST /api/annotations  →  data/annotations.json                │
 │  POST /api/export/{json,csv}  →  data/exports/                  │
 └──────────────────────────────────────────────────────────────────┘
```

---

## 5. The 14 Tactical Intents (Taxonomy)

| Group | Intents | Hotkeys |
|-------|---------|---------|
| **BUILDUP** | BuildUp_Short, BuildUp_Long, PossCirculation | 1, 2, Q |
| **ATTACK** | CounterAttack, DirectAttack | 3, W |
| **PRESS** | HighPress, MidBlockPress, LowBlock | 4, 5, 6 |
| **TRANSITION** | AttackingTrans, DefensiveTrans | 7, 8 |
| **SETPIECE** | SetPieceAttack, SetPieceDefend | 9, 0 |
| **EXCLUSION** | DeadBall, ContestedPlay | R, T |

Defined in `src/lib/constants.ts` as `TACTIC_INTENTS`.

---

## 6. Key Types (from `constants.ts`)

- **`Clip`** — A video segment with time boundaries, trajectory path, features,
  quality score, possession state, anchor event, segment proposal, etc.
- **`Annotation`** — Full annotation record with `team_a` / `team_b` labels,
  confidence, game state, video source, reconstruction metadata, and annotation
  meta (annotator ID, timestamp, duration).
- **`PhaseMixture`** — `{ BuildUp, Press, Block, Transition }` percentages.
- **`AnnotatorState`** — `unseen | accepted | modified | rejected | manual`.

---

## 7. Important Directories (gitignored)

| Directory | Purpose | Created by |
|-----------|---------|------------|
| `.next/` | Next.js build cache | `npm run dev` / `npm run build` |
| `data/` | Manifest, annotations, trajectories, exports | `pipeline.py` + API routes |
| `raw_videos/` | User-supplied match footage | User manually copies videos here |
| `node_modules/` | npm dependencies | `npm install` |

These are all in `.gitignore`. If they're missing, the app creates them at
runtime via `ensureDirectories()` in `server-utils.ts`.

---

## 8. How to Run

```bash
# 1. Install dependencies
npm install

# 2. Place raw match videos in raw_videos/
#    (supported: .mp4, .mkv, .avi, .mov, .webm)

# 3. Start the dev server
npm run dev        # → http://localhost:3000

# 4. In the UI, click "Generate Manifest" to run the pipeline
#    (or run manually: python pipeline.py --input-dir raw_videos)

# 5. Annotate clips in the browser, then export via the UI
```

**Python dependencies** (for the pipeline): `numpy`, `opencv-python` (`cv2`).

---

## 9. Coding Conventions

- **State management**: All state lives in `AnnotatorClient.tsx` via `useState`
  / `useRef`. No external state library.
- **Styling**: Tailwind CSS utility classes. Custom utilities: `.custom-scrollbar`.
  Use `cn()` from `utils.ts` for conditional classes.
- **API routes**: Each route uses helpers from `server-utils.ts` for file I/O.
  Data is persisted as JSON files on disk (no database).
- **Component pattern**: Server components for `layout.tsx` and `page.tsx`;
  everything else is `"use client"`.
- **Keyboard shortcuts**: Handled in `AnnotatorClient.tsx` via `keydown` listener.
  Hotkey map is in `constants.ts`.

---

## 10. Common Tasks

### Add a new API route
1. Create `src/app/api/<name>/route.ts`.
2. Import helpers from `@/lib/server-utils`.
3. Export `GET` / `POST` / etc. handler functions.

### Add a new component
1. Create `src/components/<Name>.tsx` with `"use client"` directive.
2. Import and render it inside `AnnotatorClient.tsx`.
3. Pass state via props from `AnnotatorClient`.

### Modify the intent taxonomy
1. Edit `TACTIC_INTENTS` in `src/lib/constants.ts`.
2. Update `ATTACK_INTENTS`, `DEFENSE_INTENTS`, `EXCLUSION_INTENTS` arrays.
3. The UI auto-renders from the constant — no template changes needed.

### Add a new export format
1. Create `src/app/api/export/<format>/route.ts`.
2. Add a button in `AnnotationPanel.tsx` that calls the new endpoint.

### Change the trajectory tensor shape
1. Update `generate_mock_trajectory_with_event()` in `pipeline.py`.
2. Update the `Clip.resolution` and `reconstruction` types in `constants.ts`.
3. The tensor shape is `[T, 23, 4]` — 22 players + 1 ball, each with (x, y, dx, dy).

---

## 11. Data Schemas

### clip_manifest.json (array of objects)
```jsonc
{
  "id": "match_001_0012_seg00",
  "match_id": "match_001",
  "path": "raw_videos/match_001_720p.mp4",
  "start": 12.0,        // video seek start (seconds)
  "end": 42.0,          // video seek end
  "annotation_start": 14.8,  // label window start
  "annotation_end": 21.4,    // label window end
  "annotation_window": 6.6,
  "half": 1,
  "game_clock": "00:12",
  "quality_score": 1.0,
  "possession_state": { "type": "POSSESSION", "team": "A", ... },
  "segment_proposal": { "reason": "possession_change", "confidence": 0.9, ... },
  "anchor_event": { "type": "shot", "timestamp": 14.8, ... },
  "resolution": { "width": 1280, "height": 720, "fps": 25.0, ... },
  "features": { "ball_speed": 0.12, "press_intensity": 0.85, ... },
  "reconstruction": { "npz_path": "data/trajectories/...", "tensor_shape": [750, 23, 4], ... }
}
```

### annotations.json (wrapper)
```jsonc
{
  "schema_version": "1.0.0",
  "dataset": "TACTIC-Bench",
  "team_config": { ... },
  "annotations": [
    {
      "clip_id": "match_001_0012_seg00",
      "team_a": { "label": { "intent_class": "BuildUp_Short", "confidence": 4, ... }, ... },
      "team_b": { "label": { "intent_class": "HighPress", "confidence": 3, ... }, ... },
      "exclusion": null,
      "annotation_meta": { "annotator_id": "...", "annotation_duration_sec": 12.5, ... },
      ...
    }
  ]
}
```

---

## 12. Environment & Build

- **Dev**: `npm run dev` (Next.js dev server with HMR)
- **Build**: `npm run build` (production build → `.next/`)
- **Start**: `npm run start` (serve production build)
- **Lint**: `npm run lint`
- **No database**: All persistence is file-based (JSON on disk).
- **No env vars required** for basic operation.
