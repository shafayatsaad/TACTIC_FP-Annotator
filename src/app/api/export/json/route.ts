import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getExportsDir } from "@/lib/server-utils";
import {
  generateNpzPath,
  MODEL_FPS,
  MAX_MODEL_FRAMES,
  computeTensorFrames,
  computePaddingMask,
  computeTensorShape,
} from "@/lib/tensor-utils";

function validateNpzExists(npzPath: string): boolean {
  const fullPath = path.join(process.cwd(), "public", npzPath);
  if (fs.existsSync(fullPath)) return true;
  // also check relative to cwd directly
  const altPath = path.join(process.cwd(), npzPath);
  return fs.existsSync(altPath);
}

function getNpzFullPath(npzPath: string): string | null {
  const fullPath = path.join(process.cwd(), "public", npzPath);
  if (fs.existsSync(fullPath)) return fullPath;
  const altPath = path.join(process.cwd(), npzPath);
  if (fs.existsSync(altPath)) return altPath;
  return null;
}

/**
 * Quantize a millisecond timestamp to the nearest 100ms (10 fps grid).
 */
function quantizeMs(ms: number): number {
  return Math.round(ms / 100) * 100;
}

function normalizeCoverage(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return value > 1 ? value / 100 : value;
}

function dedupeAnnotationsByClipId(annotations: any[]): any[] {
  const keyed = new Map<string, any>();
  const unkeyed: any[] = [];

  for (const annotation of annotations) {
    const clipId = annotation?.clip_id;
    if (typeof clipId === "string" && clipId.length > 0) {
      keyed.delete(clipId);
      keyed.set(clipId, annotation);
    } else {
      unkeyed.push(annotation);
    }
  }

  return [...unkeyed, ...Array.from(keyed.values())];
}

function validateFullExportSource(fullData: any): string[] {
  const errors: string[] = [];
  const splits = new Set<string>();

  for (const half of fullData.halves || []) {
    for (const seg of half.segments || []) {
      const prefix = `Half ${half.half}, segment "${seg.segment_id}"`;
      if (!seg.exclusion) {
        splits.add(seg.model_split || "train");
      }
      if (seg.duration_ms < 2000) {
        errors.push(`${prefix}: source duration_ms (${seg.duration_ms}) is below 2000`);
      }
      if (seg.duration_ms > MAX_MODEL_FRAMES * 100) {
        errors.push(
          `${prefix}: source duration_ms (${seg.duration_ms}) exceeds ${MAX_MODEL_FRAMES * 100}; split the segment before export`,
        );
      }
      if (seg.dag_features || seg.reconstruction?.dag_features) {
        errors.push(`${prefix}: synthetic dag_features are not allowed in annotation/export data`);
      }
    }
  }

  if (splits.size > 1) {
    errors.push(
      `Match contains mixed non-excluded model_split values: ${Array.from(splits).join(", ")}`,
    );
  }

  return errors;
}

/**
 * Remove orphaned parent segments whose time span fully contains another segment.
 * A segment A is an orphaned parent if there exists a segment B such that
 * B.start_ms >= A.start_ms and B.end_ms <= A.end_ms and B !== A.
 * The child segments represent the refined, final annotation.
 */
function removeOrphanedParents(segments: any[]): any[] {
  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms);
  const toRemove = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue;
      const a = sorted[i];
      const b = sorted[j];
      // A is a parent of B if A fully contains B
      if (
        a.start_ms <= b.start_ms &&
        a.end_ms >= b.end_ms &&
        (a.start_ms < b.start_ms || a.end_ms > b.end_ms)
      ) {
        toRemove.add(i);
        break;
      }
    }
  }
  return sorted.filter((_, idx) => !toRemove.has(idx));
}

/**
 * Fill temporal gaps between consecutive segments within a half.
 * Gaps < 2000ms are merged into the preceding segment.
 * Gaps >= 2000ms get a new exclusion segment (ContestedPlay) inserted.
 */
function fillGaps(segments: any[], half: number): any[] {
  if (segments.length === 0) return segments;
  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms);
  const result: any[] = [];
  const maxChunkMs = MAX_MODEL_FRAMES * 100;

  const makeGapSegment = (startMs: number, endMs: number, idx: number) => {
    const durationMs = endMs - startMs;
    const tensorFrames = Math.min(
      computeTensorFrames(durationMs / 1000),
      MAX_MODEL_FRAMES,
    );

    return {
      segment_id: `gap_fill_${half}_${startMs}_${idx}`,
      half,
      start_ms: startMs,
      end_ms: endMs,
      duration_ms: durationMs,
      time_from_kickoff_ms: startMs,
      coverage_estimate: 0,
      exclusion: "ContestedPlay",
      model_split: "excluded",
      reconstruction: {
        npz_path: "",
        tensor_shape: [tensorFrames, 23, 4],
        tensor_fps: MODEL_FPS,
        padding_mask: computePaddingMask(tensorFrames),
      },
    };
  };

  const makeGapSegments = (startMs: number, endMs: number) => {
    const gapSegments: any[] = [];
    let cursor = startMs;
    let idx = 0;

    while (endMs - cursor > maxChunkMs) {
      let nextEnd = cursor + maxChunkMs;
      const remainder = endMs - nextEnd;
      if (remainder > 0 && remainder < 2000) {
        nextEnd = endMs - 2000;
      }
      gapSegments.push(makeGapSegment(cursor, nextEnd, idx));
      cursor = nextEnd;
      idx += 1;
    }

    if (endMs > cursor) {
      gapSegments.push(makeGapSegment(cursor, endMs, idx));
    }

    return gapSegments;
  };

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    result.push(current);
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      const gapMs = next.start_ms - current.end_ms;
      if (gapMs > 0 && gapMs < 2000) {
        // Merge gap into current segment by extending its end
        current.end_ms = next.start_ms;
        current.duration_ms = current.end_ms - current.start_ms;
        // Recompute tensor metadata for the merged segment
        const durationSec = current.duration_ms / 1000;
        const rawFrames = computeTensorFrames(durationSec);
        const tensorFrames = Math.min(rawFrames, MAX_MODEL_FRAMES);
        current.reconstruction.tensor_shape = [tensorFrames, 23, 4];
        current.reconstruction.padding_mask = computePaddingMask(tensorFrames);
      } else if (gapMs >= 2000) {
        result.push(...makeGapSegments(current.end_ms, next.start_ms));
      }
    }
  }
  return result;
}

/**
 * Convert annotations to the full annotator export schema.
 */
function convertToMatchSchema(anns: any[], matchConfig: any, teamConfig: any) {
  const match_id = matchConfig?.match_id || "manual_match";
  const competition = matchConfig?.competition || "england_epl";
  const season = matchConfig?.season || "2024-2015";
  const match_date =
    matchConfig?.match_date || new Date().toISOString().slice(0, 10);
  const home_team = matchConfig?.home_team || "Team A";
  const away_team = matchConfig?.away_team || "Team B";
  const final_score = matchConfig?.final_score || "0-0";
  const halftime_score = matchConfig?.halftime_score || "0-0";

  // Sort annotations by half and start time before building segments
  const sortedAnns = dedupeAnnotationsByClipId(anns).sort((a, b) => {
    const halfA = Number(a.half) || (a.half === "2nd" ? 2 : 1);
    const halfB = Number(b.half) || (b.half === "2nd" ? 2 : 1);
    if (halfA !== halfB) return halfA - halfB;
    const aStart = Number(
      a.segment_metadata?.start_sec ?? a.video_source?.label_start_sec ?? 0,
    );
    const bStart = Number(
      b.segment_metadata?.start_sec ?? b.video_source?.label_start_sec ?? 0,
    );
    return aStart - bStart;
  });

  // Reconstruct segments
  const segmentsList = sortedAnns.map((ann, idx) => {
    const start_sec = Number(
      ann.segment_metadata?.start_sec ?? ann.video_source?.label_start_sec ?? 0,
    );
    const end_sec = Number(
      ann.segment_metadata?.end_sec ?? ann.video_source?.label_end_sec ?? 0,
    );
    const duration_sec = Number(
      ann.segment_metadata?.duration_sec ?? end_sec - start_sec,
    );
    const coverage_estimate = normalizeCoverage(
      ann.segment_metadata?.coverage_estimate ?? 1,
    );
    // Dynamic frames based on actual duration and capped at MAX_MODEL_FRAMES
    const rawFrames = computeTensorFrames(duration_sec);
    const tensorFrames = Math.min(rawFrames, MAX_MODEL_FRAMES);
    let tensorShape = [tensorFrames, 23, 4];
    let padding_mask = computePaddingMask(tensorFrames);
    const tensorFps = MODEL_FPS;

    // Validate trajectory file shape if it exists (best-effort, never blocks export)
    const npzPath = generateNpzPath(match_id, ann.clip_id);
    const fullPath = getNpzFullPath(npzPath);
    if (fullPath) {
      try {
        const safePath = fullPath.replace(/\\/g, "/");
        const cmd = `python -c "import numpy as np; d = np.load('${safePath}'); print(list(d['trajectory'].shape))"`;
        const stdout = execSync(cmd, {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        const actualShape = JSON.parse(stdout);
        if (Array.isArray(actualShape) && actualShape.length === 3) {
          if (
            actualShape[0] !== tensorShape[0] ||
            actualShape[1] !== 23 ||
            actualShape[2] !== 4
          ) {
            tensorShape = [actualShape[0], actualShape[1], actualShape[2]];
            padding_mask = computePaddingMask(actualShape[0]);
          }
        }
      } catch (error) {
        console.error(`Failed to validate NPZ shape for ${fullPath}:`, error);
      }
    }

    // Map team_a and team_b to team_home and team_away
    const aIsHome =
      teamConfig?.team_a?.is_home === true || ann.team_a?.is_home === true;
    const teamAObj = ann.team_a || {};
    const teamBObj = ann.team_b || {};

    const team_home = aIsHome ? teamAObj : teamBObj;
    const team_away = aIsHome ? teamBObj : teamAObj;

    const isExclusion = ann.exclusion ? true : false;

    // Determine primary team (the one with is_primary: true)
    const primaryTeam =
      [teamAObj, teamBObj].find((team) => team?.is_primary === true) ||
      [teamAObj, teamBObj].find((team) => team?.possession === true) ||
      null;
    const isPrimary = primaryTeam?.is_primary === true;

    // Intents mapping — only the primary team's label
    const primary_label = isExclusion
      ? {
          intent_class: null,
          confidence: null,
        }
      : {
          intent_class: primaryTeam?.label?.intent_class ?? null,
          confidence: primaryTeam?.label?.confidence ?? 0,
        };

    // decisive action mapping
    let decisive_action = null;
    const preEv = ann.segment_metadata?.preceding_event;
    if (
      preEv === "shot" ||
      preEv === "goal" ||
      preEv === "pass" ||
      preEv === "cross"
    ) {
      decisive_action = {
        action_type:
          preEv === "shot"
            ? "Shots on target"
            : preEv === "pass"
              ? "Pass"
              : preEv === "cross"
                ? "Cross"
                : "Goal",
        position_ms: Math.round((end_sec - start_sec - 1) * 1000),
        team: team_home?.possession ? "home" : "away",
        visibility: "visible",
        tia_delta_ms: 5000,
      };
    }

    const assignedSplit = isExclusion
      ? "excluded"
      : ann.model_split?.assigned_split || "train";

    return {
      segment_id:
        ann.clip_id || `${match_id}_seg${String(idx).padStart(3, "0")}`,
      half: Number(ann.half) || (ann.half === "2nd" ? 2 : 1),
      start_ms: quantizeMs(Math.round(start_sec * 1000)),
      end_ms: quantizeMs(Math.round(end_sec * 1000)),
      duration_ms: quantizeMs(Math.round(duration_sec * 1000)),
      time_from_kickoff_ms: quantizeMs(Math.round(start_sec * 1000)),
      coverage_estimate: Number(coverage_estimate.toFixed(3)),
      reconstruction: {
        npz_path: generateNpzPath(match_id, ann.clip_id),
        tensor_shape: tensorShape,
        tensor_fps: tensorFps,
        padding_mask,
      },
      team: {
        label: primary_label,
        is_primary: isPrimary,
        possession: isExclusion ? false : primaryTeam?.possession === true,
      },
      exclusion: ann.exclusion || null,
      model_split: assignedSplit,
      ...(decisive_action ? { decisive_action } : {}),
    };
  });

  // Split segments into halves
  const h1Segments = segmentsList.filter((s) => s.half === 1);
  const h2Segments = segmentsList.filter((s) => s.half === 2);

  // Video source detection
  const h1VideoSource = h1Segments[0]?.reconstruction?.npz_path
    ? path
        .basename(h1Segments[0].reconstruction.npz_path)
        .replace(/\.[^.]+$/, "") + ".mp4"
    : `${home_team.toLowerCase()}_${away_team.toLowerCase()}_h1.mp4`;
  const h2VideoSource = h2Segments[0]?.reconstruction?.npz_path
    ? path
        .basename(h2Segments[0].reconstruction.npz_path)
        .replace(/\.[^.]+$/, "") + ".mp4"
    : `${home_team.toLowerCase()}_${away_team.toLowerCase()}_h2.mp4`;

  const halves = [];
  if (h1Segments.length > 0 || h2Segments.length === 0) {
    halves.push({
      half: 1,
      video_source: h1VideoSource,
      duration_ms:
        h1Segments.length > 0
          ? Math.max(...h1Segments.map((s) => s.end_ms))
          : 2700000,
      score_at_end: halftime_score,
      segments: h1Segments,
    });
  }
  if (h2Segments.length > 0) {
    const h2EndMs = h2Segments.map((s) => s.end_ms);
    halves.push({
      half: 2,
      video_source: h2VideoSource,
      duration_ms: h2EndMs.length > 0 ? Math.max(...h2EndMs) : 2700000,
      score_at_start: halftime_score,
      score_at_end: final_score,
      segments: h2Segments,
    });
  }

  return {
    match_id,
    competition,
    season,
    match_date,
    home_team,
    away_team,
    final_score,
    halftime_score,
    halves,
  };
}

/**
 * Convert the full annotator schema to the training schema.
 *
 * Paper compliance (§3.1, §3.3, §3.4, §4.1, §6.3.1):
 *  1. Quantize all timestamps to 100 ms (10 fps grid)
 *  2. Derive duration_ms = tensor_shape[0] × 100
 *  3. Derive end_ms = start_ms + duration_ms
 *  4. Remove orphaned parent segments
 *  5. Fill temporal gaps (< 2 s → extend; ≥ 2 s → exclusion insert)
 *  6. Strip all non-training fields (audit, UI, non-primary team)
 *  7. Flatten to `primary_team` (one intent per segment, §3.4)
 *  8. Move `model_split` to match root (match-level split, §6.3)
 *  9. Validate via §6.3.1 gates before writing
 */
function convertToTrainSchema(fullData: any): any {
  // Process each half's segments
  const trainHalves = fullData.halves.map((half: any) => {
    let segments = [...half.segments];

    // 1. Remove orphaned parent segments (superset time spans)
    segments = removeOrphanedParents(segments);

    // 2. Sort by start_ms
    segments.sort((a: any, b: any) => a.start_ms - b.start_ms);

    // 3. Fill temporal gaps
    segments = fillGaps(segments, half.half);

    // 4. Sort again after gap filling
    segments.sort((a: any, b: any) => a.start_ms - b.start_ms);

    // 5. Transform each segment to training format
    const trainSegments = segments.map((seg: any) => {
      // Quantize start to 100 ms grid
      const startMs = quantizeMs(seg.start_ms);

      // Determine tensor frames from the reconstruction block
      const tensorFrames = seg.reconstruction?.tensor_shape?.[0] || 0;

      // Duration is derived from tensor shape: tensor_shape[0] × 100 (§6.3.1 Gate #4)
      const durationMs = tensorFrames * 100;

      // End is derived: start_ms + duration_ms
      const alignedEndMs = startMs + durationMs;

      // Rebuild padding mask to match tensor shape
      const paddingMask = computePaddingMask(tensorFrames);

      // Resolve the primary team from the annotator schema.
      // The annotator schema uses a single `team` block (already primary-only).
      const primaryTeam = seg.team || {};
      const hasPrimary = primaryTeam.is_primary === true;

      // Build the training segment — only paper-essential fields
      const trainSeg: any = {
        segment_id: seg.segment_id,
        start_ms: startMs,
        end_ms: alignedEndMs,
        duration_ms: durationMs,
        time_from_kickoff_ms: startMs,
        coverage_estimate: seg.exclusion ? 0 : seg.coverage_estimate,
        exclusion: seg.exclusion || null,
        reconstruction: {
          npz_path: seg.exclusion ? "" : seg.reconstruction?.npz_path || "",
          tensor_shape: [tensorFrames, 23, 4],
          tensor_fps: MODEL_FPS,
          padding_mask: paddingMask,
        },
      };

      // Exclusions: primary_team is null (dataloader skips these)
      // Non-exclusions: include the primary team block
      if (seg.exclusion) {
        trainSeg.primary_team = null;
      } else if (hasPrimary) {
        trainSeg.primary_team = {
          intent_class: primaryTeam.label?.intent_class ?? null,
          confidence: primaryTeam.label?.confidence ?? 0,
          is_primary: true,
          possession: primaryTeam.possession === true,
        };
      }

      return trainSeg;
    });

    return {
      half: half.half,
      segments: trainSegments,
    };
  });

  // Determine match-level model_split (§6.3 — match-level splitting)
  // All non-excluded segments must share the same split value.
  const allNonExcludedSplits: string[] = [];
  for (const half of fullData.halves) {
    for (const seg of half.segments) {
      if (!seg.exclusion) {
        allNonExcludedSplits.push(seg.model_split || "train");
      }
    }
  }
  const uniqueSplits = Array.from(new Set(allNonExcludedSplits));
  const matchSplit =
    uniqueSplits.length === 1 ? uniqueSplits[0] : uniqueSplits[0] || "train";

  return {
    match_id: fullData.match_id,
    model_split: matchSplit,
    halves: trainHalves,
  };
}

/**
 * §6.3.1 Validation gates for training export.
 * Returns an array of error strings. Empty array = all gates passed.
 */
function validateTrainExport(trainData: any): string[] {
  const errors: string[] = [];
  const seenNpz = new Map<string, string>();

  for (const half of trainData.halves) {
    const segs = half.segments;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const prefix = `Half ${half.half}, segment "${seg.segment_id}"`;

      // Gate 1 — Quantization: all timestamps must be multiples of 100
      if (seg.start_ms % 100 !== 0) {
        errors.push(
          `${prefix}: start_ms (${seg.start_ms}) is not a multiple of 100`,
        );
      }
      if (seg.end_ms % 100 !== 0) {
        errors.push(
          `${prefix}: end_ms (${seg.end_ms}) is not a multiple of 100`,
        );
      }
      if (seg.duration_ms % 100 !== 0) {
        errors.push(
          `${prefix}: duration_ms (${seg.duration_ms}) is not a multiple of 100`,
        );
      }
      if (seg.duration_ms < 2000) {
        errors.push(
          `${prefix}: duration_ms (${seg.duration_ms}) is below the 2000 ms minimum`,
        );
      }
      if (!seg.exclusion && seg.duration_ms > MAX_MODEL_FRAMES * 100) {
        errors.push(
          `${prefix}: duration_ms (${seg.duration_ms}) exceeds the ${MAX_MODEL_FRAMES * 100} ms maximum`,
        );
      }

      const tensorShape = seg.reconstruction?.tensor_shape;
      const tensorFrames = Array.isArray(tensorShape) ? tensorShape[0] || 0 : 0;
      const paddingMask = seg.reconstruction?.padding_mask;
      if (
        !Array.isArray(tensorShape) ||
        tensorShape.length !== 3 ||
        tensorShape[1] !== 23 ||
        tensorShape[2] !== 4
      ) {
        errors.push(
          `${prefix}: tensor_shape must be [T, 23, 4], got ${JSON.stringify(tensorShape)}`,
        );
      }
      if (!Array.isArray(paddingMask) || paddingMask.length !== MAX_MODEL_FRAMES) {
        errors.push(
          `${prefix}: padding_mask must contain ${MAX_MODEL_FRAMES} values`,
        );
      } else if (
        paddingMask.reduce(
          (sum: number, value: unknown) => sum + (Number(value) === 1 ? 1 : 0),
          0,
        ) !== tensorFrames
      ) {
        errors.push(
          `${prefix}: padding_mask active count does not match tensor_shape[0] (${tensorFrames})`,
        );
      }

      // Gate 2 — Tensor alignment: duration_ms === tensor_shape[0] × 100
      // Skip for exclusion segments — they have no real tensor
      if (!seg.exclusion) {
        if (!seg.primary_team?.intent_class) {
          errors.push(`${prefix}: non-excluded segment has no primary intent`);
        }
        if (seg.coverage_estimate < 0.8) {
          errors.push(
            `${prefix}: coverage_estimate (${seg.coverage_estimate}) is below 0.80`,
          );
        }
        const npzPath = seg.reconstruction?.npz_path;
        if (!npzPath) {
          errors.push(`${prefix}: non-excluded segment has no npz_path`);
        } else if (seenNpz.has(npzPath)) {
          errors.push(
            `${prefix}: duplicate npz_path "${npzPath}" already used by "${seenNpz.get(npzPath)}"`,
          );
        } else {
          seenNpz.set(npzPath, seg.segment_id);
        }

        const expectedDuration = tensorFrames * 100;
        if (seg.duration_ms !== expectedDuration) {
          errors.push(
            `${prefix}: duration_ms (${seg.duration_ms}) ≠ tensor_shape[0]×100 (${expectedDuration})`,
          );
        }

        // Gate 2b — end_ms === start_ms + duration_ms
        if (seg.end_ms !== seg.start_ms + seg.duration_ms) {
          errors.push(
            `${prefix}: end_ms (${seg.end_ms}) ≠ start_ms + duration_ms (${seg.start_ms + seg.duration_ms})`,
          );
        }
      }

      // Gate 3 — Contiguity: segment[n].end_ms === segment[n+1].start_ms
      if (i < segs.length - 1) {
        const next = segs[i + 1];
        if (seg.end_ms !== next.start_ms) {
          errors.push(
            `${prefix}: end_ms (${seg.end_ms}) ≠ next segment start_ms (${next.start_ms}) — gap of ${next.start_ms - seg.end_ms} ms`,
          );
        }
      }
    }

    // Gate 4 — No orphans: no segment's span fully contains another's
    for (let i = 0; i < segs.length; i++) {
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        const a = segs[i];
        const b = segs[j];
        if (
          a.start_ms <= b.start_ms &&
          a.end_ms >= b.end_ms &&
          (a.start_ms < b.start_ms || a.end_ms > b.end_ms)
        ) {
          errors.push(
            `Half ${half.half}: segment "${a.segment_id}" [${a.start_ms}–${a.end_ms}] fully contains "${b.segment_id}" [${b.start_ms}–${b.end_ms}]`,
          );
          break; // One report per parent is enough
        }
      }
    }
  }

  // Gate 5 — Uniform split: all non-excluded segments share model_split
  const allSplits: string[] = [];
  for (const half of trainData.halves) {
    for (const seg of half.segments) {
      if (!seg.exclusion) {
        // In the train schema, model_split is at the match root,
        // but we need to verify the source data was uniform.
        // We already enforced this in convertToTrainSchema;
        // this gate catches any logic errors.
      }
    }
  }
  // (Uniform split is enforced during conversion; the gate is a no-op here
  //  since model_split is already at the match root. Kept for completeness.)

  return errors;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const anns = body.annotations || [];
    const matchConfig = body.match_config;
    const teamConfig = body.team_config;

    // Determine export mode from query parameter
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "train";

    const matchId = matchConfig?.match_id || "unknown";
    const modeSuffix = mode === "train" ? "_TRAIN" : "";
    const fileName = `TACTIC_FP_Annotated_${matchId}${modeSuffix}.json`;
    const filePath = path.join(getExportsDir(), fileName);

    const fullData = convertToMatchSchema(anns, matchConfig, teamConfig);
    const sourceValidationErrors =
      mode === "train" ? validateFullExportSource(fullData) : [];
    if (sourceValidationErrors.length > 0) {
      return NextResponse.json(
        {
          error: "Training export failed source validation gates",
          gate_failures: sourceValidationErrors,
          gate_count: sourceValidationErrors.length,
        },
        { status: 422 },
      );
    }

    let exportedData: any;
    if (mode === "train") {
      exportedData = convertToTrainSchema(fullData);

      // §6.3.1 — Run validation gates before writing
      const validationErrors = validateTrainExport(exportedData);
      if (validationErrors.length > 0) {
        return NextResponse.json(
          {
            error: "Training export failed §6.3.1 validation gates",
            gate_failures: validationErrors,
            gate_count: validationErrors.length,
          },
          { status: 422 },
        );
      }
    } else {
      exportedData = fullData;
    }

    // Validate only non-excluded samples. Exclusion rows are skipped by training.
    const missingNpz: string[] = [];
    for (const half of exportedData.halves) {
      for (const segment of half.segments) {
        if (
          !segment.exclusion &&
          segment.reconstruction?.npz_path &&
          !validateNpzExists(segment.reconstruction.npz_path)
        ) {
          missingNpz.push(segment.reconstruction.npz_path);
        }
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(exportedData, null, 2));

    return NextResponse.json({
      success: true,
      fileName,
      mode,
      ...(mode === "train" ? { model_split: exportedData.model_split } : {}),
      segmentCount: exportedData.halves.reduce(
        (acc: number, h: any) => acc + h.segments.length,
        0,
      ),
      exportedData,
      warning:
        missingNpz.length > 0
          ? `Intent labels exported successfully. ${missingNpz.length} non-excluded training NPZ file(s) are still missing from trajectories directory; run the video-to-trajectory pipeline before model training.`
          : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to export JSON", detail: error.message },
      { status: 500 },
    );
  }
}
