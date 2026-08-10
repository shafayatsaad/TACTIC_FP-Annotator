"use client";

import { motion } from "framer-motion";
import { Target, ArrowUpRight, Video, Globe } from "lucide-react";
import type { Clip } from "@/lib/constants";
import CoverageMeter, { type CoverageStats } from "./CoverageMeter";

interface HeaderProps {
  coverageStats?: CoverageStats;
  currentClip: Clip | undefined;
  currentClipIndex: number;
  totalClips: number;
  annotatedCount: number;
  isGenerating: boolean;
  statusMessage: string;
  onLoadManifest: () => void;
  onGenerateManifest: () => void;
  onLoadVideoDirect: () => void;
}

export default function Header({
  coverageStats,
  currentClip,
  currentClipIndex,
  totalClips,
  annotatedCount,
  statusMessage,
  onLoadVideoDirect,
}: HeaderProps) {
  return (
    <header className="h-14 px-4 flex items-center justify-between shrink-0 border-b border-white/10 relative z-10 bg-[#0a0c10]/90 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/20">
          <Target className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-sm font-semibold tracking-tight text-white">
          TACTIC-FP Annotator
        </h1>
        <div className="w-px h-4 bg-white/10 mx-1" />
        <p className="text-xs text-slate-400">
          {currentClip ? currentClip.match_id : "No match loaded"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {coverageStats && <CoverageMeter stats={coverageStats} />}
        {currentClip && (
          <div className="flex items-center gap-2 glass-btn px-3 py-1.5 rounded-lg">
            <span className="text-xs font-medium text-slate-200">
              Segment {currentClipIndex + 1} · {totalClips} saved · {annotatedCount} annotated
            </span>
          </div>
        )}
        {/* Load Video — sleek glass emerald pill */}
        <motion.button
          whileHover={{ scale: 1.05, y: -1 }}
          whileTap={{ scale: 0.95 }}
          onClick={onLoadVideoDirect}
          className="flex items-center gap-1.5 glass-btn-emerald px-3 py-1.5 rounded-full text-[10px] font-bold text-emerald-300 uppercase tracking-wider cursor-pointer"
        >
          <Video className="w-3.5 h-3.5" /> Load Video
        </motion.button>
        {/* Status pill */}
        {statusMessage && (
          <span className="text-[10px] text-emerald-400 glass-pill px-2.5 py-1 rounded-full animate-pulse font-medium">
            {statusMessage}
          </span>
        )}
        {/* ─── Dev Portfolio — Ultra-Sleek Modern Pill ─── */}
        <motion.a
          whileHover={{ scale: 1.04, y: -1 }}
          whileTap={{ scale: 0.96 }}
          href="https://shafayatsaad.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="relative inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-slate-900/90 via-indigo-950/80 to-purple-950/90 border border-indigo-400/35 hover:border-indigo-400/70 shadow-[0_4px_16px_rgba(0,0,0,0.4),0_0_20px_rgba(99,102,241,0.25)] hover:shadow-[0_4px_24px_rgba(99,102,241,0.45)] transition-all duration-300 backdrop-blur-xl group overflow-hidden cursor-pointer no-underline"
        >
          {/* Subtle top shine reflection */}
          <span className="absolute top-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />

          {/* Globe Icon Badge */}
          <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300 group-hover:bg-indigo-500/30 group-hover:text-white transition-colors shrink-0">
            <Globe className="w-3 h-3" />
          </div>

          {/* Label with clean gradient typography */}
          <span className="text-[11px] font-bold tracking-wide bg-gradient-to-r from-white via-indigo-100 to-purple-200 bg-clip-text text-transparent">
            Dev Portfolio
          </span>

          {/* External Arrow Badge */}
          <div className="flex items-center justify-center w-4 h-4 rounded-full bg-white/5 group-hover:bg-white/15 transition-colors shrink-0">
            <ArrowUpRight className="w-3 h-3 text-indigo-300 group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-200" />
          </div>
        </motion.a>
      </div>
    </header>
  );
}
