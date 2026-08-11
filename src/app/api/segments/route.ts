import { NextRequest, NextResponse } from "next/server";
import { readSegments, writeSegments, deleteSegment } from "@/lib/server-utils";
import {
  MAX_SEGMENT_DURATION,
  isExclusionIntent,
  sanitizeMatchId,
  generateNpzPath,
  MODEL_FPS,
  MAX_MODEL_FRAMES,
  computePaddingMask,
} from "@/lib/constants";

function finiteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function segmentDuration(segment: any): number {
  return (
    Number(segment.annotation_end ?? segment.end) -
    Number(segment.annotation_start ?? segment.start)
  );
}

function coverageEstimate(segment: any): number {
  const direct = finiteNumber(segment.segment_metadata?.coverage_estimate);
  if (direct !== null) return direct > 1 ? direct / 100 : direct;
  const teamA = finiteNumber(segment.tracking_coverage?.team_a_avg);
  const teamB = finiteNumber(segment.tracking_coverage?.team_b_avg);
  if (teamA !== null || teamB !== null) {
    return Math.min(1, Math.max(0, ((teamA ?? 0) + (teamB ?? 0)) / 22));
  }
  return 1;
}

function validateSegment(
  segment: any,
  existingSegments: any[] = readSegments(),
): { error: string; detail: string; status?: number } | null {
  if (!segment || typeof segment !== "object") {
    return { error: "Invalid segment", detail: "Segment must be an object" };
  }
  if (typeof segment.clip_id !== "string" || segment.clip_id.length === 0) {
    return { error: "Missing clip_id", detail: "Segment clip_id is required" };
  }
  const start = finiteNumber(segment.annotation_start ?? segment.start);
  const end = finiteNumber(segment.annotation_end ?? segment.end);
  if (start === null || end === null) {
    return { error: "Invalid timing", detail: "Segment start/end must be finite numbers" };
  }
  if (start < 0) {
    return { error: "Invalid start", detail: "Segment start cannot be negative" };
  }
  const duration = end - start;
  if (duration <= 0) {
    return { error: "Invalid duration", detail: "End time must be after start time" };
  }
  if (duration < 2.0) {
    return { error: "Segment too short", detail: `Duration ${duration.toFixed(2)}s < 2.0s minimum` };
  }
  if (duration - MAX_SEGMENT_DURATION > 1e-6) {
    return {
      error: "Segment too long",
      detail: `Duration ${duration.toFixed(3)}s exceeds ${MAX_SEGMENT_DURATION}s maximum`,
    };
  }

  const teamAIntent = segment.team_a?.label?.intent_class ?? null;
  const teamBIntent = segment.team_b?.label?.intent_class ?? null;
  const exclusion = segment.exclusion ?? null;

  const hasExclusionIntent = isExclusionIntent(teamAIntent || "") || isExclusionIntent(teamBIntent || "");
  
  if (hasExclusionIntent) {
    if (teamAIntent !== teamBIntent) {
      return { error: "Exclusion inconsistency", detail: "Both teams must have the same exclusion intent" };
    }
  }
  
  if (exclusion) {
    if (!isExclusionIntent(exclusion)) {
      return { error: "Invalid exclusion", detail: `Exclusion '${exclusion}' is not a valid exclusion intent` };
    }
    if ((teamAIntent && !isExclusionIntent(teamAIntent)) || (teamBIntent && !isExclusionIntent(teamBIntent))) {
      return { error: "Mixed exclusion", detail: "Exclusion intents cannot coexist with tactical intents" };
    }
  }

  const coverage = coverageEstimate(segment);
  if (coverage < 0.80) {
    return { error: "Coverage too low", detail: `${coverage} < 0.80 minimum` };
  }

  // --- NPZ path uniqueness gate ---
  const npzPath = segment.reconstruction?.npz_path || generateNpzPath(segment.match_id || "unknown", segment.clip_id);
  const pathExists = existingSegments.some((s: any) =>
    s.clip_id !== segment.clip_id &&
    (s.reconstruction?.npz_path || generateNpzPath(s.match_id || "unknown", s.clip_id)) === npzPath
  );
  if (pathExists) {
    return { error: "Duplicate NPZ path", detail: `${npzPath} already exists. Regenerate segment.`, status: 409 };
  }

  return null;
}

function validateSegmentCollection(segments: any[]): { error: string; detail: string; status?: number } | null {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [index, segment] of segments.entries()) {
    if (!segment || typeof segment !== "object") {
      return { error: "Invalid segment", detail: `segments[${index}] must be an object` };
    }
    if (typeof segment.clip_id !== "string" || segment.clip_id.length === 0) {
      return { error: "Missing clip_id", detail: `segments[${index}] clip_id is required` };
    }
    const start = finiteNumber(segment.annotation_start ?? segment.start);
    const end = finiteNumber(segment.annotation_end ?? segment.end);
    if (start === null || end === null) {
      return { error: "Invalid timing", detail: `${segment.clip_id} start/end must be finite numbers` };
    }
  }

  const sorted = [...segments].sort((a, b) => {
    const halfA = Number(a.half ?? 1);
    const halfB = Number(b.half ?? 1);
    if (halfA !== halfB) return halfA - halfB;
    return Number(a.annotation_start ?? a.start ?? 0) - Number(b.annotation_start ?? b.start ?? 0);
  });

  for (const segment of sorted) {
    if (ids.has(segment.clip_id)) {
      return { error: "Duplicate clip_id", detail: `Duplicate segment id: ${segment.clip_id}`, status: 409 };
    }
    ids.add(segment.clip_id);
    const npzPath = segment.reconstruction?.npz_path || generateNpzPath(segment.match_id || "unknown", segment.clip_id);
    if (paths.has(npzPath)) {
      return { error: "Duplicate NPZ path", detail: `Duplicate trajectory path: ${npzPath}`, status: 409 };
    }
    paths.add(npzPath);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (Number(current.half ?? 1) !== Number(next.half ?? 1)) continue;
    const currentEnd = Number(current.annotation_end ?? current.end);
    const nextStart = Number(next.annotation_start ?? next.start);
    if (currentEnd - nextStart > 1e-6) {
      return {
        error: "Segment overlap",
        detail: `${current.clip_id} overlaps ${next.clip_id} by ${(currentEnd - nextStart).toFixed(3)}s`,
      };
    }
  }

  return null;
}

export async function GET() {
  try {
    const segments = readSegments();
    return NextResponse.json({ segments });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to load segments", detail: error.message },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.clip_id) {
      // Save single segment
      const segments = readSegments();
      const err = validateSegment(body, segments);
      if (err) {
        return NextResponse.json({ error: err.error, detail: err.detail }, { status: err.status || 400 });
      }

      const duration = segmentDuration(body);
      const expectedFrames = Math.round(duration * MODEL_FPS);

      body.reconstruction = {
        ...body.reconstruction,
        npz_path: body.reconstruction?.npz_path || generateNpzPath(body.match_id || "unknown", body.clip_id),
        tensor_shape: body.reconstruction?.tensor_shape || [expectedFrames, 23, 4],
        tensor_fps: body.reconstruction?.tensor_fps || MODEL_FPS,
        padding_mask: body.reconstruction?.padding_mask || computePaddingMask(expectedFrames),
      };

      const existing = segments.findIndex(
        (s: any) => s.clip_id === body.clip_id,
      );
      if (existing >= 0) {
        segments[existing] = body;
      } else {
        segments.push(body);
      }
      const collectionErr = validateSegmentCollection(segments);
      if (collectionErr) {
        return NextResponse.json(
          { error: collectionErr.error, detail: collectionErr.detail },
          { status: collectionErr.status || 400 },
        );
      }
      writeSegments(segments);
      return NextResponse.json({ success: true });
    }
    // Save all segments
    const bulkSegments = body.segments || [];
    if (!Array.isArray(bulkSegments)) {
      return NextResponse.json({ error: "Invalid segments", detail: "segments must be an array" }, { status: 400 });
    }
    const collectionErr = validateSegmentCollection(bulkSegments);
    if (collectionErr) {
      return NextResponse.json(
        { error: collectionErr.error, detail: collectionErr.detail },
        { status: collectionErr.status || 400 },
      );
    }
    const processedSegments = [];
    for (const segment of bulkSegments) {
      const err = validateSegment(segment, bulkSegments);
      if (err) {
        return NextResponse.json({ error: err.error, detail: err.detail }, { status: err.status || 400 });
      }

      const duration = segmentDuration(segment);
      const expectedFrames = Math.min(Math.round(duration * MODEL_FPS), MAX_MODEL_FRAMES);

      const updatedSegment = {
        ...segment,
        reconstruction: {
          ...segment.reconstruction,
          npz_path: segment.reconstruction?.npz_path || generateNpzPath(segment.match_id || "unknown", segment.clip_id),
          tensor_shape: segment.reconstruction?.tensor_shape || [expectedFrames, 23, 4],
          tensor_fps: segment.reconstruction?.tensor_fps || MODEL_FPS,
          padding_mask: segment.reconstruction?.padding_mask || computePaddingMask(expectedFrames),
        }
      };
      processedSegments.push(updatedSegment);
    }
    writeSegments(processedSegments);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to save segments", detail: error.message },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.clip_id) {
      deleteSegment(body.clip_id);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "clip_id required" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to delete segment", detail: error.message },
      { status: 500 },
    );
  }
}
