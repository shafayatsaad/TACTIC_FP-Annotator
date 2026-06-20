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
} from "@/lib/constants";

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

function convertToMatchSchema(anns: any[], matchConfig: any, teamConfig: any) {
  const match_id = matchConfig?.match_id || "manual_match";
  const competition = matchConfig?.competition || "england_epl";
  const season = matchConfig?.season || "2024-2015";
  const match_date = matchConfig?.match_date || new Date().toISOString().slice(0, 10);
  const home_team = matchConfig?.home_team || "Team A";
  const away_team = matchConfig?.away_team || "Team B";
  const final_score = matchConfig?.final_score || "0-0";
  const halftime_score = matchConfig?.halftime_score || "0-0";

  // Reconstruct segments
  const segmentsList = anns.map((ann, idx) => {
    const start_sec = Number(ann.segment_metadata?.start_sec ?? ann.video_source?.label_start_sec ?? 0);
    const end_sec = Number(ann.segment_metadata?.end_sec ?? ann.video_source?.label_end_sec ?? 0);
    const duration_sec = Number(ann.segment_metadata?.duration_sec ?? (end_sec - start_sec));
    const coverage_estimate = Number(ann.segment_metadata?.coverage_estimate ?? 1);
    // Dynamic frames based on actual duration and capped at MAX_MODEL_FRAMES
    const rawFrames = computeTensorFrames(duration_sec);
    const tensorFrames = Math.min(rawFrames, MAX_MODEL_FRAMES);
    let tensorShape = [tensorFrames, 23, 4];
    let padding_mask = computePaddingMask(tensorFrames);
    const tensorFps = MODEL_FPS;
    let qualityPass = ann.reconstruction?.quality_pass !== false;

    // Validate trajectory file shape if it exists
    const npzPath = generateNpzPath(match_id, ann.clip_id);
    const fullPath = getNpzFullPath(npzPath);
    if (fullPath) {
      try {
        const safePath = fullPath.replace(/\\/g, "/");
        const cmd = `python -c "import numpy as np; d = np.load('${safePath}'); print(list(d['trajectory'].shape))"`;
        const stdout = execSync(cmd, { encoding: "utf-8" }).trim();
        const actualShape = JSON.parse(stdout);
        if (Array.isArray(actualShape) && actualShape.length === 3) {
          if (actualShape[0] !== tensorShape[0] || actualShape[1] !== 23 || actualShape[2] !== 4) {
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
    const aIsHome = teamConfig?.team_a?.is_home === true || ann.team_a?.is_home === true;
    const teamAObj = ann.team_a || {};
    const teamBObj = ann.team_b || {};

    const team_home = aIsHome ? teamAObj : teamBObj;
    const team_away = aIsHome ? teamBObj : teamAObj;

    const isExclusion = ann.exclusion ? true : false;

    // Intents mapping
    const home_label = isExclusion ? {
      intent_class: null,
      confidence: null,
      certainty: null
    } : {
      intent_class: team_home?.label?.intent_class ?? null,
      confidence: team_home?.label?.confidence ?? 0,
      certainty: team_home?.label?.certainty ?? "low"
    };

    const away_label = isExclusion ? {
      intent_class: null,
      confidence: null,
      certainty: null
    } : {
      intent_class: team_away?.label?.intent_class ?? null,
      confidence: team_away?.label?.confidence ?? 0,
      certainty: team_away?.label?.certainty ?? "low"
    };

    // Formations
    const home_formation = team_home?.formation_estimate || (aIsHome ? "4-2-3-1" : "4-4-2");
    const away_formation = team_away?.formation_estimate || (aIsHome ? "4-4-2" : "4-2-3-1");

    // Phase mixture estimation
    let buildup = 0.25, press = 0.25, block = 0.25, transition = 0.25;
    const combinedIntents = [home_label.intent_class, away_label.intent_class].filter(
      (i): i is string => typeof i === "string"
    );
    if (combinedIntents.some(i => i.includes("BuildUp") || i.includes("PossCirculation"))) {
      buildup = 0.6; press = 0.15; block = 0.15; transition = 0.1;
    } else if (combinedIntents.some(i => i.includes("Press"))) {
      press = 0.6; buildup = 0.15; block = 0.15; transition = 0.1;
    } else if (combinedIntents.some(i => i.includes("Block"))) {
      block = 0.6; press = 0.15; buildup = 0.15; transition = 0.1;
    } else if (combinedIntents.some(i => i.includes("Trans"))) {
      transition = 0.6; buildup = 0.15; press = 0.15; block = 0.1;
    }

    // decisive action mapping
    let decisive_action = null;
    const preEv = ann.segment_metadata?.preceding_event;
    if (preEv === "shot" || preEv === "goal" || preEv === "pass" || preEv === "cross") {
      decisive_action = {
        action_type: preEv === "shot" ? "Shots on target" : preEv === "pass" ? "Pass" : preEv === "cross" ? "Cross" : "Goal",
        position_ms: Math.round((end_sec - start_sec - 1) * 1000),
        team: team_home?.possession ? "home" : "away",
        visibility: "visible",
        tia_delta_ms: 5000
      };
    }

    const assignedSplit = isExclusion ? "excluded" : (ann.model_split?.assigned_split || "train");

    return {
      segment_id: ann.clip_id || `${match_id}_seg${String(idx).padStart(3, "0")}`,
      half: Number(ann.half) || (ann.half === "2nd" ? 2 : 1),
      start_ms: Math.round(start_sec * 1000),
      end_ms: Math.round(end_sec * 1000),
      duration_ms: Math.round(duration_sec * 1000),
      time_from_kickoff_ms: Math.round(start_sec * 1000),
      coverage_estimate: Number((coverage_estimate).toFixed(3)),
      annotator: ann.annotation_meta?.annotator_id || matchConfig?.annotator || "coach_001",
      annotator_license: matchConfig?.annotator_license || "UEFA_Pro",
      session_id: ann.annotation_meta?.session_id || matchConfig?.session_id || "session_042",
      timestamp: ann.annotation_meta?.annotation_timestamp || new Date().toISOString(),
      annotation_duration_sec: Number(ann.annotation_meta?.annotation_duration_sec || 20),
      re_annotation_count: Number(ann.annotation_meta?.re_annotation_count || 0),
      reconstruction: {
        npz_path: generateNpzPath(match_id, ann.clip_id),
        tensor_shape: tensorShape,
        tensor_fps: tensorFps,
        quality_pass: qualityPass,
        tracked_players: Number(ann.reconstruction?.tracked_players || 22),
        tracked_ball: true,
        tracking_confidence_mean: Number(ann.reconstruction?.tracking_confidence_mean || 0.85),
        padding_mask,
      },
      team_home: {
        label: home_label,
        is_primary: home_label.intent_class ? team_home?.is_primary !== false : false,
        possession: isExclusion ? false : team_home?.possession === true,
        formation_estimate: home_formation,
        players_visible: Number(team_home?.players_visible || 11)
      },
      team_away: {
        label: away_label,
        is_primary: away_label.intent_class ? team_away?.is_primary === true : false,
        possession: isExclusion ? false : team_away?.possession === true,
        formation_estimate: away_formation,
        players_visible: Number(team_away?.players_visible || 10)
      },
      exclusion: ann.exclusion || null,
      model_split: assignedSplit,
      dag_features: isExclusion ? null : {
        phase_mixture: [
          Number(buildup.toFixed(2)),
          Number(press.toFixed(2)),
          Number(block.toFixed(2)),
          Number(transition.toFixed(2))
        ],
        formation_compactness: Number((ann.dag_features?.formation_compactness || 0.45).toFixed(2)),
        pressing_speed: Number((ann.dag_features?.pressing_speed || 2.3).toFixed(1)),
        pitch_control_share: team_home?.possession ? 0.6 : 0.4,
        xg_estimate: home_label.intent_class === "DirectAttack" ? 0.3 : 0.05
      },
      ...(decisive_action ? { decisive_action } : {})
    };
  });

  // Split segments into halves
  const h1Segments = segmentsList.filter(s => s.half === 1);
  const h2Segments = segmentsList.filter(s => s.half === 2);

  // Video source detection
  const h1VideoSource = h1Segments[0]?.reconstruction?.npz_path ? path.basename(h1Segments[0].reconstruction.npz_path).replace(/\.[^.]+$/, "") + ".mp4" : `${home_team.toLowerCase()}_${away_team.toLowerCase()}_h1.mp4`;
  const h2VideoSource = h2Segments[0]?.reconstruction?.npz_path ? path.basename(h2Segments[0].reconstruction.npz_path).replace(/\.[^.]+$/, "") + ".mp4" : `${home_team.toLowerCase()}_${away_team.toLowerCase()}_h2.mp4`;

  // Halftime shift calculation
  const getMostFrequentIntent = (segs: any[], team: "home" | "away") => {
    const counts: Record<string, number> = {};
    segs.forEach(s => {
      const intent = team === "home" ? s.team_home?.label?.intent_class : s.team_away?.label?.intent_class;
      if (intent && intent !== "Skipped") {
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

  const home_tactic_shift = h1HomeIntent !== h2HomeIntent && h1HomeIntent !== "None" && h2HomeIntent !== "None" ? `${h1HomeIntent} → ${h2HomeIntent}` : null;
  const away_tactic_shift = h1AwayIntent !== h2AwayIntent && h1AwayIntent !== "None" && h2AwayIntent !== "None" ? `${h1AwayIntent} → ${h2AwayIntent}` : null;

  const setPieceCount = segmentsList.filter(s => s.team_home?.label?.intent_class?.includes("SetPiece") || s.team_away?.label?.intent_class?.includes("SetPiece")).length;
  const contestedPlayCount = segmentsList.filter(s => s.team_home?.label?.intent_class === "ContestedPlay" || s.team_away?.label?.intent_class === "ContestedPlay").length;

  const halves = [];
  if (h1Segments.length > 0 || h2Segments.length === 0) {
    halves.push({
      half: 1,
      video_source: h1VideoSource,
      duration_ms: h1Segments.length > 0 ? Math.max(...h1Segments.map(s => s.end_ms)) : 2700000,
      score_at_end: halftime_score,
      segments: h1Segments
    });
  }
  if (h2Segments.length > 0) {
    halves.push({
      half: 2,
      video_source: h2VideoSource,
      duration_ms: Math.max(...h2Segments.map(s => s.end_ms)),
      score_at_start: halftime_score,
      score_at_end: final_score,
      segments: h2Segments
    });
  }

  // Build halftime change details if shifts exist
  let halftime_tactical_change = null;
  if (home_tactic_shift || away_tactic_shift) {
    halftime_tactical_change = {
      detected: true,
      home_shift: home_tactic_shift || "None",
      away_shift: away_tactic_shift || "None",
      wasserstein_distance: 0.42
    };
  }

  // If halftime tactical change, add details to half 2 first segment
  if (halftime_tactical_change && halves.length > 1 && halves[1].segments.length > 0) {
    (halves[1].segments[0] as any).halftime_tactical_change = halftime_tactical_change;
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
      total_annotation_time_sec: anns.reduce((acc, ann) => acc + Number(ann.annotation_meta?.annotation_duration_sec || 0), 0),
      fleiss_kappa: null,
      inter_annotator_agreement: {
        completed: false,
        pending_reviewers: ["coach_002", "coach_003"]
      },
      halftime_tactical_change_detected: halftime_tactical_change !== null,
      home_team_tactic_shift: home_tactic_shift,
      away_team_tactic_shift: away_tactic_shift,
      camera_quality_score: 0.85,
      tracking_quality_mean: Number((segmentsList.reduce((acc, s) => acc + s.reconstruction.tracking_confidence_mean, 0) / (segmentsList.length || 1)).toFixed(2)),
      set_piece_count: setPieceCount,
      contested_play_count: contestedPlayCount
    }
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const anns = body.annotations || [];
    const matchConfig = body.match_config;
    const teamConfig = body.team_config;
    
    const matchId = matchConfig?.match_id || "unknown";
    const fileName = `TACTIC_FP_Annotated_${matchId}.json`;
    const filePath = path.join(getExportsDir(), fileName);

    const exportedData = convertToMatchSchema(anns, matchConfig, teamConfig);

    // Validate that NPZ files exist for all samples (collect warnings but don't block export)
    const missingNpz: string[] = [];
    for (const half of exportedData.halves) {
      for (const segment of half.segments) {
        if (!validateNpzExists(segment.reconstruction.npz_path)) {
          missingNpz.push(segment.reconstruction.npz_path);
        }
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(exportedData, null, 2));

    return NextResponse.json({
      success: true,
      fileName,
      segmentCount: anns.length,
      warning: missingNpz.length > 0 ? `Exported successfully, but ${missingNpz.length} NPZ file(s) are missing from trajectories directory.` : null
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to export JSON", detail: error.message },
      { status: 500 },
    );
  }
}
