import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getVideosDir, resolveInsideDir, sanitizeFileStem } from "@/lib/server-utils";

// ─── In-memory job registry ───────────────────────────────────────────────────
// Keyed by jobId (UUID-style timestamp string). Each entry tracks the
// ffmpeg process + accumulated progress output so the client can poll.
type JobState =
  | { status: "running"; progress: number; log: string }
  | { status: "done"; filename: string; message: string }
  | { status: "error"; error: string; detail: string };

const jobs = new Map<string, JobState>();

function makeJobId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Parse ffmpeg progress lines like "frame=... time=00:01:23.45 ..." into a 0–100 value.
function parseProgress(line: string, totalSec: number): number | null {
  if (totalSec <= 0) return null;
  const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) return null;
  const elapsed = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Math.min(99, Math.round((elapsed / totalSec) * 100));
}

// Probe video duration via ffprobe (synchronous, fast – just reads container header)
function probeDuration(videoPath: string): number {
  try {
    const { execFileSync } = require("child_process") as typeof import("child_process");
    const out = execFileSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", videoPath],
      { timeout: 10_000 },
    ).toString();
    const data = JSON.parse(out);
    return parseFloat(data?.format?.duration ?? "0") || 0;
  } catch {
    return 0;
  }
}

function spawnFfmpeg(args: string[]): ReturnType<typeof spawn> {
  return spawn("ffmpeg", args);
}

// ─── POST /api/videos/convert ─────────────────────────────────────────────────
// Body: { source: "match_02.mkv" }
// Returns immediately with { jobId } so the client can poll /status/[jobId].
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    const sourceName: string = body.source;
    if (!sourceName)
      return NextResponse.json({ error: "No source filename provided" }, { status: 400 });
    if (typeof sourceName !== "string")
      return NextResponse.json({ error: "Invalid source filename" }, { status: 400 });

    const videosDir = getVideosDir();
    const sourcePath = resolveInsideDir(videosDir, sourceName);
    if (!sourcePath)
      return NextResponse.json({ error: "Invalid source filename" }, { status: 400 });
    if (!fs.existsSync(sourcePath))
      return NextResponse.json({ error: "Source video not found" }, { status: 404 });

    const ext = path.extname(sourceName);
    const baseName = sanitizeFileStem(path.basename(sourceName, ext), "video");
    const mp4Name = `${baseName}_720p.mp4`;
    const mp4Path = path.join(videosDir, mp4Name);

    // Already converted — instant response
    if (fs.existsSync(mp4Path))
      return NextResponse.json({ success: true, filename: mp4Name, message: "MP4 already exists" });

    // Probe duration for progress tracking
    const totalSec = probeDuration(sourcePath);

    // Create job
    const jobId = makeJobId();
    jobs.set(jobId, { status: "running", progress: 0, log: "" });

    // ── Attempt 1: fast remux (copy streams, no re-encode) ────────────────
    const remuxArgs = [
      "-i", sourcePath,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c", "copy",
      "-movflags", "+faststart",
      "-progress", "pipe:2",
      "-y",
      mp4Path,
    ];

    const tryRemux = () =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const proc = spawnFfmpeg(remuxArgs);
        let stderr = "";
        proc.stderr?.on("data", (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;
          const pct = parseProgress(chunk, totalSec);
          if (pct !== null) {
            const cur = jobs.get(jobId);
            if (cur?.status === "running")
              jobs.set(jobId, { ...cur, progress: pct, log: stderr.slice(-2000) });
          }
        });
        proc.on("close", (code) => resolve({ code, stderr }));
        proc.on("error", () => resolve({ code: 1, stderr: "ffmpeg not found on PATH" }));
      });

    // ── Attempt 2: full H.264 transcode (fallback) ────────────────────────
    const transcodeArgs = [
      "-i", sourcePath,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-vf", "scale=1280:720:force_original_aspect_ratio=decrease",
      "-progress", "pipe:2",
      "-y",
      mp4Path,
    ];

    const tryTranscode = () =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const proc = spawnFfmpeg(transcodeArgs);
        let stderr = "";
        proc.stderr?.on("data", (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;
          const pct = parseProgress(chunk, totalSec);
          if (pct !== null) {
            const cur = jobs.get(jobId);
            if (cur?.status === "running")
              jobs.set(jobId, { ...cur, progress: pct, log: stderr.slice(-2000) });
          }
        });
        proc.on("close", (code) => resolve({ code, stderr }));
        proc.on("error", () => resolve({ code: 1, stderr: "ffmpeg not found" }));
      });

    // Run background — intentionally NOT awaited
    (async () => {
      try {
        const remux = await tryRemux();
        if (remux.code === 0) {
          jobs.set(jobId, { status: "done", filename: mp4Name, message: "Remuxed to browser-ready MP4" });
          return;
        }
        // Remux failed — delete partial file before transcoding
        if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path);
        const transcode = await tryTranscode();
        if (transcode.code === 0) {
          jobs.set(jobId, { status: "done", filename: mp4Name, message: "Converted to browser-ready MP4" });
        } else {
          jobs.set(jobId, {
            status: "error",
            error: "ffmpeg conversion failed",
            detail: (transcode.stderr || remux.stderr).slice(-800),
          });
          if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path);
        }
      } catch (err: any) {
        jobs.set(jobId, { status: "error", error: "ffmpeg not found on PATH", detail: err.message });
      }
    })();

    return NextResponse.json({ jobId, queued: true });
  } catch (err: any) {
    return NextResponse.json({ error: "Conversion failed", detail: err.message }, { status: 500 });
  }
}

// ─── GET /api/videos/convert?jobId=xxx ───────────────────────────────────────
// Poll endpoint. Returns current job state so the UI can show a progress bar.
export async function GET(request: NextRequest): Promise<Response> {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
  const job = jobs.get(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Clean up completed/failed jobs after the client reads the final state
  if (job.status !== "running") {
    // Keep for 60 s then auto-evict
    setTimeout(() => jobs.delete(jobId), 60_000);
  }
  return NextResponse.json(job);
}
