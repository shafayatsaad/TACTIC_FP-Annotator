import { NextResponse } from "next/server";
import { readManifest } from "@/lib/server-utils";

export async function GET() {
  try { return NextResponse.json(readManifest()); }
  catch (error: any) { return NextResponse.json({ error: "Failed to read manifest", detail: error.message }, { status: 500 }); }
}
