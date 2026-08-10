"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, ExternalLink, Video, Code2 } from "lucide-react";
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
  const [isHovered, setIsHovered] = useState(false);

  return (
    <header className="h-14 px-4 flex items-center justify-between shrink-0 border-b border-white/10 relative z-10 bg-[#0a0c10]/95 backdrop-blur-md">
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
        {/* Load Video */}
        <motion.button
          whileHover={{ scale: 1.05, y: -1 }}
          whileTap={{ scale: 0.95 }}
          onClick={onLoadVideoDirect}
          className="flex items-center gap-1.5 glass-btn-emerald px-3.5 py-1.5 rounded-full text-[10px] font-bold text-emerald-300 uppercase tracking-wider cursor-pointer"
        >
          <Video className="w-3.5 h-3.5" /> Load Video
        </motion.button>
        {/* Status pill */}
        {statusMessage && (
          <span className="text-[10px] text-emerald-400 glass-pill px-2.5 py-1 rounded-full animate-pulse font-medium">
            {statusMessage}
          </span>
        )}

        {/* ─── Dev Portfolio — Premium Floating Card Button ─── */}
        <motion.a
          href="https://shafayatsaad.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          onHoverStart={() => setIsHovered(true)}
          onHoverEnd={() => setIsHovered(false)}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.97 }}
          className="relative flex items-center gap-2 h-8 px-3.5 rounded-lg cursor-pointer no-underline overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4c1d95 100%)",
            border: "1px solid rgba(139, 92, 246, 0.5)",
            boxShadow: isHovered
              ? "0 8px 32px rgba(139, 92, 246, 0.5), 0 0 0 1px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.15)"
              : "0 4px 16px rgba(139, 92, 246, 0.25), inset 0 1px 0 rgba(255,255,255,0.1)",
            transition: "box-shadow 0.3s ease, border-color 0.3s ease",
            borderColor: isHovered ? "rgba(167, 139, 250, 0.7)" : "rgba(139, 92, 246, 0.5)",
          }}
        >
          {/* Animated shimmer sweep */}
          <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
            <motion.div
              className="absolute -top-1/2 -bottom-1/2 w-[60%]"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), rgba(255,255,255,0.5), rgba(255,255,255,0.2), transparent)",
                transform: "rotate(25deg)",
              }}
              animate={{
                x: ["-150%", "350%"],
              }}
              transition={{
                duration: 2.5,
                repeat: Infinity,
                ease: "easeInOut",
                repeatDelay: 1,
              }}
            />
          </div>

          {/* Top glass highlight */}
          <span className="absolute top-0 left-2 right-2 h-[1px] bg-gradient-to-r from-transparent via-violet-300/50 to-transparent pointer-events-none" />

          {/* Code icon */}
          <motion.div
            animate={isHovered ? { rotate: [0, -10, 10, 0] } : { rotate: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center justify-center w-5 h-5 rounded-md bg-violet-500/30 border border-violet-400/40 shrink-0"
          >
            <Code2 className="w-3 h-3 text-violet-200" />
          </motion.div>

          {/* Text */}
          <span className="text-[11px] font-bold tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)] whitespace-nowrap">
            Dev Portfolio
          </span>

          {/* External link icon */}
          <AnimatePresence>
            {isHovered && (
              <motion.div
                initial={{ opacity: 0, x: -4, width: 0 }}
                animate={{ opacity: 1, x: 0, width: "auto" }}
                exit={{ opacity: 0, x: -4, width: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <ExternalLink className="w-3 h-3 text-violet-200" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.a>
      </div>
    </header>
  );
}
