"use client";

import { motion } from "framer-motion";
import { Target, ArrowRight, Video, Sparkles } from "lucide-react";
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
        {/* Load Video — glass emerald pill */}
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

        {/* ─── Dev Portfolio — Premium Radiant Shimmer Button ─── */}
        <motion.a
          whileHover={{ scale: 1.06, y: -1 }}
          whileTap={{ scale: 0.95 }}
          href="https://shafayatsaad.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="relative inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#0d0f17] border border-violet-500/40 hover:border-violet-400/80 shadow-[0_0_20px_rgba(139,92,246,0.35),0_0_40px_rgba(59,130,246,0.15)] hover:shadow-[0_0_30px_rgba(139,92,246,0.65),0_0_50px_rgba(236,72,153,0.3)] transition-all duration-300 backdrop-blur-xl group overflow-hidden cursor-pointer no-underline"
        >
          {/* Continuous Shimmer Light Sweep Beam */}
          <span className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
            <span className="absolute -top-1/2 -bottom-1/2 left-0 shimmer-beam pointer-events-none" />
          </span>

          {/* Inner Glossy Top Rim */}
          <span className="absolute top-0 left-3 right-3 h-[1px] bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none" />

          {/* Left Sparkles Icon in glowing violet badge */}
          <div className="relative flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow-[0_0_10px_rgba(139,92,246,0.6)] shrink-0">
            <Sparkles className="w-3 h-3 text-amber-200 fill-amber-200 animate-pulse" />
          </div>

          {/* Text Label */}
          <span className="font-bold text-[11px] tracking-wide bg-gradient-to-r from-white via-violet-100 to-sky-200 bg-clip-text text-transparent">
            Dev Portfolio
          </span>

          {/* Right Arrow badge */}
          <ArrowRight className="w-3.5 h-3.5 text-violet-300 group-hover:text-white group-hover:translate-x-1 transition-transform duration-300 shrink-0" />
        </motion.a>
      </div>
    </header>
  );
}
