import { NextRequest, NextResponse } from "next/server";
import { readAnnotationSession, writeAnnotations } from "@/lib/server-utils";

export async function GET() {
  try { return NextResponse.json(readAnnotationSession()); }
  catch (error: any) { return NextResponse.json({ error: "Failed to load annotations", detail: error.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    writeAnnotations(body.annotations || [], body.team_config, body.match_config);
    return NextResponse.json({ success: true });
  } catch (error: any) { return NextResponse.json({ error: "Failed to save annotations", detail: error.message }, { status: 500 }); }
}
