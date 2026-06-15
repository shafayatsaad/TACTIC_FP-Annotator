import { NextResponse } from "next/server";
import { deleteAnnotation } from "@/lib/server-utils";

export async function POST(request: Request) {
  try {
    const { clip_id } = await request.json();
    if (!clip_id) {
      return NextResponse.json(
        { error: "clip_id is required" },
        { status: 400 },
      );
    }
    deleteAnnotation(clip_id);
    return NextResponse.json({ success: true, deleted: clip_id });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to delete annotation", detail: error.message },
      { status: 500 },
    );
  }
}
