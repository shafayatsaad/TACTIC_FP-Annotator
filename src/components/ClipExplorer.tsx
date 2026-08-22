"use client";

import { FolderOpen, Loader2, Video, Trash2 } from "lucide-react";
import type { Clip, Annotation } from "@/lib/constants";

interface Props {
  clips: Clip[];
  filteredClips: Clip[];
  currentClipIndex: number;
  annotations: Annotation[];
  clipFilter: "all" | "todo" | "done";
  clipSearch: string;
  clipListRef: React.RefObject<HTMLDivElement>;
  isLoading: boolean;
  onClipFilterChange: (f: "all" | "todo" | "done") => void;
  onClipSearchChange: (s: string) => void;
  onClipSelect: (idx: number) => void;
  onLoadManifest: () => void;
  onLoadVideoDirect: () => void;
  onGenerateManifest: () => void;
  onDeleteSegment: (clipId: string) => void;
  isGenerating: boolean;
  formatTime: (s: number) => string;
  formatMatchClock: (half: number, s: number) => string;
  hasAnnotated: (id: string) => boolean;
  recentlyCreatedClipId?: string | null;
  onBrowseVideo: () => void;
}

export default function ClipExplorer({
  clips,
  filteredClips,
  currentClipIndex,
  annotations,
  clipFilter,
  clipSearch,
  clipListRef,
  isLoading,
  onClipFilterChange,
  onClipSearchChange,
  onClipSelect,
  onLoadManifest,
  onLoadVideoDirect,
  onGenerateManifest,
  onDeleteSegment,
  isGenerating,
  formatTime,
  formatMatchClock,
  hasAnnotated,
  recentlyCreatedClipId = null,
  onBrowseVideo,
}: Props) {
  return (
    <aside className="w-56 bg-black/40 border-r border-white/10 flex flex-col shrink-0" style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div className="flex flex-col flex-1 min-h-0 p-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Segment List
          </h3>
          <span className="px-1.5 py-0.5 rounded text-[9px] glass-btn text-slate-300 font-mono">
            {filteredClips.length}
          </span>
        </div>
        <input
          type="text"
          value={clipSearch}
          onChange={(e) => onClipSearchChange(e.target.value)}
          placeholder="Search segments..."
          className="w-full bg-white/[0.02] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 mb-3 transition-colors"
          style={{ backdropFilter: "blur(4px)" }}
        />
        <div className="flex gap-1.5 mb-3">
          {(["all", "todo", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => onClipFilterChange(f)}
              className={`px-2 py-1 flex-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                clipFilter === f
                  ? "glass-btn-indigo text-white"
                  : "glass-btn text-slate-400"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div
          ref={clipListRef}
          className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
            </div>
          ) : clips.length === 0 ? (
            <div className="text-center py-6">
              <FolderOpen className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-500 mb-3">No match loaded</p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={onLoadVideoDirect}
                  className="w-full px-3 py-1.5 glass-btn-emerald text-emerald-300 text-[10px] font-bold rounded-lg uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.02]"
                >
                  <Video className="w-3 h-3" /> Load Video
                </button>
                <button
                  onClick={onBrowseVideo}
                  className="w-full px-3 py-1.5 glass-btn-indigo text-indigo-300 text-[10px] font-bold rounded-lg uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.02]"
                >
                  <FolderOpen className="w-3 h-3" /> Browse File
                </button>
              </div>
            </div>
          ) : (
            filteredClips.map((clip) => {
              const idx = clips.findIndex((c) => c === clip);
              const listKey = `${clip.clip_id}-${clip.path}-${clip.half}-${clip.window_idx ?? clip.start}`;
              const isDone = hasAnnotated(clip.clip_id);
              const isActive = idx === currentClipIndex;
              const isNew = clip.clip_id === recentlyCreatedClipId;
              const ann = annotations.find((a) => a.clip_id === clip.clip_id);
              return (
                <div
                  key={listKey}
                  data-active={isActive ? "true" : "false"}
                  onClick={() => onClipSelect(idx)}
                  className={`relative p-2 rounded-lg transition-all cursor-pointer group ${isActive ? "glass-btn-indigo shadow-[inset_2px_0_0_0_#6366f1]" : "glass-btn hover:bg-white/10"} ${isNew ? "clip-pulse" : ""}`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span
                      className={`font-mono text-[11px] ${isActive ? "text-indigo-400 font-bold" : "text-slate-300"}`}
                    >
                      {clip.clip_id}
                    </span>
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${isDone ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : isActive ? "bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.6)] animate-pulse" : "bg-slate-700"}`}
                    />
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {formatMatchClock(clip.half, clip.annotation_start)} –{" "}
                    {formatMatchClock(clip.half, clip.annotation_end)}
                  </div>
                  {ann &&
                    ann.team_a?.label?.intent_class &&
                    ann.team_a.label.intent_class !== "Skipped" && (
                      <div className="text-[9px] uppercase text-teal-400 mt-0.5 font-bold tracking-wider">
                        A: {ann.team_a.label.intent_class}
                      </div>
                    )}
                  {ann &&
                    ann.team_b?.label?.intent_class &&
                    ann.team_b.label.intent_class !== "Skipped" && (
                      <div className="text-[9px] uppercase text-blue-400 mt-0.5 font-bold tracking-wider">
                        B: {ann.team_b.label.intent_class}
                      </div>
                    )}
                  {ann && ann.exclusion && (
                    <div className="text-[9px] uppercase text-amber-400 mt-0.5 font-bold tracking-wider">
                      ⚠ {ann.exclusion}
                    </div>
                  )}
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete segment ${clip.clip_id}?`)) {
                        onDeleteSegment(clip.clip_id);
                      }
                    }}
                    className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded glass-btn-rose text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Delete segment"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="p-2.5 bg-black/30 shrink-0 border-t border-white/5 space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
            Keyboard Shortcuts
          </h3>
          <span className="text-[7.5px] text-slate-500 font-mono">
            [<kbd className="text-indigo-300">?</kbd>] All
          </span>
        </div>

        {/* 4 Timing Functions Guide */}
        <div className="bg-black/40 border border-white/5 rounded-md p-1.5 space-y-1 text-[8.5px] font-mono">
          <div className="flex items-center justify-between text-indigo-300">
            <span>Start -/+ 0.5s</span>
            <span className="font-bold bg-indigo-500/20 px-1 py-0.2 rounded border border-indigo-500/30">
              ,  /  .
            </span>
          </div>
          <div className="flex items-center justify-between text-cyan-300">
            <span>End -/+ 0.5s</span>
            <span className="font-bold bg-cyan-500/20 px-1 py-0.2 rounded border border-cyan-500/30">
              ⇧,  /  ⇧.
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-300 pt-0.5 border-t border-white/5">
            <span className="text-slate-400">Mark Start / End</span>
            <span className="font-bold bg-white/10 px-1 py-0.2 rounded text-slate-200">
              I  /  O
            </span>
          </div>
        </div>

        {/* Primary Action Shortcuts */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[8.5px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Team</span>
            <kbd className="glass-btn px-1 py-0.2 rounded text-[7.5px] text-slate-300 font-mono">A / B</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Play</span>
            <kbd className="glass-btn px-1 py-0.2 rounded text-[7.5px] text-slate-300 font-mono">Space</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Submit</span>
            <kbd className="glass-btn px-1 py-0.2 rounded text-[7.5px] text-slate-300 font-mono">Enter</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Clip</span>
            <kbd className="glass-btn px-1 py-0.2 rounded text-[7.5px] text-slate-300 font-mono">[ / ]</kbd>
          </div>
        </div>
      </div>
    </aside>
  );
}
