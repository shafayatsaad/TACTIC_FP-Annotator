"use client";

import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Flag,
  Plus,
  HelpCircle,
  Check,
  SkipBack,
  SkipForward,
  FolderOpen,
} from "lucide-react";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Clip, AnnotatorState } from "@/lib/constants";
import { formatMatchClock, formatSec } from "@/lib/utils";

// New segment creation: { start, end } both in match-seconds.
export type CreatingSegment = { start: number; end: number } | null;

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoContainerRef: React.RefObject<HTMLDivElement>;
  currentClip: Clip | undefined;
  videoPath: string | null;
  clips: Clip[];
  currentClipIndex: number;
  matchDurationSec: number;
  isLoading: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  videoCurrentTime: number;
  isMuted: boolean;
  playbackRate: number;
  loopClip: boolean;
  videoError: string;
  isConverting: boolean;
  creatingSegment: CreatingSegment;
  onTogglePlayback: () => void;
  onReplayClip: () => void;
  onToggleFullscreen: () => void;
  onProgressClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCycleSpeed: () => void;
  onToggleMute: () => void;
  onToggleLoop: () => void;
  onVideoPlay: () => void;
  onVideoPause: () => void;
  onVideoWaiting: () => void;
  onVideoPlaying: () => void;
  onVideoError: () => void;
  onConvertVideo: () => void;
  onLoadVideoDirect: () => void;
  onBoundaryNudge: (edge: "start" | "end", deltaSec: number) => void;
  onStartSegmentCreate: () => void;
  onUpdateSegmentDraft: (start: number, end: number) => void;
  onCancelSegmentCreate: () => void;
  onConfirmSegmentCreate: () => void;
  onHelp: () => void;
  getAnnotatorState: (clip: Clip) => AnnotatorState;
  formatTime: (s: number) => string;
  setVideoError: (s: string) => void;
  onSetSegmentStart: () => void;
  onSetSegmentEnd: () => void;
  onFileDrop?: (file: File) => void;
}

const STATE_COLORS: Record<string, string> = {
  accepted: "bg-emerald-400/70",
  modified: "bg-amber-400/60",
  rejected: "bg-slate-500/25",
  manual: "bg-emerald-400/85",
};

export default function VideoPlayer(props: Props) {
  const {
    videoRef,
    videoContainerRef,
    currentClip,
    videoPath,
    clips,
    matchDurationSec,
    isLoading,
    isPlaying,
    isBuffering,
    videoCurrentTime,
    isMuted,
    playbackRate,
    loopClip,
    videoError,
    isConverting,
    creatingSegment,
    onTogglePlayback,
    onReplayClip,
    onToggleFullscreen,
    onProgressClick,
    onCycleSpeed,
    onToggleMute,
    onToggleLoop,
    onVideoPlay,
    onVideoPause,
    onVideoWaiting,
    onVideoPlaying,
    onVideoError,
    onConvertVideo,
    onLoadVideoDirect,
    onBoundaryNudge,
    onStartSegmentCreate,
    onUpdateSegmentDraft,
    onCancelSegmentCreate,
    onConfirmSegmentCreate,
    onHelp,
    getAnnotatorState,
    formatTime,
    onSetSegmentStart,
    onSetSegmentEnd,
    onFileDrop,
  } = props;

  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => {
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && onFileDrop) {
      onFileDrop(file);
    }
  };

  const progressBarRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [draggingEdge, setDraggingEdge] = useState<{
    clipId: string;
    edge: "start" | "end";
  } | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local drag state for "+ New Segment" mode. Lives here so the timeline
  // can be a one-shot interaction without round-tripping through the parent.
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);

  // Auto-hide controls
  useEffect(() => {
    const show = () => {
      setControlsVisible(true);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      hideControlsTimer.current = setTimeout(() => {
        if (isPlaying) setControlsVisible(false);
      }, 2800);
    };
    show();
    const onMove = () => show();
    const container = videoContainerRef.current;
    container?.addEventListener("mousemove", onMove);
    container?.addEventListener("mouseenter", onMove);
    return () => {
      container?.removeEventListener("mousemove", onMove);
      container?.removeEventListener("mouseenter", onMove);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [isPlaying, videoContainerRef]);

  // Boundary drag for existing clips
  const handleEdgeMouseDown = useCallback(
    (e: React.MouseEvent, clipId: string, edge: "start" | "end") => {
      if (creatingSegment) return; // don't fight with segment-create mode
      e.stopPropagation();
      e.preventDefault();
      setDraggingEdge({ clipId, edge });
    },
    [creatingSegment],
  );

  useEffect(() => {
    if (!draggingEdge) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const timeSec = p * matchDurationSec;
      const clip = clips.find((c) => c.clip_id === draggingEdge.clipId);
      if (!clip) return;
      const deltaSec =
        draggingEdge.edge === "start"
          ? timeSec - clip.annotation_start
          : timeSec - clip.annotation_end;
      const snappedDelta = Math.round(deltaSec);
      if (Math.abs(snappedDelta) >= 1) {
        onBoundaryNudge(draggingEdge.edge, snappedDelta);
      }
    };
    const handleMouseUp = () => setDraggingEdge(null);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingEdge, clips, matchDurationSec, onBoundaryNudge]);

  const pct = (sec: number) =>
    Math.max(0, Math.min(100, (sec / matchDurationSec) * 100));

  const liveMatchClock = useMemo(
    () => formatMatchClock(currentClip?.half ?? 1, videoCurrentTime),
    [currentClip?.half, videoCurrentTime],
  );

  const handleProgressHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setHoverTime(p * matchDurationSec);
    },
    [matchDurationSec],
  );

  // "+ New Segment" drag-to-create on the timeline. The first click sets
  // the start, the second click (or the mouseup of a drag) sets the end.
  // Drag-create works without needing a second click — drag the mouse from
  // start to end, then release.
  const handleProgressMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!creatingSegment) {
        // Normal click: seek the video.
        onProgressClick(e);
        return;
      }
      if (!progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = p * matchDurationSec;
      setDragStart(t);
      setDragCurrent(t);
      e.preventDefault();
    },
    [creatingSegment, matchDurationSec, onProgressClick],
  );

  useEffect(() => {
    if (dragStart === null) return;
    const onMove = (e: MouseEvent) => {
      if (!progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setDragCurrent(p * matchDurationSec);
    };
    const onUp = () => {
      if (dragStart !== null && dragCurrent !== null) {
        const a = Math.min(dragStart, dragCurrent);
        const b = Math.max(dragStart, dragCurrent);
        if (b - a >= 1) onUpdateSegmentDraft(a, b);
      }
      setDragStart(null);
      setDragCurrent(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragStart, dragCurrent, matchDurationSec, onUpdateSegmentDraft]);

  // Live preview of the drag range (while the user is dragging).
  const dragPreviewStart =
    dragStart !== null && dragCurrent !== null
      ? Math.min(dragStart, dragCurrent)
      : null;
  const dragPreviewEnd =
    dragStart !== null && dragCurrent !== null
      ? Math.max(dragStart, dragCurrent)
      : null;

  const startTime = currentClip
    ? formatTime(currentClip.annotation_start)
    : "--:--";
  const endTime = currentClip
    ? formatTime(currentClip.annotation_end)
    : "--:--";

  return (
    <div
      ref={videoContainerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 flex flex-col bg-black/70 rounded-2xl border border-white/[0.07] shadow-2xl relative overflow-hidden min-h-[320px] mb-4 group/player"
    >
      {isDragOver && (
        <div className="absolute inset-0 z-30 bg-indigo-950/80 border-2 border-dashed border-indigo-500 rounded-2xl flex flex-col items-center justify-center backdrop-blur-sm pointer-events-none transition-all">
          <FolderOpen className="w-12 h-12 text-indigo-400 mb-3 animate-bounce" />
          <p className="text-sm font-semibold text-indigo-200">Drop video here to load</p>
          <p className="text-xs text-indigo-400 mt-1">Supports MP4, MKV, etc.</p>
        </div>
      )}
      {currentClip && (
        <div className="absolute top-3 left-3 z-20 px-2.5 py-1 bg-black/70 border border-white/10 text-slate-200 text-[10px] font-mono rounded-md flex items-center gap-1.5 backdrop-blur">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
          H{currentClip.half} ·{" "}
          {currentClip.game_clock || formatTime(currentClip.start)}
          {currentClip.anchor_event && (
            <span className="text-indigo-300 ml-1 px-1 rounded bg-indigo-500/10">
              {currentClip.anchor_event.type}
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onHelp}
        className="absolute top-3 right-3 z-20 w-7 h-7 flex items-center justify-center rounded-md bg-black/60 border border-white/10 text-slate-300 hover:text-white hover:bg-black/80 transition-colors"
        title="Keyboard shortcuts (?)"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      <div
        className="absolute inset-0 flex items-center justify-center bg-[#06080c]"
        onClick={onTogglePlayback}
      >
        {isLoading ? (
          <div className="text-center pointer-events-none">
            <div className="w-10 h-10 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin mx-auto mb-2" />
            <span className="text-xs text-slate-500">Loading…</span>
          </div>
        ) : !videoPath ? (
          <div className="text-center pointer-events-none">
            <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3">
              <Play className="w-6 h-6 text-slate-500 ml-0.5" />
            </div>
            <p className="text-sm text-slate-400 mb-3">No match loaded</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onLoadVideoDirect();
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg uppercase tracking-wider transition-colors flex items-center gap-1.5 pointer-events-auto"
            >
              <Play className="w-3.5 h-3.5" /> Load Video
            </button>
          </div>
        ) : videoPath ? (
          <>
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              controls={false}
              preload="metadata"
              playsInline
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              onPlay={onVideoPlay}
              onPause={onVideoPause}
              onWaiting={onVideoWaiting}
              onPlaying={onVideoPlaying}
              onError={onVideoError}
            />
            {!isPlaying && !isBuffering && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-20 h-20 rounded-full bg-black/40 border border-white/20 backdrop-blur-md flex items-center justify-center transition-transform group-hover/player:scale-110">
                  <Play className="w-9 h-9 text-white ml-1" fill="white" />
                </div>
              </div>
            )}
            {isBuffering && isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-12 h-12 rounded-full border-[3px] border-white/15 border-t-white/80 animate-spin" />
              </div>
            )}
            {videoError && (
              <div className="absolute top-12 left-3 right-3 z-10 flex items-start justify-between">
                <div
                  className={`px-3 py-2 rounded-lg border max-w-sm backdrop-blur ${isConverting ? "bg-indigo-900/80 border-indigo-500/30" : "bg-rose-900/80 border-rose-500/30"}`}
                >
                  <p
                    className={`text-xs ${isConverting ? "text-indigo-100" : "text-rose-100"}`}
                  >
                    {videoError}
                  </p>
                  {!isConverting && videoPath.endsWith(".mkv") && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConvertVideo();
                      }}
                      className="mt-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded uppercase tracking-wider transition-colors flex items-center gap-1.5"
                    >
                      Prepare MP4
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setVideoError("");
                  }}
                  className="text-slate-300 hover:text-white p-1 bg-black/60 border border-white/10 rounded"
                >
                  <span className="text-xs">×</span>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center">
            <Play className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <span className="text-xs text-slate-500">
              No video for this segment
            </span>
          </div>
        )}
      </div>

      {creatingSegment && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 bg-indigo-600/95 border border-indigo-400/40 rounded-full text-[10px] font-bold uppercase tracking-widest text-white shadow-lg shadow-indigo-600/30 flex items-center gap-2 backdrop-blur">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
          New Segment · drag on timeline
        </div>
      )}

      {creatingSegment && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 bg-emerald-600/95 border border-emerald-400/40 rounded-full text-[10px] font-bold text-white shadow-lg flex items-center gap-2 backdrop-blur">
          <Check className="w-3 h-3" />
          <span className="font-mono normal-case">
            {formatSec(Math.min(creatingSegment.start, creatingSegment.end))} →{" "}
            {formatSec(Math.max(creatingSegment.start, creatingSegment.end))} ·{" "}
            {Math.abs(creatingSegment.end - creatingSegment.start).toFixed(1)}s
          </span>
          <button
            type="button"
            onClick={onConfirmSegmentCreate}
            className="ml-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-white"
            title="Add this segment (Enter)"
          >
            Add Segment
          </button>
          <button
            type="button"
            onClick={onCancelSegmentCreate}
            className="ml-1 text-white/70 hover:text-white"
            title="Cancel (Esc)"
          >
            ×
          </button>
        </div>
      )}

      <div
        className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <div className="bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-6 pb-3 px-4">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={onStartSegmentCreate}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${creatingSegment ? "bg-indigo-500/30 text-indigo-200 border border-indigo-500/50" : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"}`}
              title="Drag on the timeline to define a new segment (N)"
            >
              <Plus className="w-3 h-3" /> New Segment
            </button>
            {/* Set segment start / end at playhead */}
            <button
              type="button"
              onClick={onSetSegmentStart}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors"
              title="Set segment start at playhead (I)"
            >
              <SkipBack className="w-3 h-3" /> Start
            </button>
            <button
              type="button"
              onClick={onSetSegmentEnd}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors"
              title="Set segment end at playhead (O)"
            >
              <SkipForward className="w-3 h-3" /> End
            </button>
            <button
              type="button"
              onClick={onReplayClip}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors"
              title="Replay from start"
            >
              <Flag className="w-3 h-3" /> Replay
            </button>
          </div>
          {/* Current segment time display */}
          {currentClip && (
            <div className="flex items-center gap-2 mb-1 text-[9px] text-slate-400 font-mono">
              <span className="text-emerald-300">S: {startTime}</span>
              <span className="text-slate-600">→</span>
              <span className="text-amber-300">E: {endTime}</span>
              <span className="text-slate-500 ml-1">
                ({segmentDurationStr(currentClip)})s
              </span>
            </div>
          )}
          <div className="relative mb-2">
            <div
              ref={progressBarRef}
              className={`h-7 bg-white/[0.04] hover:bg-white/[0.07] rounded-md overflow-visible relative transition-colors ${creatingSegment ? "cursor-crosshair" : "cursor-pointer"}`}
              onClick={handleProgressMouseDown}
              onMouseMove={handleProgressHover}
              onMouseLeave={() => {
                setHoverTime(null);
              }}
            >
              {/* Existing segments */}
              {clips.map((clip) => {
                const left = pct(clip.annotation_start);
                const width = pct(clip.annotation_end - clip.annotation_start);
                const isActive = currentClip?.clip_id === clip.clip_id;
                const state = getAnnotatorState(clip);
                return (
                  <div
                    key={clip.clip_id}
                    className={`absolute top-1 bottom-1 rounded ${STATE_COLORS[state] || "bg-slate-500/30"} ${isActive ? "ring-1 ring-white/40" : ""}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${clip.clip_id} (${state})`}
                  />
                );
              })}

              {/* Live drag preview */}
              {dragPreviewStart !== null && dragPreviewEnd !== null && (
                <div
                  className="absolute top-0 bottom-0 bg-indigo-400/30 border-x-2 border-indigo-300 pointer-events-none"
                  style={{
                    left: `${pct(dragPreviewStart)}%`,
                    width: `${pct(dragPreviewEnd - dragPreviewStart)}%`,
                  }}
                />
              )}

              {/* Confirmed creatingSegment preview */}
              {creatingSegment && (
                <div
                  className="absolute top-0 bottom-0 bg-emerald-400/30 border-x-2 border-emerald-300"
                  style={{
                    left: `${pct(Math.min(creatingSegment.start, creatingSegment.end))}%`,
                    width: `${pct(Math.abs(creatingSegment.end - creatingSegment.start))}%`,
                  }}
                />
              )}

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)] pointer-events-none"
                style={{ left: `${pct(videoCurrentTime)}%` }}
              />

              {/* Boundary drag handles for active clip */}
              {currentClip &&
                (() => {
                  const left = pct(currentClip.annotation_start);
                  const right = pct(currentClip.annotation_end);
                  return (
                    <>
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-white/70 hover:bg-white cursor-ew-resize z-10"
                        style={{ left: `${left}%` }}
                        onMouseDown={(e) =>
                          handleEdgeMouseDown(e, currentClip.clip_id, "start")
                        }
                        title="Drag to move start"
                      />
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-white/70 hover:bg-white cursor-ew-resize z-10"
                        style={{ left: `${right}%` }}
                        onMouseDown={(e) =>
                          handleEdgeMouseDown(e, currentClip.clip_id, "end")
                        }
                        title="Drag to move end"
                      />
                    </>
                  );
                })()}

              {/* Hover tooltip */}
              {hoverTime !== null && !creatingSegment && (
                <div
                  className="absolute -top-1 px-1.5 py-0.5 bg-black/80 text-[10px] font-mono rounded text-white pointer-events-none -translate-x-1/2"
                  style={{ left: `${pct(hoverTime)}%` }}
                >
                  {formatSec(hoverTime)}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-300 font-mono">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onTogglePlayback}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white"
                title="Play / pause (Space)"
              >
                {isPlaying ? (
                  <Pause className="w-3.5 h-3.5" fill="white" />
                ) : (
                  <Play className="w-3.5 h-3.5 ml-0.5" fill="white" />
                )}
              </button>
              <button
                type="button"
                onClick={onToggleMute}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white"
                title="Mute (U)"
              >
                {isMuted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={onCycleSpeed}
                className="px-2 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold"
                title="Cycle playback speed"
              >
                {playbackRate}×
              </button>
              <span className="ml-2 text-slate-400">
                {formatSec(videoCurrentTime)} / {formatSec(matchDurationSec)}
              </span>
              <span className="ml-1 text-slate-500">· {liveMatchClock}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleLoop()}
                className={`w-7 h-7 flex items-center justify-center rounded-md text-[10px] font-bold ${loopClip ? "bg-indigo-500/30 text-indigo-200" : "bg-white/5 hover:bg-white/10 text-slate-300"}`}
                title="Loop clip"
              >
                ⟲
              </button>
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white"
                title="Fullscreen (F)"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function segmentDurationStr(clip: Clip): string {
  const dur = clip.annotation_end - clip.annotation_start;
  return dur.toFixed(1);
}
