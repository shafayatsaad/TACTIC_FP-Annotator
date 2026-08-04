import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import fs from "fs";
import { getVideosDir, resolveInsideDir } from "@/lib/server-utils";

// GET /api/videos/metadata?path=raw_videos/match.mp4
// Returns { durationSec, width, height, fps } for any video in raw_videos/.
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const relativePath = request.nextUrl.searchParams.get("path");
    if (!relativePath)
      return NextResponse.json({ error: "No path provided" }, { status: 400 });

    const videosDir = getVideosDir();
    // Strip leading "raw_videos/" if the client sends the full path
    const filename = relativePath.replace(/^raw_videos\//i, "");
    const videoPath = resolveInsideDir(videosDir, filename);
    if (!videoPath)
      return NextResponse.json({ error: "Invalid video path" }, { status: 400 });

    if (!fs.existsSync(videoPath))
      return NextResponse.json({ error: "Video not found" }, { status: 404 });

    const out = execFileSync(
      "ffprobe",
      [
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-show_format",
        videoPath,
      ],
      { timeout: 15_000 },
    ).toString();

    const data = JSON.parse(out);
    const durationSec = parseFloat(data?.format?.duration ?? "0") || 0;
    const videoStream = (data?.streams ?? []).find(
      (s: any) => s.codec_type === "video",
    );
    const width: number = videoStream?.width ?? 0;
    const height: number = videoStream?.height ?? 0;
    const fpsRaw: string = videoStream?.r_frame_rate ?? "25/1";
    const [num, den] = fpsRaw.split("/").map(Number);
    const fps = den > 0 ? num / den : 25;

    return NextResponse.json({ durationSec, width, height, fps });
  } catch (err: any) {
    // ffprobe not installed or video unreadable — return a non-fatal 200
    // so the caller can fall back to the <video>.duration event gracefully.
    return NextResponse.json(
      { durationSec: 0, error: err.message },
      { status: 200 },
    );
  }
}
