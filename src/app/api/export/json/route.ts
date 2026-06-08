import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getExportsDir } from "@/lib/server-utils";

function modelCertainty(confidence: number): "low" | "medium" | "high" {
  if (confidence <= 2) return "low";
  if (confidence === 3) return "medium";
  return "high";
}

// Padding mask: first `tensor_frames` entries are 1 (real), rest are 0 (padded).
// The model uses this to ignore padded frames during training.
// tensor_frames = tensor_shape[0], which is the actual number of frames.
function makePaddingMask(tensorFrames: number): number[] {
  const realFrames = Math.max(0, Math.min(tensorFrames, 150));
  return Array.from({ length: 150 }, (_, i) => (i < realFrames ? 1 : 0));
}

function validateNpzExists(npzPath: string): boolean {
  const fullPath = path.join(process.cwd(), "public", npzPath);
  if (fs.existsSync(fullPath)) return true;
  // also check relative to cwd directly
  const altPath = path.join(process.cwd(), npzPath);
  return fs.existsSync(altPath);
}

function toModelSamples(annotations: any[]) {
  return annotations.map((ann) => {
    // Always use reconstruction.tensor_shape[0] as the primary source for
    // the number of actual frames. This is set by the pipeline that generates
    // the NPZ file and is the single source of truth.
    const tensorShape = ann.reconstruction?.tensor_shape;
    const tensorFrames = tensorShape?.[0] ?? 150;
    const tensorFps =
      ann.reconstruction?.tensor_fps || ann.video_source?.tensor_fps || 10;

    const start_sec = Number(
      ann.segment_metadata?.start_sec ??
        ann.video_source?.label_start_sec ??
        ann.video_source?.seek_start_sec ??
        0,
    );
    const end_sec = Number(
      ann.segment_metadata?.end_sec ??
        ann.video_source?.label_end_sec ??
        ann.video_source?.seek_end_sec ??
        0,
    );
    const duration_sec = Number(
      ann.segment_metadata?.duration_sec ??
        (ann.video_source?.label_end_sec ?? 0) -
          (ann.video_source?.label_start_sec ?? 0),
    );
    const coverage_estimate = Number(
      ann.segment_metadata?.coverage_estimate ?? 1,
    );

    // Build deterministic npz path from clip metadata so export never has empty path.
    const matchId = ann.match_id || "unknown";
    const segmentId = ann.segment_id || ann.clip_id || "unknown";
    const npzPath =
      ann.reconstruction?.npz_path ||
      `data/trajectories/${matchId}/${segmentId}.npz`;

    const common = {
      segment_id: segmentId,
      match_id: matchId,
      half: ann.half || ann.game_state?.half || "1st",
      start_sec,
      end_sec,
      duration_sec,
      coverage_estimate,
      reconstruction: {
        npz_path: npzPath,
        tensor_shape: tensorShape || [tensorFrames, 23, 4],
        tensor_fps: tensorFps,
        quality_pass: ann.reconstruction?.quality_pass === true,
        tracked_players: ann.reconstruction?.tracked_players || 22,
        padding_mask: makePaddingMask(tensorFrames),
      },
    };

    if (ann.exclusion) {
      return {
        ...common,
        exclusion: ann.exclusion,
        model_split: ann.model_split?.assigned_split || "train",
      };
    }

    const confidenceA = ann.team_a?.label?.confidence || 3;
    const confidenceB = ann.team_b?.label?.confidence || 3;
    return {
      ...common,
      team_a: {
        label: {
          intent_class: ann.team_a?.label?.intent_class ?? null,
          confidence: confidenceA,
          certainty:
            ann.team_a?.label?.certainty || modelCertainty(confidenceA),
        },
        is_primary: ann.team_a?.is_primary === true,
        possession: ann.team_a?.possession === true,
      },
      team_b: {
        label: {
          intent_class: ann.team_b?.label?.intent_class ?? null,
          confidence: confidenceB,
          certainty:
            ann.team_b?.label?.certainty || modelCertainty(confidenceB),
        },
        is_primary: ann.team_b?.is_primary === true,
        possession: ann.team_b?.possession === true,
      },
      exclusion: null,
      model_split: ann.model_split?.assigned_split || "train",
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const anns = body.annotations || [];
    const matchId =
      body.match_id ||
      (anns.length > 0 ? anns[0].match_id || "unknown" : "unknown");
    const fileName = `TACTIC_FP_Annotated_${matchId}.json`;
    const filePath = path.join(getExportsDir(), fileName);

    const samples = toModelSamples(anns);

    // Validate that NPZ files exist for all samples
    const missingNpz: string[] = [];
    for (const sample of samples) {
      if (!validateNpzExists(sample.reconstruction.npz_path)) {
        missingNpz.push(sample.reconstruction.npz_path);
      }
    }
    if (missingNpz.length > 0) {
      return NextResponse.json(
        {
          error: `Missing NPZ files for ${missingNpz.length} segment(s). Generate trajectories first.`,
          detail: `Missing: ${missingNpz.slice(0, 5).join(", ")}${missingNpz.length > 5 ? ` ... and ${missingNpz.length - 5} more` : ""}`,
        },
        { status: 400 },
      );
    }

    fs.writeFileSync(filePath, JSON.stringify(samples, null, 2));

    return NextResponse.json({
      success: true,
      fileName,
      segmentCount: samples.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to export JSON", detail: error.message },
      { status: 500 },
    );
  }
}
