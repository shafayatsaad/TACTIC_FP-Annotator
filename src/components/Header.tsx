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
        {/* ─── Dev Portfolio — Next-Gen Glowing Rainbow Glass Badge ─── */}
        <motion.a
          href="https://shafayatsaad.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="portfolio-border-glow group flex items-center gap-2 px-3.5 py-1.5 cursor-pointer text-white no-underline"
        >
          {/* Pulsing indicator dot */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-400"></span>
          </span>
          <Sparkles className="w-3.5 h-3.5 text-purple-300 group-hover:rotate-12 transition-transform duration-300" />
          <span className="text-[10px] font-extrabold uppercase tracking-widest bg-gradient-to-r from-white via-slate-100 to-purple-200 bg-clip-text text-transparent">
            Dev Portfolio
          </span>
          <ArrowRight className="w-3 h-3 text-purple-300 group-hover:translate-x-1 transition-transform duration-300" />
        </motion.a>
      </div>
    </header>
  );
}
