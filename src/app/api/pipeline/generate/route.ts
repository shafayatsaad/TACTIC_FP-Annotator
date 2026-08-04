import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { readManifest } from "@/lib/server-utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const clipDuration = body.clip_duration ?? 30;
    const annotationWindow = body.annotation_window ?? 6;
    const stepDuration = body.step_duration ?? 7;
    const allowedClipDurations = new Set([10, 18, 30]);
    if (
      !allowedClipDurations.has(Number(clipDuration)) ||
      !Number.isFinite(Number(annotationWindow)) ||
      !Number.isFinite(Number(stepDuration)) ||
      Number(annotationWindow) < 2 ||
      Number(annotationWindow) > Number(clipDuration) ||
      Number(stepDuration) <= 0
    ) {
      return NextResponse.json(
        {
          error: "Invalid pipeline parameters",
          detail:
            "clip_duration must be 10, 18, or 30; annotation_window must be 2..clip_duration; step_duration must be positive.",
        },
        { status: 400 },
      );
    }

    const runPipeline = (pythonCmd: string): Promise<NextResponse> => {
      return new Promise((resolve) => {
        const py = spawn(pythonCmd, ["pipeline.py", "--clip-duration", String(clipDuration), "--annotation-window", String(annotationWindow), "--step-duration", String(stepDuration)]);
        let stdout = "", stderr = "";
        py.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        py.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        py.on("close", (code: number | null) => {
          if (code === 0) { try { resolve(NextResponse.json({ success: true, output: stdout, manifest: readManifest() })); } catch { resolve(NextResponse.json({ success: true, output: stdout, manifest: [] })); } }
          else { resolve(NextResponse.json({ error: "Pipeline failed", stderr, stdout }, { status: 500 })); }
        });
        py.on("error", () => { resolve(NextResponse.json({ error: "Python not found" }, { status: 500 })); });
      });
    };

    const result = await runPipeline("python3");
    if (result.status === 500) { const result2 = await runPipeline("python"); return result2; }
    return result;
  } catch (error: any) { return NextResponse.json({ error: "Failed to run pipeline", detail: error.message }, { status: 500 }); }
}
