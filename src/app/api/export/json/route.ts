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
        // Insert exclusion segment
        const gapDurationMs = gapMs;
        const gapDurationSec = gapDurationMs / 1000;
        const rawFrames = computeTensorFrames(gapDurationSec);
        const tensorFrames = Math.min(rawFrames, MAX_MODEL_FRAMES);
        const gapSegId = `gap_fill_${half}_${current.end_ms}`;
        result.push({
          segment_id: gapSegId,
          half,
          start_ms: current.end_ms,
          end_ms: next.start_ms,
          duration_ms: gapDurationMs,
          time_from_kickoff_ms: current.end_ms,
          coverage_estimate: 0,
          exclusion: "ContestedPlay",
          model_split: "excluded",
          reconstruction: {
            npz_path: "",
            tensor_shape: [tensorFrames, 23, 4],
            tensor_fps: MODEL_FPS,
            quality_pass: false,
            tracked_players: 0,
            tracked_ball: false,
            tracking_confidence_mean: 0,
            padding_mask: computePaddingMask(tensorFrames),
          },
        });
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
  const sortedAnns = [...anns].sort((a, b) => {
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

  // Reconstruct segments with temporal linking
  const segmentsList = sortedAnns.map((ann, idx, arr) => {
    const prevSeg = idx > 0 ? arr[idx - 1] : null;
    const nextSeg = idx < arr.length - 1 ? arr[idx + 1] : null;
    const start_sec = Number(
      ann.segment_metadata?.start_sec ?? ann.video_source?.label_start_sec ?? 0,
    );
    const end_sec = Number(
      ann.segment_metadata?.end_sec ?? ann.video_source?.label_end_sec ?? 0,
    );
    const duration_sec = Number(
      ann.segment_metadata?.duration_sec ?? end_sec - start_sec,
    );
    const coverage_estimate = Number(
      ann.segment_metadata?.coverage_estimate ?? 1,
    );
    // Dynamic frames based on actual duration and capped at MAX_MODEL_FRAMES
    const rawFrames = computeTensorFrames(duration_sec);
    const tensorFrames = Math.min(rawFrames, MAX_MODEL_FRAMES);
    let tensorShape = [tensorFrames, 23, 4];
    let padding_mask = computePaddingMask(tensorFrames);
    const tensorFps = MODEL_FPS;
    let qualityPass = ann.reconstruction?.quality_pass !== false;

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
            qualityPass = false;
            tensorShape = [actualShape[0], actualShape[1], actualShape[2]];
            padding_mask = computePaddingMask(actualShape[0]);
          }
        }
      } catch (error) {
        console.error(`Failed to validate NPZ shape for ${fullPath}:`, error);
        qualityPass = false;
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

    // Intents mapping
    const home_label = isExclusion
      ? {
          intent_class: null,
          confidence: null,
          certainty: null,
        }
      : {
          intent_class: team_home?.label?.intent_class ?? null,
          confidence: team_home?.label?.confidence ?? 0,
          certainty: team_home?.label?.certainty ?? "low",
        };

    const away_label = isExclusion
      ? {
          intent_class: null,
          confidence: null,
          certainty: null,
        }
      : {
          intent_class: team_away?.label?.intent_class ?? null,
          confidence: team_away?.label?.confidence ?? 0,
          certainty: team_away?.label?.certainty ?? "low",
        };

    // Formations
    const home_formation =
      team_home?.formation_estimate || (aIsHome ? "4-2-3-1" : "4-4-2");
    const away_formation =
      team_away?.formation_estimate || (aIsHome ? "4-4-2" : "4-2-3-1");

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

    const prevSegId = prevSeg
      ? prevSeg.clip_id || `${match_id}_seg${String(idx - 1).padStart(3, "0")}`
      : null;
    const nextSegId = nextSeg
      ? nextSeg.clip_id || `${match_id}_seg${String(idx + 1).padStart(3, "0")}`
      : null;

    return {
      segment_id:
        ann.clip_id || `${match_id}_seg${String(idx).padStart(3, "0")}`,
      previous_segment: prevSegId,
      next_segment: nextSegId,
      half: Number(ann.half) || (ann.half === "2nd" ? 2 : 1),
      start_ms: Math.round(start_sec * 1000),
      end_ms: Math.round(end_sec * 1000),
      duration_ms: Math.round(duration_sec * 1000),
      time_from_kickoff_ms: Math.round(start_sec * 1000),
      coverage_estimate: Number(coverage_estimate.toFixed(3)),
      annotator:
        ann.annotation_meta?.annotator_id ||
        matchConfig?.annotator ||
        "coach_001",
      annotator_license: matchConfig?.annotator_license || "UEFA_Pro",
      session_id:
        ann.annotation_meta?.session_id ||
        matchConfig?.session_id ||
        "session_042",
      timestamp:
        ann.annotation_meta?.annotation_timestamp || new Date().toISOString(),
      annotation_duration_sec: Number(
        ann.annotation_meta?.annotation_duration_sec || 20,
      ),
      re_annotation_count: Number(
        ann.annotation_meta?.re_annotation_count || 0,
      ),
      reconstruction: {
        npz_path: generateNpzPath(match_id, ann.clip_id),
        tensor_shape: tensorShape,
        tensor_fps: tensorFps,
        quality_pass: qualityPass,
        tracked_players: Number(ann.reconstruction?.tracked_players || 22),
        tracked_ball: true,
        tracking_confidence_mean: Number(
          ann.reconstruction?.tracking_confidence_mean || 0.85,
        ),
        padding_mask,
      },
      team_home: {
        label: home_label,
        is_primary: home_label.intent_class
          ? team_home?.is_primary !== false
          : false,
        possession: isExclusion ? false : team_home?.possession === true,
        formation_estimate: home_formation,
        players_visible: Number(team_home?.players_visible || 11),
      },
      team_away: {
        label: away_label,
        is_primary: away_label.intent_class
          ? team_away?.is_primary === true
          : false,
        possession: isExclusion ? false : team_away?.possession === true,
        formation_estimate: away_formation,
        players_visible: Number(team_away?.players_visible || 10),
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

  // Halftime shift calculation
  const getMostFrequentIntent = (segs: any[], team: "home" | "away") => {
    const counts: Record<string, number> = {};
    segs.forEach((s) => {
      const intent =
        team === "home"
          ? s.team_home?.label?.intent_class
          : s.team_away?.label?.intent_class;
      // Filter out null, "Skipped" (legacy), and empty intent values
      if (intent && intent !== "Skipped" && intent !== "None") {
        counts[intent] = (counts[intent] || 0) + 1;
      }
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? sorted[0][0] : "None";
  };

  const h1HomeIntent = getMostFrequentIntent(h1Segments, "home");
  const h1AwayIntent = getMostFrequentIntent(h1Segments, "away");
  const h2HomeIntent = getMostFrequentIntent(h2Segments, "home");
  const h2AwayIntent = getMostFrequentIntent(h2Segments, "away");

  const home_tactic_shift =
    h1HomeIntent !== h2HomeIntent &&
    h1HomeIntent !== "None" &&
    h2HomeIntent !== "None"
      ? `${h1HomeIntent} → ${h2HomeIntent}`
      : null;
  const away_tactic_shift =
    h1AwayIntent !== h2AwayIntent &&
    h1AwayIntent !== "None" &&
    h2AwayIntent !== "None"
      ? `${h1AwayIntent} → ${h2AwayIntent}`
      : null;

  const setPieceCount = segmentsList.filter(
    (s) =>
      s.team_home?.label?.intent_class?.includes("SetPiece") ||
      s.team_away?.label?.intent_class?.includes("SetPiece"),
  ).length;
  const contestedPlayCount = segmentsList.filter(
    (s) =>
      s.team_home?.label?.intent_class === "ContestedPlay" ||
      s.team_away?.label?.intent_class === "ContestedPlay",
  ).length;

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

  // Build halftime change details if shifts exist
  let halftime_tactical_change = null;
  if (home_tactic_shift || away_tactic_shift) {
    halftime_tactical_change = {
      detected: true,
      home_shift: home_tactic_shift || "None",
      away_shift: away_tactic_shift || "None",
    };
  }

  // If halftime tactical change, add details to half 2 first segment
  if (
    halftime_tactical_change &&
    halves.length > 1 &&
    halves[1].segments.length > 0
  ) {
    (halves[1].segments[0] as any).halftime_tactical_change =
      halftime_tactical_change;
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
    match_metadata: {
      total_segments: segmentsList.length,
      half1_segments: h1Segments.length,
      half2_segments: h2Segments.length,
      annotators: [matchConfig?.annotator || "coach_001"],
      annotation_sessions: [matchConfig?.session_id || "session_042"],
      total_annotation_time_sec: anns.reduce(
        (acc, ann) =>
          acc + Number(ann.annotation_meta?.annotation_duration_sec || 0),
        0,
      ),
      fleiss_kappa: null,
      inter_annotator_agreement: {
        completed: false,
        pending_reviewers: ["coach_002", "coach_003"],
      },
      halftime_tactical_change_detected: halftime_tactical_change !== null,
      home_team_tactic_shift: home_tactic_shift,
      away_team_tactic_shift: away_tactic_shift,
      tracking_quality_mean: Number(
        (
          segmentsList.reduce(
            (acc, s) => acc + s.reconstruction.tracking_confidence_mean,
            0,
          ) / (segmentsList.length || 1)
        ).toFixed(2),
      ),
      set_piece_count: setPieceCount,
      contested_play_count: contestedPlayCount,
    },
  };
}

/**
 * Convert the full annotator schema to the training schema.
 * This prunes all non-essential metadata, quantizes timestamps,
 * removes orphaned parent segments, fills gaps, and keeps only
 * the primary team block.
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
      // Quantize timestamps to 100ms grid
      const startMs = quantizeMs(seg.start_ms);
      const endMs = quantizeMs(seg.end_ms);

      // Determine tensor frames from the reconstruction block
      const tensorFrames = seg.reconstruction?.tensor_shape?.[0] || 0;

      // Duration is derived from tensor shape: tensor_shape[0] × 100
      const durationMs = tensorFrames * 100;

      // Recompute end_ms from start_ms + duration_ms
      const alignedEndMs = startMs + durationMs;

      // Validate padding mask: must be exactly 150 elements,
      // with tensorFrames leading 1s and the rest 0s
      let paddingMask = seg.reconstruction?.padding_mask;
      if (!paddingMask || paddingMask.length !== MAX_MODEL_FRAMES) {
        paddingMask = computePaddingMask(tensorFrames);
      } else {
        // Ensure the mask matches the tensor shape
        const onesCount = paddingMask.filter((v: number) => v === 1).length;
        if (onesCount !== tensorFrames) {
          paddingMask = computePaddingMask(tensorFrames);
        }
      }

      // Determine primary team (the one with is_primary: true)
      const teamHome = seg.team_home || {};
      const teamAway = seg.team_away || {};
      const primaryTeam = teamHome.is_primary ? teamHome : teamAway;
      const hasPrimary = teamHome.is_primary || teamAway.is_primary;

      // Build the training segment — only essential fields
      const trainSeg: any = {
        segment_id: seg.segment_id,
        half: seg.half,
        start_ms: startMs,
        end_ms: alignedEndMs,
        duration_ms: durationMs,
        time_from_kickoff_ms: startMs,
        coverage_estimate: seg.coverage_estimate,
        exclusion: seg.exclusion || null,
        model_split: seg.model_split || "train",
        reconstruction: {
          npz_path: seg.reconstruction?.npz_path || "",
          tensor_shape: seg.reconstruction?.tensor_shape || [
            tensorFrames,
            23,
            4,
          ],
          tensor_fps: seg.reconstruction?.tensor_fps || MODEL_FPS,
          padding_mask: paddingMask,
        },
      };

      // Only include the primary team block if one exists and it's not an exclusion
      if (!seg.exclusion && hasPrimary) {
        trainSeg.team = {
          intent_class: primaryTeam.label?.intent_class ?? null,
          confidence: primaryTeam.label?.confidence ?? 0,
          is_primary: true,
          possession: primaryTeam.possession === true,
        };
      }

      return trainSeg;
    });

    // Recompute half duration_ms from the last segment's end_ms
    const halfDurationMs =
      trainSegments.length > 0
        ? trainSegments[trainSegments.length - 1].end_ms
        : half.duration_ms || 2700000;

    return {
      half: half.half,
      duration_ms: halfDurationMs,
      segments: trainSegments,
    };
  });

  return {
    match_id: fullData.match_id,
    halves: trainHalves,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const anns = body.annotations || [];
    const matchConfig = body.match_config;
    const teamConfig = body.team_config;

    // Determine export mode from query parameter
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "annotator";

    const matchId = matchConfig?.match_id || "unknown";
    const modeSuffix = mode === "train" ? "_TRAIN" : "";
    const fileName = `TACTIC_FP_Annotated_${matchId}${modeSuffix}.json`;
    const filePath = path.join(getExportsDir(), fileName);

    const fullData = convertToMatchSchema(anns, matchConfig, teamConfig);

    let exportedData: any;
    if (mode === "train") {
      exportedData = convertToTrainSchema(fullData);
    } else {
      exportedData = fullData;
    }

    // Validate that NPZ files exist for all samples (collect warnings but don't block export)
    const missingNpz: string[] = [];
    for (const half of exportedData.halves) {
      for (const segment of half.segments) {
        if (
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
      segmentCount: exportedData.halves.reduce(
        (acc: number, h: any) => acc + h.segments.length,
        0,
      ),
      warning:
        missingNpz.length > 0
          ? `Exported successfully, but ${missingNpz.length} NPZ file(s) are missing from trajectories directory.`
          : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to export JSON", detail: error.message },
      { status: 500 },
    );
  }
}
