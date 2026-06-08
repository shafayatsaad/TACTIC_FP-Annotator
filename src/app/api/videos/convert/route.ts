import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getVideosDir } from "@/lib/server-utils";

function runFfmpeg(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";
    ffmpeg.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    ffmpeg.on("close", (code: number | null) => resolve({ code, stderr }));
    ffmpeg.on("error", reject);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    const sourceName = body.source;
    if (!sourceName) return NextResponse.json({ error: "No source filename provided" }, { status: 400 });

    const videosDir = getVideosDir();
    const sourcePath = path.join(videosDir, sourceName);
    if (!fs.existsSync(sourcePath)) return NextResponse.json({ error: "Source video not found" }, { status: 404 });

    const ext = path.extname(sourceName);
    const baseName = path.basename(sourceName, ext);
    const mp4Name = `${baseName}_720p.mp4`;
    const mp4Path = path.join(videosDir, mp4Name);

    if (fs.existsSync(mp4Path)) return NextResponse.json({ success: true, filename: mp4Name, message: "MP4 already exists" });

    try {
      const remux = await runFfmpeg(["-i", sourcePath, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", "-y", mp4Path]);
      if (remux.code === 0) return NextResponse.json({ success: true, filename: mp4Name, message: "Remuxed to browser-ready MP4" });

      const transcode = await runFfmpeg(["-i", sourcePath, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease", "-y", mp4Path]);
      if (transcode.code === 0) return NextResponse.json({ success: true, filename: mp4Name, message: "Converted to browser-ready MP4" });
      return NextResponse.json({ error: "ffmpeg conversion failed", detail: transcode.stderr.slice(-800) || remux.stderr.slice(-800) }, { status: 500 });
    } catch {
      return NextResponse.json({ error: "ffmpeg not found" }, { status: 500 });
    }
  } catch (error: any) { return NextResponse.json({ error: "Conversion failed", detail: error.message }, { status: 500 }); }
}
