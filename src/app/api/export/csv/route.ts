import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { atomicWriteText, getExportsDir, sanitizeFileStem } from "@/lib/server-utils";
import { validateAnnotationSession } from "@/lib/annotation-validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const anns = body.annotations || [];
    const teamConfig = body.team_config;
    if (anns.length === 0) return NextResponse.json({ error: "No annotations to export" }, { status: 400 });
    const report = validateAnnotationSession(anns);
    if (!report.ok) {
      return NextResponse.json(
        {
          error: "CSV export validation failed",
          gate_failures: report.errors.map((entry) => entry.message),
          warnings: report.warnings.map((entry) => entry.message),
          report,
        },
        { status: 422 },
      );
    }

    const matchId = sanitizeFileStem(anns[0].match_id || "unknown");
    const fileName = `TACTIC_FP_Annotated_${matchId}.csv`;
    const filePath = path.join(getExportsDir(), fileName);

    const headers = ["clip_id","match_id","match_name","half","window_idx","parent_segment_id","split_index","split_count","split_source_start_sec","split_source_end_sec","video_path","seek_start_sec","label_start_sec","label_end_sec","seek_end_sec","team_a_id","team_a_name","team_a_jersey_color","team_a_intent","team_a_confidence","team_a_possession","team_b_id","team_b_name","team_b_jersey_color","team_b_intent","team_b_confidence","team_b_possession","exclusion","flagged_review","skipped","annotated_at"];
    const toCsvVal = (val: any): string => {
      if (val == null) return "";
      if (typeof val === "boolean") return val ? "true" : "false";
      const unsafe = String(val);
      const s = /^[=+\-@]/.test(unsafe) ? `'${unsafe}` : unsafe;
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };

    const flatten = (ann: any) => ({
      clip_id: ann.clip_id,
      match_id: ann.match_id,
      match_name: ann.match_name,
      half: ann.half,
      window_idx: ann.window_idx,
      parent_segment_id: ann.segment_metadata?.parent_segment_id,
      split_index: ann.segment_metadata?.split_index,
      split_count: ann.segment_metadata?.split_count,
      split_source_start_sec: ann.segment_metadata?.split_source_start_sec,
      split_source_end_sec: ann.segment_metadata?.split_source_end_sec,
      video_path: ann.video_source?.video_path,
      seek_start_sec: ann.video_source?.seek_start_sec,
      label_start_sec: ann.video_source?.label_start_sec,
      label_end_sec: ann.video_source?.label_end_sec,
      seek_end_sec: ann.video_source?.seek_end_sec,
      team_a_id: ann.team_a?.team_id,
      team_a_name: ann.team_a?.team_name || teamConfig?.team_a?.name,
      team_a_jersey_color: ann.team_a?.jersey_color || teamConfig?.team_a?.jersey_color,
      team_a_intent: ann.team_a?.label?.intent_class,
      team_a_confidence: ann.team_a?.label?.confidence,
      team_a_possession: ann.team_a?.possession,
      team_b_id: ann.team_b?.team_id,
      team_b_name: ann.team_b?.team_name || teamConfig?.team_b?.name,
      team_b_jersey_color: ann.team_b?.jersey_color || teamConfig?.team_b?.jersey_color,
      team_b_intent: ann.team_b?.label?.intent_class,
      team_b_confidence: ann.team_b?.label?.confidence,
      team_b_possession: ann.team_b?.possession,
      exclusion: ann.exclusion,
      flagged_review: ann.agreement?.flagged_review,
      skipped: ann.agreement?.skipped,
      annotated_at: ann.agreement?.annotated_at,
    });
    const rows = [headers.join(","), ...anns.map((ann: any) => { const row = flatten(ann); return headers.map((h) => toCsvVal((row as any)[h])).join(","); })];
    atomicWriteText(filePath, rows.join("\r\n"));

    return NextResponse.json({ success: true, fileName });
  } catch (error: any) { return NextResponse.json({ error: "Failed to export CSV", detail: error.message }, { status: 500 }); }
}
