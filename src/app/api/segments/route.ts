import { NextRequest, NextResponse } from "next/server";
import { readSegments, writeSegments, deleteSegment } from "@/lib/server-utils";
import { MAX_SEGMENT_DURATION, isExclusionIntent, generateNpzPath } from "@/lib/constants";

function validateSegment(segment: any): { error: string; detail: string; status?: number } | null {
  const duration = (segment.annotation_end ?? segment.end) - (segment.annotation_start ?? segment.start);
  if (duration < 2.0) {
    return { error: "Segment too short", detail: `Duration ${duration.toFixed(2)}s < 2.0s minimum` };
  }
  if (duration > MAX_SEGMENT_DURATION) {
    return { error: "Segment too long", detail: `Duration ${duration.toFixed(2)}s > ${MAX_SEGMENT_DURATION}s maximum` };
  }
  if (duration <= 0) {
    return { error: "Invalid duration", detail: "End time must be after start time" };
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

  const coverage = segment.segment_metadata?.coverage_estimate ?? segment.tracking_coverage?.team_a_avg ?? 1.0;
  if (coverage < 0.80) {
    return { error: "Coverage too low", detail: `${coverage} < 0.80 minimum` };
  }

  // --- NPZ path uniqueness gate ---
  const npzPath = segment.reconstruction?.npz_path || generateNpzPath(segment.match_id || "unknown", segment.clip_id);
  const segments = readSegments();
  const pathExists = segments.some((s: any) => 
    s.clip_id !== segment.clip_id &&
    (s.reconstruction?.npz_path || generateNpzPath(s.match_id || "unknown", s.clip_id)) === npzPath
  );
  if (pathExists) {
    return { error: "Duplicate NPZ path", detail: `${npzPath} already exists. Regenerate segment.`, status: 409 };
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
      const err = validateSegment(body);
      if (err) {
        return NextResponse.json({ error: err.error, detail: err.detail }, { status: err.status || 400 });
      }
      const segments = readSegments();
      const existing = segments.findIndex(
        (s: any) => s.clip_id === body.clip_id,
      );
      if (existing >= 0) {
        segments[existing] = body;
      } else {
        segments.push(body);
      }
      writeSegments(segments);
      return NextResponse.json({ success: true });
    }
    // Save all segments
    const bulkSegments = body.segments || [];
    for (const segment of bulkSegments) {
      const err = validateSegment(segment);
      if (err) {
        return NextResponse.json({ error: err.error, detail: err.detail }, { status: err.status || 400 });
      }
    }
    writeSegments(bulkSegments);
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
