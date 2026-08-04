import { NextRequest, NextResponse } from "next/server";
import { readAnnotationSession, writeAnnotations } from "@/lib/server-utils";
import { validateAnnotationSession } from "@/lib/annotation-validation";

export async function GET() {
  try { return NextResponse.json(readAnnotationSession()); }
  catch (error: any) { return NextResponse.json({ error: "Failed to load annotations", detail: error.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const annotations = body.annotations || [];
    if (!Array.isArray(annotations)) {
      return NextResponse.json(
        { error: "Invalid annotations payload", detail: "annotations must be an array" },
        { status: 400 },
      );
    }
    if (annotations.length > 0) {
      const report = validateAnnotationSession(annotations);
      if (!report.ok) {
        return NextResponse.json(
          {
            error: "Annotation validation failed",
            gate_failures: report.errors.map((entry) => entry.message),
            warnings: report.warnings.map((entry) => entry.message),
            report,
          },
          { status: 422 },
        );
      }
    }
    writeAnnotations(annotations, body.team_config, body.match_config);
    return NextResponse.json({ success: true });
  } catch (error: any) { return NextResponse.json({ error: "Failed to save annotations", detail: error.message }, { status: 500 }); }
}
