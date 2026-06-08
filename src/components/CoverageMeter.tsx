"use client";

import React from "react";

export interface CoverageStats {
  totalMatchSec: number;
  labeledSec: number;
  excludedSec: number;
  currentSegmentSec: number;
  remainingSec: number;
}

interface CoverageMeterProps {
  stats: CoverageStats;
}

export default function CoverageMeter({ stats }: CoverageMeterProps) {
  const {
    totalMatchSec,
    labeledSec,
    excludedSec,
    currentSegmentSec,
    remainingSec,
  } = stats;
  if (totalMatchSec <= 0) return null;

  const pct = (sec: number) =>
    Math.max(0, Math.min(100, (sec / totalMatchSec) * 100));
  const labeledPct = pct(labeledSec);
  const excludedPct = pct(excludedSec);
  const currentPct = pct(currentSegmentSec);

  const fmtPct = (sec: number) => ((sec / totalMatchSec) * 100).toFixed(1);
  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-md">
      <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden flex">
        <div
          className="h-full bg-emerald-400 transition-all duration-300"
          style={{ width: `${labeledPct}%` }}
          title={`Labeled: ${fmtTime(labeledSec)} (${fmtPct(labeledSec)}%)`}
        />
        <div
          className="h-full bg-slate-500 transition-all duration-300"
          style={{ width: `${excludedPct}%` }}
          title={`Excluded: ${fmtTime(excludedSec)} (${fmtPct(excludedSec)}%)`}
        />
        <div
          className="h-full bg-indigo-400 transition-all duration-300"
          style={{ width: `${currentPct}%` }}
          title={`Current: ${fmtTime(currentSegmentSec)} (${fmtPct(currentSegmentSec)}%)`}
        />
      </div>
      <div className="flex items-center gap-3 text-[9px] text-slate-400 font-mono mt-1">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Labeled {fmtPct(labeledSec)}%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
          Excluded {fmtPct(excludedSec)}%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          Current {fmtPct(currentSegmentSec)}%
        </span>
        {remainingSec > 0 && (
          <span className="text-slate-600">
            Remaining {fmtTime(remainingSec)}
          </span>
        )}
      </div>
    </div>
  );
}
