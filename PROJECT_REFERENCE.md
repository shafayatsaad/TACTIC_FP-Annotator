# TACTIC-FP Annotator Project Reference

This is the single future-reference guide for the TACTIC-FP Annotator repository.
It is written for AI agents and developers who need to understand the project
quickly, make fixes safely, and keep changes aligned with the TACTIC-FP paper
without overstating what the current code actually implements.

This file supersedes the older scattered context and analysis files that used
to live at the repository root.

## 1. Project Purpose

TACTIC-FP Annotator is a local Next.js web app for football tactical intent
annotation. It lets a user load raw match video, create or review time-bounded
segments, label tactical intent for Team A and Team B, persist annotations to
JSON files, and export a training-oriented schema.

The tool is part of a larger TACTIC-FP / TACTIC-Bench research workflow, but
the repository is currently an annotation and preprocessing tool. It is not a
complete model-training, tracking, NOTEARS, GMM, or inference repository.

Core current capabilities:

- Local web annotation UI built with Next.js 14, React 18, TypeScript, and
  Tailwind CSS.
- Video loading from `raw_videos/`, direct browser file loading, drag and drop,
  and server-side range streaming.
- MKV to MP4 preparation through `ffmpeg`, with polling progress in the UI.
- Segment creation, boundary adjustment, deletion, and persistence.
- Tactical intent selection with keyboard shortcuts.
- Possession-aware disabling of some labels.
- File-backed persistence in `data/annotations.json`,
  `data/segments.json`, and `data/clip_manifest.json`.
- JSON and CSV export routes.
- Training export validation gates for 100 ms quantization, segment duration,
  padding masks, contiguity, non-excluded intent presence, coverage, and
  duplicate NPZ paths.

Important current limitations:

- The app does not implement the full tri-axial transformer model described in
  the paper.
- The app does not implement NOTEARS causal graph learning.
- The app does not implement a GMM tactical fingerprint comparator.
- The app does not contain a real YOLOv11 plus Deep-EIoU tracking pipeline.
- `pipeline.py` generates a video clip manifest and placeholder metadata only;
  real trajectory `.npz` files must come from a separate tracking pipeline.
- Current manifest quality, feature, possession, and reconstruction values are
  defaults/placeholders until replaced by real tracking-derived values.

## 2. Paper Alignment Rules

Future work must separate three categories clearly:

1. Implemented in this repository.
2. Planned or target behavior from the paper.
3. External pipeline/model work that is required before paper metrics can be
   claimed.

Do not claim the current repository alone can reproduce paper-level metrics
such as TIA@5, CD-AUC, learned causal DAG quality, 200-match scale,
multi-annotator agreement, or real-time model inference unless the missing
model, tracking, evaluation, and dataset code have been added and verified.

Paper-aligned invariants the annotator should preserve:

- Segment labels are intent-level annotations, not raw events.
- Valid tactical segments should be at least 2 seconds and at most 15 seconds.
- Training time should be quantized to a 100 ms grid, corresponding to 10 fps.
- Trajectory tensors are expected to be shaped `[T, 23, 4]`: 22 players plus
  ball, with `(x, y, dx, dy)`.
- Model input uses max 150 frames per segment at 10 fps.
- Padding masks must be length 150 and active for exactly `T` frames.
- Excluded segments such as `DeadBall` and `ContestedPlay` should not train a
  tactical intent classifier.
- Non-excluded training samples need a primary team intent.
- Split assignment should be match-level for non-excluded data, not randomly
  mixed within one match.
- Synthetic or placeholder DAG features must not be exported as if they were
  trajectory-derived causal features.

## 3. Current Repository Layout

```text
TACTIC_FP-Annotator/
  .eslintrc.json
  .gitattributes
  .gitignore
  README.md
  PROJECT_REFERENCE.md
  assets/
    banner.png
  compute_dag_features.py
  favicon.png
  generate_manifest.py
  next.config.js
  package-lock.json
  package.json
  pipeline.py
  pipeline_validator.py
  postcss.config.js
  src/
    app/
      api/
        annotations/
          delete/route.ts
          reset/route.ts
          route.ts
        export/
          csv/route.ts
          json/route.ts
        manifest/route.ts
        pipeline/generate/route.ts
        segments/route.ts
        videos/
          [[...path]]/route.ts
          convert/route.ts
          metadata/route.ts
      globals.css
      icon.png
      layout.tsx
      page.tsx
    components/
      AnnotationPanel.tsx
      AnnotatorClient.tsx
      ClipExplorer.tsx
      CoverageMeter.tsx
      Header.tsx
      IntentLabels.tsx
      SplitPrompt.tsx
      VideoPlayer.tsx
    lib/
      constants.ts
      server-utils.ts
      splitSegmentBounds.ts
      tensor-utils.ts
      utils.ts
  tailwind.config.ts
  tools/
    convert_to_train_schema.py
    emergency_json_repair.py
  tsconfig.json
```

Ignored runtime/generated paths may exist locally and should generally not be
committed:

- `.next/`: Next.js build/dev cache.
- `node_modules/`: installed npm dependencies.
- `data/`: generated manifests, annotations, segments, exports, trajectories.
- `raw_videos/`: local user-supplied match footage.
- `*.log`, `tsconfig.tsbuildinfo`, `__pycache__/`: generated artifacts.

Do not delete `data/` or `raw_videos/` just because they are ignored. They may
contain the user's active annotations and large local match videos.

## 4. Runtime Data Flow

High-level flow:

```text
raw_videos/*.mp4 or *.mkv
  -> pipeline.py
  -> data/clip_manifest.json
  -> GET /api/manifest
  -> AnnotatorClient state
  -> POST /api/segments and POST /api/annotations
  -> data/segments.json and data/annotations.json
  -> POST /api/export/json or /api/export/csv
  -> data/exports/*
```

Video flow:

```text
raw_videos/<file>
  -> GET /api/videos/<path> with HTTP range support
  -> VideoPlayer <video>
```

MKV conversion flow:

```text
POST /api/videos/convert { source }
  -> background ffmpeg remux attempt
  -> fallback H.264/AAC transcode if remux fails
  -> GET /api/videos/convert?jobId=...
  -> UI progress bar
```

Training export flow:

```text
annotations in browser state
  -> POST /api/export/json?mode=train
  -> convertToMatchSchema()
  -> validateFullExportSource()
  -> convertToTrainSchema()
  -> validateTrainExport()
  -> data/exports/TACTIC_FP_Annotated_<match_id>_TRAIN.json
```

## 5. Frontend Code Map

### `src/app/page.tsx`

The root app page. It renders `AnnotatorClient`.

### `src/app/layout.tsx`

Root Next.js layout and metadata. Keep global page structure here only.

### `src/app/globals.css`

Tailwind directives and global styles. The UI uses utility classes heavily, so
global CSS should stay small.

### `src/components/AnnotatorClient.tsx`

The central client component and single most important frontend file.

Responsibilities:

- Owns nearly all UI state with React `useState`, `useRef`, `useMemo`, and
  `useCallback`.
- Loads manifests and saved server state.
- Loads direct videos and derives default match/team config from filenames.
- Handles playback state, seeking, mute, loop, speed, and fullscreen.
- Creates segment drafts and real clips.
- Saves segment data to `/api/segments`.
- Saves annotation sessions to `/api/annotations`.
- Handles intent selection and exclusion toggling.
- Implements keyboard shortcuts.
- Calls JSON and CSV export endpoints.
- Coordinates child props for header, explorer, video player, intent grid,
  coverage meter, split prompt, and annotation panel.

Important functions and regions:

- `DEFAULT_MATCH_CONFIG`, `DEFAULT_TEAM_CONFIG`, `DEFAULT_GAME_STATE`: startup
  defaults. These are convenient but should not be treated as paper evidence.
- `deriveMatchDefaults(fileName)`: derives `match_id`, home team, and away team
  from loaded filenames.
- `resolveBrowserVideoPaths(clips)`: prefers already-prepared MP4 candidates for
  MKV manifest paths.
- `validateBeforeSubmit(...)`: frontend validation gate for duration, exclusion
  consistency, coverage, quality, and duplicate NPZ paths.
- `handleSetSegmentStart()` and `handleSetSegmentEnd()`: I/O keyboard workflow.
  `O` creates a segment from draft start to current playhead.
- `handleToggleExclusion()`: toggles `DeadBall` / `ContestedPlay`, clears
  tactical intents, and sets split to `excluded`.
- `handleIntentClick()`: maps intent grid clicks/hotkeys to Team A/B labels.
- `handleUpdateSegmentTimes()` and edge update helpers: adjust boundaries and
  keep annotations/segments synchronized.
- `handleDeleteSegment()`: deletes one segment and its annotation without
  re-chaining unrelated segment times.
- `saveAnnotation()`: builds the `Annotation` object, validates it, auto-splits
  overlong segments through `splitSegmentBounds`, persists annotations, and
  advances workflow.
- `handleLoadManifest()`: imports a manifest JSON file from disk.
- `handleLoadVideoDirect()`, `handleSelectServerVideo()`,
  `handleBrowseVideoFile()`, `handleFileDrop()`: video-loading entry points.
- `exportJSON()`: calls `/api/export/json?mode=train` and downloads returned
  export data.
- Keyboard listener: maps playback, segment, team, exclusion, intent, and submit
  shortcuts.
- `toModelSamples()`: legacy helper near the bottom. Prefer the server export
  route for current training schema logic.

Future-change cautions:

- Because this file owns most state, small state changes can affect many
  workflows. Verify segment create, annotation submit, export, and reset after
  edits.
- If adding multi-annotator support, avoid more hardcoded coach/session values.
  Extend `matchConfig` or introduce explicit session/user selection.
- If changing segment timing, keep UI seconds, export milliseconds, tensor
  frame counts, and padding masks aligned.

### `src/components/VideoPlayer.tsx`

Video display and interaction surface.

Responsibilities:

- Renders the native `<video>` element.
- Shows loading, buffering, conversion, and error overlays.
- Provides play/pause, mute, fullscreen, speed, replay, loop, and help buttons.
- Displays a macro timeline for the whole match and a 30-second zoom timeline.
- Displays existing segments, active segment handles, hover time, live playhead,
  and ghost next segment.
- Supports drag/drop video loading.
- Supports boundary dragging and new segment preview.

Keep this component focused on interaction and display. Persisting segment data
belongs in `AnnotatorClient` and the API routes.

### `src/components/AnnotationPanel.tsx`

Right sidebar for setup, annotation, session stats, export, and reset.

Responsibilities:

- Segment start/end numeric controls and nudges.
- Team identity, color, home/away config.
- Game state and scoreline.
- Confidence, uncertainty, auto-next, possession override, and session controls.
- JSON/CSV export buttons.
- Reset session button.

### `src/components/IntentLabels.tsx`

Renders the tactical intent taxonomy from `TACTIC_INTENTS`.

The taxonomy is data-driven. To add or rename an intent, update
`src/lib/constants.ts` first.

### `src/components/ClipExplorer.tsx`

Left sidebar for clip list navigation, filtering, search, segment deletion, and
loading/generating entry points.

### `src/components/Header.tsx`

Top bar for status, progress, and main actions.

### `src/components/CoverageMeter.tsx`

Tracking coverage/quality visualization. Current values depend on manifest or
manual defaults unless a real tracking pipeline provides accurate data.

### `src/components/SplitPrompt.tsx`

Prompt for overlong segment splitting workflow.

## 6. Shared Library Code

### `src/lib/constants.ts`

Defines core domain constants, TypeScript types, and normalization helpers.

Important exports:

- `TACTIC_INTENTS`: six groups and fourteen labels:
  - BuildUp: `BuildUp_Short`, `BuildUp_Long`, `PossCirculation`
  - Attack: `CounterAttack`, `DirectAttack`
  - Press: `HighPress`, `MidBlockPress`, `LowBlock`
  - Transition: `AttackingTrans`, `DefensiveTrans`
  - SetPiece: `SetPieceAttack`, `SetPieceDefend`
  - Exclusion: `DeadBall`, `ContestedPlay`
- `HOTKEY_MAP`: generated from `TACTIC_INTENTS`.
- `ATTACK_INTENTS`, `DEFENSE_INTENTS`, `EXCLUSION_INTENTS`,
  `SET_PIECE_INTENTS`: logical groupings used by validation and UI disabling.
- `MAX_SEGMENT_DURATION = 15`.
- `MIN_SEGMENT_DURATION = 2`.
- `Clip`, `Annotation`, `TeamConfig`, `GameState`, `ModelSplit`, and related
  types.
- `normalizeClip(raw)`: maps loose manifest objects into the internal `Clip`
  shape.
- `makeUniqueClipIds(clips)`: deduplicates clip IDs.

Important caution:

- This file currently has a `"use client"` directive, yet it also re-exports
  tensor utilities used by server routes. Be careful if changing module
  boundaries. Server-only code should not import browser-only modules.

### `src/lib/tensor-utils.ts`

Pure shared tensor helpers with no React/client dependency.

Important exports:

- `MODEL_FPS = 10`.
- `MAX_MODEL_FRAMES = 150`.
- `computeTensorFrames(durationSec, fps)`.
- `computePaddingMask(actualFrames)`.
- `computeTensorShape(durationSec)`.
- `generateNpzPath(matchId, clipId)`.
- `generateClipId(matchId, half, startSec)`.

Use these helpers instead of duplicating tensor math.

### `src/lib/splitSegmentBounds.ts`

Splits a segment `[startMs, endMs]` into valid 2-15 second chunks.

Important behavior:

- Throws if total duration is below the minimum.
- Returns one chunk if total duration is within max.
- Splits from the end backward, preserving critical action timing near segment
  end.
- Absorbs or adjusts remainders so all chunks respect min/max duration.

Use this utility whenever splitting long segments for paper-aligned training
data.

### `src/lib/server-utils.ts`

File-system helpers for Next.js API routes.

Important exports:

- `ensureDirectories()`: creates `data/`, `raw_videos/`, and `data/exports/`.
- `readManifest()`: supports flat arrays, `{ clips: [...] }`, and match objects
  with nested `clips`.
- `readAnnotationSession()` and `readAnnotations()`.
- `writeAnnotations(annotations, teamConfig, matchConfig)`: dedupes by clip ID.
- `resetAnnotations()`.
- `readSegments()`, `writeSegments()`, `deleteSegment(clipId)`.
- `deleteAnnotation(clipId)`.
- `resetGeneratedSessionFiles()`: deletes generated `data/`, recreates it, and
  resets annotations.
- `getVideoPath(relativePath)`: resolves paths against project cwd and
  `raw_videos/`.

Caution:

- `resetGeneratedSessionFiles()` removes the whole `data/` directory. This is
  intended for session reset, but it will delete local annotation/session files.

### `src/lib/utils.ts`

Small client helpers:

- `cn(...)`: class name merge helper.
- `formatTime(seconds)`.
- `formatSec(seconds)`.
- `formatMatchClock(half, seconds)`.
- `formatSecWithHalf(half, seconds)`.
- Another `normalizeClip(raw)` exists here. Prefer the typed version in
  `constants.ts` when working with `Clip`.

## 7. API Routes

### `GET /api/manifest`

File: `src/app/api/manifest/route.ts`

Returns clips from `data/clip_manifest.json` using `readManifest()`.

### `GET /api/annotations`

File: `src/app/api/annotations/route.ts`

Returns the full annotation session wrapper from `data/annotations.json`.

### `POST /api/annotations`

File: `src/app/api/annotations/route.ts`

Writes annotation session data with `writeAnnotations(...)`. The expected body
contains:

- `annotations`
- optional `team_config`
- optional `match_config`

### `POST /api/annotations/delete`

File: `src/app/api/annotations/delete/route.ts`

Deletes one annotation by `clip_id`.

### `POST /api/annotations/reset`

File: `src/app/api/annotations/reset/route.ts`

Calls `resetGeneratedSessionFiles()`. This clears generated session files under
`data/` and recreates an empty annotation session.

### `GET /api/segments`

File: `src/app/api/segments/route.ts`

Returns persisted segments from `data/segments.json`.

### `POST /api/segments`

File: `src/app/api/segments/route.ts`

Supports either a single segment object with `clip_id` or a bulk body with
`{ segments: [...] }`.

Validation includes:

- Duration must be at least 2 seconds.
- End must be after start.
- Exclusion labels cannot conflict with tactical labels.
- Coverage must be at least 0.80.
- NPZ path must be unique across existing segments.

The route also fills reconstruction metadata when absent:

- `npz_path`
- `tensor_shape`
- `tensor_fps`
- `padding_mask`

### `DELETE /api/segments`

File: `src/app/api/segments/route.ts`

Deletes one persisted segment by `clip_id`.

### `POST /api/pipeline/generate`

File: `src/app/api/pipeline/generate/route.ts`

Spawns:

```bash
python3 pipeline.py --clip-duration <n> --annotation-window <n> --step-duration <n>
```

If `python3` fails, retries with `python`.

Returns stdout and the generated manifest as read by `readManifest()`.

### `GET /api/videos/list`

File: `src/app/api/videos/[[...path]]/route.ts`

Special case handled by the dynamic video route. Lists available video files in
`raw_videos/`.

### `GET /api/videos/<path>`

File: `src/app/api/videos/[[...path]]/route.ts`

Streams local video with range request support.

Important implementation detail:

- Uses a custom `createSafeStream(...)` wrapper to avoid crashes when the client
  aborts a stream during clip changes or navigation.

### `HEAD /api/videos/<path>`

File: `src/app/api/videos/[[...path]]/route.ts`

Checks video existence and returns video headers. Used by MKV-to-MP4 resolution
logic.

### `GET /api/videos/metadata?path=...`

File: `src/app/api/videos/metadata/route.ts`

Uses `ffprobe` to return video metadata such as duration/resolution. If this
fails, the UI falls back to browser metadata behavior.

### `POST /api/videos/convert`

File: `src/app/api/videos/convert/route.ts`

Starts a background conversion job for a video in `raw_videos/`.

Behavior:

- Output name is `<base>_720p.mp4`.
- First attempts stream copy/remux.
- If remux fails, transcodes to H.264/AAC at 720p.
- Stores job state in an in-memory `Map`, so progress is lost if the dev server
  restarts.

### `GET /api/videos/convert?jobId=...`

File: `src/app/api/videos/convert/route.ts`

Polls conversion progress or final result.

### `POST /api/export/json?mode=train`

File: `src/app/api/export/json/route.ts`

Writes `data/exports/TACTIC_FP_Annotated_<match_id>_TRAIN.json`.

Important logic:

- `convertToMatchSchema(...)`: builds full match/half/segment structure.
- `validateFullExportSource(...)`: blocks invalid source data for training.
- `removeOrphanedParents(...)`: removes parent segments that fully contain
  child segments.
- `fillGaps(...)`: fills gaps with `ContestedPlay` exclusions or merges small
  gaps.
- `convertToTrainSchema(...)`: strips to model-training shape.
- `validateTrainExport(...)`: enforces paper-aligned gates before writing.

Current source validation blocks:

- Duration below 2 seconds.
- Duration above 15 seconds for training.
- Synthetic `dag_features` present in segment data.
- Mixed non-excluded split values within one match.

### `POST /api/export/json?mode=annotator`

File: `src/app/api/export/json/route.ts`

Writes the fuller match schema without converting to the minimal training
schema.

### `POST /api/export/csv`

File: `src/app/api/export/csv/route.ts`

Writes a flat CSV export. Use this for human inspection, not model training.

## 8. Python Pipeline and Tools

### `pipeline.py`

Generates `data/clip_manifest.json` from videos in `raw_videos/`.

Current behavior:

- Discovers video files with extensions `.mp4`, `.mkv`, `.avi`, `.mov`,
  `.webm`.
- Uses `generate_manifest.add_video_metadata(...)` to get width, height, fps,
  frame count, duration, and tier.
- Slides windows across the video using `clip_duration`,
  `annotation_window`, and `step_duration`.
- Writes clip objects with context windows, annotation windows, fallback event
  anchors, fallback possession state, placeholder quality, placeholder features,
  and placeholder reconstruction metadata.

Important limitation:

- It does not generate real `.npz` trajectories. It says so in the docstring.
  The tracking pipeline is external and must fill trajectory files and real
  feature/coverage/reconstruction metadata.

### `generate_manifest.py`

Helper functions for video metadata and trajectory-derived heuristics.

Important functions:

- `add_video_metadata(video_path)`: reads metadata with OpenCV.
- `extract_enhanced_features(trajectory)`: computes simple trajectory feature
  summaries from a `[T, 23, 4]` tensor.
- `compute_clip_quality(trajectory)`: estimates tracking coverage/quality.
- `detect_possession_state(trajectory)`: proximity-based possession heuristic.
- `detect_intent_shift_points(trajectory, fps)`: heuristic shift detection.
- `propose_segments_from_shifts(...)`: fixed-window segment proposals around
  detected shifts.
- `determine_half(timestamp, match_duration)`: maps seconds to half and clock.

Caution:

- These heuristics are useful starting points, not enough to support strong
  paper claims like high auto-segmentation acceptance without validation.

### `compute_dag_features.py`

Prototype feature extraction for causal/DAG-related features.

Current state:

- Some functions are heuristic or placeholder-level.
- `compute_pitch_control_share(...)` returns a placeholder constant.
- This file is not an implemented NOTEARS or SEM training system.

Do not export its output as paper-validated causal features unless it has been
completed, validated, and wired into a real trajectory/model pipeline.

### `pipeline_validator.py`

Basic environment and output validator. Checks for ffmpeg, directory
structure, manifest presence, and NPZ shape/padding consistency.

### `tools/convert_to_train_schema.py`

Standalone converter from annotator full JSON to minimal training schema.

It mirrors many export-route rules:

- 100 ms quantization.
- Duration from `tensor_shape[0] * 100`.
- Padding mask regeneration.
- Exclusion handling.
- Gap filling.
- Validation gates.

Use it for offline conversion or repair workflows, but keep it aligned with
`src/app/api/export/json/route.ts` if either one changes.

### `tools/emergency_json_repair.py`

One-off repair utility for already-exported JSON data.

Repairs:

- Removes zero-duration segments.
- Sets exclusion labels to `null`.
- Sets exclusion split to `excluded`.
- Removes `dag_features`.
- Adds previous/next links.
- Recomputes duration, tensor shape, and padding mask.

This script cannot fix fake or missing trajectories. It only repairs JSON
structure.

## 9. Data Schemas

### Manifest Clip Shape

Manifest clips are normalized into `Clip` objects. Important fields:

```ts
interface Clip {
  clip_id: string;
  match_id: string;
  path: string;
  start: number;
  end: number;
  annotation_start: number;
  annotation_end: number;
  annotation_window: number;
  half: number;
  game_clock?: string;
  trajectory_path?: string;
  quality_score?: number;
  tracking_coverage?: {
    team_a_avg?: number;
    team_b_avg?: number;
    ball_frames?: number;
    total_frames?: number;
  };
  possession_state?: {
    type: string;
    team: string | null;
    confidence: number;
    method: string;
  };
  reconstruction?: {
    npz_path: string;
    tensor_fps?: number;
    quality_pass?: boolean;
    tracked_players?: number;
  };
}
```

### Annotation Session Shape

Stored in `data/annotations.json`:

```json
{
  "schema_version": "1.0.0",
  "dataset": "TACTIC-Bench",
  "team_config": {},
  "match_config": {},
  "annotations": []
}
```

Each annotation contains:

- Clip and match identifiers.
- `game_state`.
- `video_source` with seek and label boundaries.
- `segment_metadata`.
- `reconstruction`.
- `team_a` label block.
- `team_b` label block.
- `exclusion`.
- `annotation_meta`.
- `agreement`.
- `model_split`.

### Training Export Shape

Training export root:

```json
{
  "match_id": "match_id",
  "model_split": "train",
  "halves": [
    {
      "half": 1,
      "segments": []
    }
  ]
}
```

Training segment shape:

```json
{
  "segment_id": "match_seg000",
  "start_ms": 0,
  "end_ms": 5000,
  "duration_ms": 5000,
  "time_from_kickoff_ms": 0,
  "coverage_estimate": 0.95,
  "exclusion": null,
  "reconstruction": {
    "npz_path": "data/trajectories/match_id/match_seg000.npz",
    "tensor_shape": [50, 23, 4],
    "tensor_fps": 10,
    "padding_mask": [true]
  },
  "primary_team": {
    "intent_class": "BuildUp_Short",
    "confidence": 4,
    "is_primary": true,
    "possession": true
  }
}
```

For exclusions, `primary_team` should be `null`, `coverage_estimate` should be
0 in the train schema, and `npz_path` should be empty unless an explicit
excluded-segment tensor workflow is later designed.

## 10. Keyboard Shortcuts

The global keyboard handler lives in `AnnotatorClient.tsx`.

Playback:

- `Space` or `K`: play/pause.
- `J`: seek backward 10 seconds.
- `L`: seek forward 10 seconds.
- `ArrowLeft`: seek backward 5 seconds.
- `ArrowRight`: seek forward 5 seconds.
- `Shift + ArrowLeft`: seek backward 1 second.
- `Shift + ArrowRight`: seek forward 1 second.
- `U`: mute.
- `F`: fullscreen.
- `[` and `]`: previous/next segment.

Segment workflow:

- `I`: set draft segment start at playhead.
- `O`: set draft segment end at playhead and create the segment.
- `M`: start segment creation mode.
- `N`: cancel segment creation mode.
- `Enter`: confirm draft creation if a draft exists; otherwise submit
  annotation.

Team and label workflow:

- `A`: active team A.
- `B`: active team B.
- Intent hotkeys from `TACTIC_INTENTS`: `1`, `2`, `Q`, `3`, `W`, `4`, `5`,
  `6`, `7`, `8`, `9`, `0`, `R`, `T`.
- `R`: `DeadBall`.
- `T`: `ContestedPlay`.
- `Esc`: clear exclusion, cancel draft, close help.
- `?`: help modal.

## 11. Development Commands

Install dependencies:

```bash
npm install
```

Run dev server:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Start production build:

```bash
npm run start
```

Lint:

```bash
npm run lint
```

Generate manifest from videos:

```bash
python pipeline.py --input-dir raw_videos --clip-duration 18 --annotation-window 10 --step-duration 10
```

Run standalone training-schema conversion:

```bash
python tools/convert_to_train_schema.py --input data/exports/input.json --output data/exports/output_TRAIN.json
```

Run emergency JSON repair:

```bash
python tools/emergency_json_repair.py data/exports/input.json
```

## 12. Common Fix Workflows

### Add or Rename an Intent

1. Edit `TACTIC_INTENTS` in `src/lib/constants.ts`.
2. Update `ATTACK_INTENTS`, `DEFENSE_INTENTS`, `EXCLUSION_INTENTS`, or
   `SET_PIECE_INTENTS` if classification logic changes.
3. Verify `HOTKEY_MAP` still has unique hotkeys.
4. Verify `IntentLabels`, keyboard shortcuts, export, and validation.

### Change Segment Duration Rules

1. Update `MIN_SEGMENT_DURATION` or `MAX_SEGMENT_DURATION` in
   `src/lib/constants.ts`.
2. Update `splitSegmentBounds.ts` tests or manual checks.
3. Update frontend validation in `AnnotatorClient.tsx`.
4. Update `/api/segments` validation.
5. Update `/api/export/json` validation and gap filling if needed.
6. Update `tools/convert_to_train_schema.py`.

### Change Tensor FPS or Max Frames

1. Update `src/lib/tensor-utils.ts`.
2. Check every usage of `MODEL_FPS` and `MAX_MODEL_FRAMES`.
3. Update export validation gates.
4. Update Python scripts using `MODEL_FPS = 10` or `MAX_MODEL_FRAMES = 150`.
5. Re-export a sample and verify `duration_ms == tensor_shape[0] * frame_ms`.

### Add a New API Route

1. Create `src/app/api/<name>/route.ts`.
2. Use `server-utils.ts` for filesystem paths where possible.
3. Validate all request bodies.
4. Return `NextResponse.json(...)` with useful error details.
5. Keep local file writes under `data/` unless there is a strong reason.

### Add Real Tracking Integration

The missing production path should look like:

```text
raw video
  -> detector/tracker/calibration pipeline
  -> full-match trajectory tensor [T_total, 23, 4]
  -> segment slicer using annotation boundaries
  -> per-segment .npz [T_seg, 23, 4]
  -> coverage/quality metadata
  -> optional causal features after validation
```

Required code updates:

- Fill `trajectory_path` and `reconstruction.npz_path` with real files.
- Compute real `tracking_coverage`, `quality_score`, and confidence values.
- Slice `.npz` files by segment boundaries after annotations are finalized.
- Do not fabricate uniform coverage/confidence/feature values.
- Validate every tensor shape and padding mask before training export.

### Add Multi-Annotator Support

Current code is single-session and mostly single-annotator.

Needed changes:

- Add explicit annotator identity selection.
- Store annotations by annotator and segment.
- Add reviewer/adjudication state.
- Compute agreement metrics outside the UI or through a verified backend route.
- Keep paper claims limited until Fleiss' kappa or equivalent metrics are
  computed from real multi-annotator data.

## 13. Known Risk Areas

These are areas future agents should inspect carefully before and after edits:

- `AnnotatorClient.tsx` is large and stateful. Changes there can break multiple
  flows.
- Frontend and backend validation must stay aligned. If one rejects and the
  other accepts a shape, the user experience becomes confusing.
- Export logic has paper-critical assumptions. Always verify with a small
  sample before trusting output.
- `data/` can contain active user work. Avoid cleanup commands that remove it
  unless the user explicitly asks to reset the session.
- `raw_videos/` can contain very large user-owned files. Do not delete it during
  source cleanup.
- `pipeline.py` output contains placeholder metadata. Future agents must not
  infer real tracking quality from it.
- `compute_dag_features.py` is not a validated causal modeling implementation.
- `node_modules/` and `.next/` are disposable generated artifacts, but deleting
  `node_modules/` means the user must run `npm install` before the app starts.

## 14. Cleanup Policy Used for This Repository

The repository should keep:

- Source code required to run the app.
- Python scripts used by the current pipeline or repair/conversion workflows.
- `README.md` as the public quick-start document.
- `PROJECT_REFERENCE.md` as the detailed AI/developer reference.
- Assets required by README/app presentation.

The repository should not keep:

- Duplicate root-level context files that repeat this guide.
- Old paper-gap analysis files after their useful facts are consolidated here.
- Temporary extracted paper text files.
- Generated build caches, logs, TypeScript incremental build info, or Python
  bytecode caches.

Cleanup should not remove:

- User videos in `raw_videos/`.
- User annotation/session data in `data/`.
- Installed dependencies in `node_modules/` unless explicitly requested.

## 15. Verification Checklist After Future Edits

Run at least:

```bash
npm run lint
npm run build
```

Manual app checks:

- Load a video from `raw_videos/`.
- Create a segment with `I` and `O`.
- Reject a segment shorter than 2 seconds.
- Submit a non-excluded tactical annotation.
- Submit a `DeadBall` or `ContestedPlay` exclusion.
- Delete a segment and verify unrelated segments keep their times.
- Export training JSON and confirm validation passes or returns useful gate
  failures.
- Reset session only when intended.

Data checks:

- Non-excluded segments have `primary_team.intent_class`.
- Excluded segments have `primary_team: null` in train export.
- No segment is below 2000 ms.
- No non-excluded segment is above 15000 ms.
- Timestamps are multiples of 100 ms.
- `duration_ms == tensor_shape[0] * 100`.
- `end_ms == start_ms + duration_ms`.
- `padding_mask` length is 150 and active count equals `tensor_shape[0]`.
- Non-excluded NPZ paths are unique.
- Non-excluded coverage is at least 0.80 unless the validation rule changes.

