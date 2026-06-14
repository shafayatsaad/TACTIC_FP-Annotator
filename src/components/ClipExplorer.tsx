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
    <aside className="w-64 bg-black/40 border-r border-white/10 flex flex-col shrink-0">
      <div className="flex flex-col flex-1 min-h-0 p-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Segment List
          </h3>
          <span className="px-1.5 py-0.5 rounded text-[9px] bg-white/5 text-slate-300 font-mono">
            {filteredClips.length}
          </span>
        </div>
        <input
          type="text"
          value={clipSearch}
          onChange={(e) => onClipSearchChange(e.target.value)}
          placeholder="Search segments..."
          className="w-full bg-white/[0.02] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 mb-3 transition-colors"
        />
        <div className="flex gap-1.5 mb-3">
          {(["all", "todo", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => onClipFilterChange(f)}
              className={`px-2 py-1 flex-1 rounded text-[9px] font-bold uppercase tracking-wider transition-colors border ${clipFilter === f ? "bg-indigo-500/30 text-white border-indigo-500/50" : "bg-white/[0.05] text-slate-400 border-white/10 hover:bg-white/10"}`}
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
                  className="w-full px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded-lg uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5"
                >
                  <Video className="w-3 h-3" /> Load Video
                </button>
                <button
                  onClick={onBrowseVideo}
                  className="w-full px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5"
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
                  className={`relative p-2 rounded-lg border transition-all cursor-pointer group ${isActive ? "bg-indigo-500/15 border-indigo-500/50 shadow-[inset_2px_0_0_0_#6366f1]" : "bg-white/[0.02] border-white/5 hover:bg-white/10 hover:border-white/20"} ${isNew ? "clip-pulse" : ""}`}
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
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete segment ${clip.clip_id}?`)) {
                        onDeleteSegment(clip.clip_id);
                      }
                    }}
                    className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-red-500/10 hover:bg-red-500/30 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
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
      <div className="p-3 bg-black/20 shrink-0 border-t border-white/5">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-2">
          Keyboard Shortcuts
        </h3>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {[
            ["Intents", "1-9, 0, Q-T"],
            ["Select Team", "A / B"],
            ["Play / Pause", "Space / K"],
            ["Skip Clip", "S"],
            ["Submit / Save", "Enter"],
            ["Prev / Next", "[ / ]"],
            ["New Segment", "M"],
            ["Cancel Seg", "N / Esc"],
            ["Set Start", "I"],
            ["Set End", "O"],
            ["Seek 5s", "← / →"],
            ["Mute", "U"],
          ].map(([l, k]) => (
            <div key={l} className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400">{l}</span>
              <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] text-slate-300 font-mono">
                {k}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
