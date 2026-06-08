import { NextRequest, NextResponse } from "next/server";
import { readSegments, writeSegments, deleteSegment } from "@/lib/server-utils";

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
    writeSegments(body.segments || []);
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
