import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { validateAnnotationSession } from "../src/lib/annotation-validation";
import { resolveInsideDir, sanitizeFileStem } from "../src/lib/server-utils";
import { splitSegmentBounds } from "../src/lib/splitSegmentBounds";
import { generateClipId } from "../src/lib/tensor-utils";

function sampleAnnotation(overrides: Record<string, any> = {}) {
  const base = {
    schema_version: "1.0.0",
    dataset: "TACTIC-Bench",
    clip_id: "match_001_h1_00000",
    match_id: "match_001",
    match_name: "match_001",
    half: "1st",
    window_idx: 0,
    segment_metadata: {
      start_sec: 0,
      end_sec: 5,
      duration_sec: 5,
      tensor_frames: 50,
      coverage_estimate: 0.95,
      is_mixed_phase: false,
    },
    game_state: {
      half: "1st",
      match_clock_sec: 0,
      score_home: 0,
      score_away: 0,
    },
    video_source: {
      video_path: "raw_videos/match_001.mp4",
      seek_start_sec: 0,
      label_start_sec: 0,
      label_end_sec: 5,
      seek_end_sec: 9,
      fps: 25,
      tensor_fps: 10,
      source_frame_count: 125,
      tensor_frame_count: 50,
    },
    reconstruction: {
      npz_path: "data/trajectories/match_001/match_001_h1_00000.npz",
      quality_pass: true,
      tracked_players: 22,
    },
    team_a: {
      team_id: "Team_A",
      is_home: true,
      is_primary: true,
      label: {
        intent_class: "BuildUp_Short",
        confidence: 4,
        certainty: "high",
      },
      possession: true,
    },
    team_b: {
      team_id: "Team_B",
      is_home: false,
      is_primary: false,
      label: {
        intent_class: "HighPress",
        confidence: 4,
        certainty: "high",
      },
      possession: false,
    },
    exclusion: null,
    agreement: {
      annotated_at: "2026-07-22T00:00:00.000Z",
      flagged_review: false,
      skipped: false,
    },
    annotation_meta: {
      annotator_id: "coach_001",
      session_id: "session_001",
      annotation_timestamp: "2026-07-22T00:00:00.000Z",
      annotation_duration_sec: 10,
      tool_version: "tactic-annotator-v3.0",
    },
    model_split: { assigned_split: "train" },
  };

  return {
    ...base,
    ...overrides,
    segment_metadata: {
      ...base.segment_metadata,
      ...(overrides.segment_metadata ?? {}),
    },
    video_source: {
      ...base.video_source,
      ...(overrides.video_source ?? {}),
    },
    reconstruction: {
      ...base.reconstruction,
      ...(overrides.reconstruction ?? {}),
    },
    team_a: {
      ...base.team_a,
      ...(overrides.team_a ?? {}),
      label: {
        ...base.team_a.label,
        ...(overrides.team_a?.label ?? {}),
      },
    },
    team_b: {
      ...base.team_b,
      ...(overrides.team_b ?? {}),
      label: {
        ...base.team_b.label,
        ...(overrides.team_b?.label ?? {}),
      },
    },
    game_state: {
      ...base.game_state,
      ...(overrides.game_state ?? {}),
    },
    model_split: {
      ...base.model_split,
      ...(overrides.model_split ?? {}),
    },
  };
}

test("valid non-excluded annotation passes persistence validation", () => {
  const report = validateAnnotationSession([sampleAnnotation()]);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
});

test("training validation rejects missing NPZ file", () => {
  const report = validateAnnotationSession([sampleAnnotation()], {
    requireNpz: true,
  });
  assert.equal(report.ok, false);
  assert.match(report.errors.map((entry) => entry.code).join(","), /missing_npz_file/);
});

test("validation rejects overlong segments", () => {
  const report = validateAnnotationSession([
    sampleAnnotation({
      segment_metadata: {
        end_sec: 19.5,
        duration_sec: 19.5,
        tensor_frames: 150,
      },
      video_source: {
        label_end_sec: 19.5,
        tensor_frame_count: 150,
      },
    }),
  ]);
  assert.equal(report.ok, false);
  assert.match(report.errors.map((entry) => entry.code).join(","), /segment_too_long/);
});

test("training validation rejects timeline gaps", () => {
  const first = sampleAnnotation();
  const second = sampleAnnotation({
    clip_id: "match_001_h1_00070",
    segment_metadata: {
      start_sec: 7,
      end_sec: 12,
      duration_sec: 5,
    },
    video_source: {
      label_start_sec: 7,
      label_end_sec: 12,
    },
    reconstruction: {
      npz_path: "data/trajectories/match_001/match_001_h1_00070.npz",
    },
  });
  const report = validateAnnotationSession([first, second], {
    requireContiguous: true,
  });
  assert.equal(report.ok, false);
  assert.match(report.errors.map((entry) => entry.code).join(","), /timeline_gap/);
});

test("exclusion annotations must not carry tactical labels", () => {
  const invalid = validateAnnotationSession([
    sampleAnnotation({
      exclusion: "DeadBall",
      model_split: { assigned_split: "excluded" },
    }),
  ]);
  assert.equal(invalid.ok, false);
  assert.match(
    invalid.errors.map((entry) => entry.code).join(","),
    /exclusion_has_tactical_label/,
  );

  const valid = validateAnnotationSession([
    sampleAnnotation({
      exclusion: "DeadBall",
      model_split: { assigned_split: "excluded" },
      team_a: {
        is_primary: false,
        possession: false,
        label: { intent_class: null, confidence: null, certainty: "high" },
      },
      team_b: {
        is_primary: false,
        possession: false,
        label: { intent_class: null, confidence: null, certainty: "high" },
      },
    }),
  ]);
  assert.equal(valid.ok, true);
});

test("video path resolution stays inside the configured directory", () => {
  const base = path.resolve(process.cwd(), "raw_videos");
  assert.equal(resolveInsideDir(base, "../package.json"), null);
  assert.equal(resolveInsideDir(base, "raw_videos/../package.json"), null);
  assert.equal(
    resolveInsideDir(base, "match.mp4"),
    path.resolve(base, "match.mp4"),
  );
});

test("file stem sanitization strips unsafe filename characters", () => {
  assert.equal(sanitizeFileStem("../bad match?.json"), "bad_match_json");
  assert.equal(sanitizeFileStem(""), "unknown");
});

test("clip ids are sanitized and based on 100ms timeline position", () => {
  assert.equal(
    generateClipId("match_001_720p", 1, 5.6),
    "match_001_720p_h1_00056",
  );
  assert.equal(
    generateClipId("bad match?.mp4", 2, 19.04),
    "bad_match_mp4_h2_00190",
  );
  assert.equal(generateClipId("match_001", 1, 19.06), "match_001_h1_00191");
});

test("long segments split forward with valid final remainder", () => {
  assert.deepEqual(splitSegmentBounds(19_000, 35_000), [
    { start: 19_000, end: 33_000 },
    { start: 33_000, end: 35_000 },
  ]);
  assert.deepEqual(splitSegmentBounds(19_000, 36_000), [
    { start: 19_000, end: 34_000 },
    { start: 34_000, end: 36_000 },
  ]);
  assert.deepEqual(splitSegmentBounds(19_000, 40_000), [
    { start: 19_000, end: 34_000 },
    { start: 34_000, end: 40_000 },
  ]);
});
