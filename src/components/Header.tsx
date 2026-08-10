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
    <header className="h-14 px-4 flex items-center justify-between shrink-0 border-b border-white/10 relative z-10">
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
        {/* Load Video — glass emerald */}
        <motion.button
          whileHover={{ scale: 1.05, y: -1 }}
          whileTap={{ scale: 0.95 }}
          onClick={onLoadVideoDirect}
          className="flex items-center gap-1.5 glass-btn-emerald px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-300 uppercase tracking-wider cursor-pointer"
        >
          <Video className="w-3.5 h-3.5" /> Load Video
        </motion.button>
        {/* Status pill */}
        {statusMessage && (
          <span className="text-[10px] text-emerald-400 glass-pill px-2 py-1 rounded-lg animate-pulse">
            {statusMessage}
          </span>
        )}
        {/* ─── Dev Portfolio — Premium Animated Badge ─── */}
        <motion.a
          whileHover={{ scale: 1.08, y: -2 }}
          whileTap={{ scale: 0.95 }}
          href="https://shafayatsaad.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="relative group flex items-center gap-2 px-4 py-1.5 rounded-xl overflow-hidden portfolio-glow cursor-pointer"
          style={{
            background:
              "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.2), rgba(217,70,239,0.15))",
            border: "1px solid rgba(139,92,246,0.4)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          {/* Shimmer overlay */}
          <span
            className="absolute inset-0 portfolio-shimmer rounded-xl pointer-events-none"
            aria-hidden="true"
          />
          {/* Gradient border glow on hover */}
          <span
            className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
            style={{
              background:
                "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.12), rgba(217,70,239,0.08))",
            }}
            aria-hidden="true"
          />
          <Sparkles className="w-3.5 h-3.5 text-violet-300 relative z-10" />
          <span className="text-[10px] font-bold text-white uppercase tracking-widest relative z-10">
            Dev Portfolio
          </span>
          <ArrowRight className="w-3 h-3 text-violet-300 group-hover:translate-x-0.5 transition-transform relative z-10" />
        </motion.a>
      </div>
    </header>
  );
}
