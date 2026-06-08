import { NextResponse } from "next/server";
import { resetGeneratedSessionFiles } from "@/lib/server-utils";

export async function POST() {
  try { resetGeneratedSessionFiles(); return NextResponse.json({ success: true, cleared: ["annotations", "manifest", "exports", "generated_mp4"] }); }
  catch (error: any) { return NextResponse.json({ error: "Failed to reset session", detail: error.message }, { status: 500 }); }
}
