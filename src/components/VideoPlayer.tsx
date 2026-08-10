"use client";

import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Flag,
  HelpCircle,
  SkipForward,
  FolderOpen,
} from "lucide-react";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Clip, AnnotatorState } from "@/lib/constants";
import { formatMatchClock, formatSec } from "@/lib/utils";
import { getIntentGroupHex } from "@/lib/constants";

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
  convertProgress: number;
  creatingSegment: CreatingSegment;
  onTogglePlayback: () => void;
  onReplayClip: () => void;
  onToggleFullscreen: () => void;
  onProgressClick: (timeSec: number) => void;
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

  // Optional annotations & add contiguous segment callbacks
  annotations?: any[];
  onAddNextSegment?: (start: number, end: number) => void;
  onTimeUpdate?: () => void;
}

const STATE_COLORS: Record<string, string> = {
  accepted: "bg-emerald-500/70",
  modified: "bg-amber-500/60",
  rejected: "bg-slate-500/25",
  manual: "bg-emerald-500/85",
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
    onUpdateSegmentDraft,
    onHelp,
    getAnnotatorState,
    formatTime,
    setVideoError,
    onSetSegmentStart,
    onSetSegmentEnd,
    onFileDrop,
    annotations,
    onAddNextSegment,
    onTimeUpdate,
  } = props;
  const convertProgress = props.convertProgress ?? 0;

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

  const macroBarRef = useRef<HTMLDivElement>(null);
  const zoomProgressBarRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [draggingEdge, setDraggingEdge] = useState<{
    clipId: string;
    edge: "start" | "end";
  } | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local drag state for "+ New Segment" mode
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

  // Viewport center / span config for the Precision Zoom timeline
  const zoomWindow = 30; // 30 seconds viewport span
  const zoomStart = Math.max(
    0,
    Math.min(matchDurationSec - zoomWindow, videoCurrentTime - zoomWindow / 2),
  );
  const zoomEnd = Math.min(matchDurationSec, zoomStart + zoomWindow);

  // Boundary drag for existing clips inside the zoomed viewport coordinates
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
      if (!zoomProgressBarRef.current) return;
      const rect = zoomProgressBarRef.current.getBoundingClientRect();
      const fraction = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      const timeSec = zoomStart + fraction * zoomWindow;
      const clip = clips.find((c) => c.clip_id === draggingEdge.clipId);
      if (!clip) return;
      const deltaSec =
        draggingEdge.edge === "start"
          ? timeSec - clip.annotation_start
          : timeSec - clip.annotation_end;

      const snappedDelta = Math.round(deltaSec * 2) / 2; // snap to nearest 0.5s for precise feedback
      if (Math.abs(snappedDelta) >= 0.5) {
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
  }, [draggingEdge, clips, zoomStart, zoomWindow, onBoundaryNudge]);

  const pct = (sec: number) =>
    Math.max(0, Math.min(100, (sec / matchDurationSec) * 100));

  const liveMatchClock = useMemo(
    () => formatMatchClock(currentClip?.half ?? 1, videoCurrentTime),
    [currentClip?.half, videoCurrentTime],
  );

  // Hover indicator time calculation relative to zoomed viewport
  const handleZoomProgressHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!zoomProgressBarRef.current) return;
      const rect = zoomProgressBarRef.current.getBoundingClientRect();
      const fraction = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      setHoverTime(zoomStart + fraction * zoomWindow);
    },
    [zoomStart, zoomWindow],
  );

  // Click on Overview Macro Bar (percentage of whole match)
  const handleMacroBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!macroBarRef.current) return;
      const rect = macroBarRef.current.getBoundingClientRect();
      const fraction = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      onProgressClick(fraction * matchDurationSec);
    },
    [matchDurationSec, onProgressClick],
  );

  // Click / Drag Start on Precision Zoom Bar
  const handleZoomBarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!zoomProgressBarRef.current) return;
      const rect = zoomProgressBarRef.current.getBoundingClientRect();
      const fraction = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      const clickTime = zoomStart + fraction * zoomWindow;

      if (creatingSegment) {
        setDragStart(clickTime);
        setDragCurrent(clickTime);
      } else {
        onProgressClick(clickTime);
      }
    },
    [zoomStart, zoomWindow, creatingSegment, onProgressClick],
  );

  useEffect(() => {
    if (dragStart === null) return;
    const onMove = (e: MouseEvent) => {
      if (!zoomProgressBarRef.current) return;
      const rect = zoomProgressBarRef.current.getBoundingClientRect();
      const fraction = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      setDragCurrent(zoomStart + fraction * zoomWindow);
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
  }, [dragStart, dragCurrent, zoomStart, zoomWindow, onUpdateSegmentDraft]);

  // Live preview of the drag range
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

  // Grid tick generation (ticks every 5 seconds inside the viewport)
  const ticks = useMemo(() => {
    const list: number[] = [];
    const firstTick = Math.ceil(zoomStart / 5) * 5;
    for (let t = firstTick; t <= zoomEnd; t += 5) {
      list.push(t);
    }
    return list;
  }, [zoomStart, zoomEnd]);

  // Contiguous ghost next segment placeholder
  const ghostNextSegment = useMemo(() => {
    if (!currentClip || currentClip.clip_id === "Draft Segment") return null;
    const end = currentClip.annotation_end;

    // Check if there is already an annotated segment immediately ahead
    const buffer = 0.5;
    const hasOverlap = clips.some(
      (c) =>
        c.clip_id !== currentClip.clip_id &&
        c.annotation_start >= end &&
        c.annotation_start < end + buffer,
    );
    if (hasOverlap) return null;

    const ghostStart = end;
    const ghostEnd = Math.min(matchDurationSec, ghostStart + 5.0);
    if (ghostEnd - ghostStart < 1.0) return null;

    return { start: ghostStart, end: ghostEnd };
  }, [currentClip, clips, matchDurationSec]);

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
          <p className="text-sm font-semibold text-indigo-200">
            Drop video here to load
          </p>
          <p className="text-xs text-indigo-400 mt-1">
            Supports MP4, MKV, etc.
          </p>
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
            <p className="text-sm text-slate-400">No match loaded</p>
          </div>
        ) : videoPath ? (
          <>
            <video
              ref={videoRef}
              className="w-full h-full object-contain cursor-pointer"
              controls={false}
              preload="metadata"
              playsInline
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              onClick={onTogglePlayback}
              onPlay={onVideoPlay}
              onPause={onVideoPause}
              onWaiting={onVideoWaiting}
              onPlaying={onVideoPlaying}
              onError={onVideoError}
              onTimeUpdate={onTimeUpdate}
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
            {(videoError || isConverting) && (
              <div className="absolute top-12 left-3 right-3 z-10 flex items-start justify-between">
                <div
                  className={`px-3 py-2 rounded-lg border max-w-sm backdrop-blur w-full ${isConverting ? "bg-indigo-900/80 border-indigo-500/30" : "bg-rose-900/80 border-rose-500/30"}`}
                >
                  <p
                    className={`text-xs ${isConverting ? "text-indigo-100" : "text-rose-100"}`}
                  >
                    {isConverting
                      ? videoError ||
                        "Preparing browser-ready MP4… starting conversion."
                      : videoError}
                  </p>
                  {isConverting && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[9px] text-indigo-300 mb-1">
                        <span>Converting…</span>
                        <span>{convertProgress}%</span>
                      </div>
                      <div className="h-1.5 bg-indigo-950 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-400 to-emerald-400 rounded-full transition-all duration-500"
                          style={{ width: `${convertProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {!isConverting && videoPath?.endsWith(".mkv") && (
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
                  className="text-slate-300 hover:text-white p-1 bg-black/60 border border-white/10 rounded ml-2 flex-shrink-0"
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

      <div
        className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <div className="bg-gradient-to-t from-black/95 via-black/80 to-transparent pt-6 pb-3 px-4">
          <div className="flex items-center gap-2 mb-2">
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
              <span className="text-slate-500 ml-1 font-semibold">
                ({segmentDurationStr(currentClip)})s
              </span>
            </div>
          )}

          {/* DUAL TIMELINE SYSTEM */}
          <div className="space-y-2.5 mb-2 select-none">
            {/* 1. Macro Overview Timeline */}
            <div className="relative">
              <div
                ref={macroBarRef}
                className="h-2 bg-white/[0.04] hover:bg-white/[0.07] rounded-full relative cursor-pointer transition-colors overflow-hidden"
                onClick={handleMacroBarClick}
                title="Click to seek coarse timeline"
              >
                {/* Viewport Range Overlay representing zoomed viewport */}
                <div
                  className="absolute top-0 bottom-0 bg-indigo-500/25 border-x border-indigo-500/40"
                  style={{
                    left: `${(zoomStart / matchDurationSec) * 100}%`,
                    width: `${(zoomWindow / matchDurationSec) * 100}%`,
                  }}
                />

                {/* Plots of segments as tiny dots */}
                {clips.map((clip) => {
                  const left = pct(clip.annotation_start);
                  const width = pct(
                    clip.annotation_end - clip.annotation_start,
                  );
                  const isActive = currentClip?.clip_id === clip.clip_id;
                  const state = getAnnotatorState(clip);
                  return (
                    <div
                      key={`macro-${clip.clip_id}`}
                      className={`absolute top-0 bottom-0 ${
                        isActive
                          ? "bg-white z-10"
                          : STATE_COLORS[state] || "bg-slate-500/30"
                      }`}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(0.5, width)}%`,
                      }}
                    />
                  );
                })}

                {/* Macro playhead */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                  style={{ left: `${pct(videoCurrentTime)}%` }}
                />
              </div>
            </div>

            {/* 2. Precision Zoomed Timeline */}
            <div className="relative">
              <div
                ref={zoomProgressBarRef}
                className={`h-12 bg-[#090b0e]/90 rounded-xl border border-white/5 overflow-hidden relative ${creatingSegment ? "cursor-crosshair" : "cursor-pointer"}`}
                onMouseDown={handleZoomBarMouseDown}
                onMouseMove={handleZoomProgressHover}
                onMouseLeave={() => setHoverTime(null)}
              >
                {/* Second Grid Ticks */}
                {ticks.map((t) => {
                  const pctZoom = ((t - zoomStart) / zoomWindow) * 100;
                  return (
                    <div
                      key={`tick-${t}`}
                      className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                      style={{ left: `${pctZoom}%` }}
                    >
                      <div className="w-[1px] h-1.5 bg-white/10" />
                      <span className="text-[8px] text-slate-600 font-mono mt-0.5 font-medium leading-none">
                        {formatTime(t)}
                      </span>
                      <div className="w-[1px] flex-1 border-r border-dashed border-white/[0.02]" />
                    </div>
                  );
                })}

                {/* Plot Zoomed Segments */}
                {clips.map((clip) => {
                  const start = clip.annotation_start;
                  const end = clip.annotation_end;
                  if (end < zoomStart || start > zoomEnd) return null;

                  const left = ((start - zoomStart) / zoomWindow) * 100;
                  const width = ((end - start) / zoomWindow) * 100;
                  const isActive = currentClip?.clip_id === clip.clip_id;
                  const state = getAnnotatorState(clip);

                  // Extract intent labels to show color coding & text on block
                  const ann = annotations?.find(
                    (a) => a.clip_id === clip.clip_id,
                  );
                  const labelA = ann?.team_a?.label?.intent_class || "";
                  const labelB = ann?.team_b?.label?.intent_class || "";
                  const exclusionLabel = ann?.exclusion || "";

                  const hexA = labelA ? getIntentGroupHex(labelA) : null;
                  const hexB = labelB ? getIntentGroupHex(labelB) : null;
                  const hexExcl = exclusionLabel
                    ? getIntentGroupHex(exclusionLabel)
                    : null;

                  let blockStyle: React.CSSProperties = {};
                  if (hexExcl) {
                    blockStyle = {
                      background: `linear-gradient(135deg, ${hexExcl}20, ${hexExcl}0d)`,
                      borderColor: `${hexExcl}50`,
                      color: hexExcl,
                    };
                  } else if (hexA && hexB) {
                    blockStyle = {
                      background: `linear-gradient(90deg, ${hexA}20, ${hexB}20)`,
                      borderColor: `${hexA}45`,
                      borderRightColor: `${hexB}45`,
                    };
                  } else if (hexA) {
                    blockStyle = {
                      background: `linear-gradient(135deg, ${hexA}20, ${hexA}0d)`,
                      borderColor: `${hexA}50`,
                    };
                  } else if (hexB) {
                    blockStyle = {
                      background: `linear-gradient(135deg, ${hexB}20, ${hexB}0d)`,
                      borderColor: `${hexB}50`,
                    };
                  }

                  let labelText = "";
                  if (exclusionLabel) {
                    labelText = exclusionLabel;
                  } else if (labelA || labelB) {
                    labelText = `${labelA ? labelA : "-"} / ${labelB ? labelB : "-"}`;
                  } else {
                    labelText = "Unlabelled";
                  }

                  return (
                    <div
                      key={`zoom-${clip.clip_id}`}
                      className={`absolute top-1.5 bottom-1.5 rounded-lg border flex flex-col justify-center px-2 select-none ${
                        isActive
                          ? "ring-2 ring-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.25)]"
                          : "opacity-60 hover:opacity-90"
                      }`}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        ...blockStyle,
                      }}
                      title={`${clip.clip_id} (${state})`}
                    >
                      <span className="text-[9px] font-bold text-white truncate max-w-full leading-none mb-0.5">
                        {labelText}
                      </span>
                      <span className="text-[7px] text-slate-400 font-mono truncate max-w-full leading-none">
                        {formatTime(start)} - {formatTime(end)}
                      </span>

                      {/* Boundary drag handles for active segment */}
                      {isActive && (
                        <>
                          <div
                            className="absolute top-0 bottom-0 -left-1 w-2 cursor-ew-resize flex items-center justify-center group/handle z-10"
                            onMouseDown={(e) =>
                              handleEdgeMouseDown(e, clip.clip_id, "start")
                            }
                            title="Drag to change segment start"
                          >
                            <div className="w-[3px] h-3/5 bg-indigo-400 rounded-full group-hover/handle:bg-indigo-300 transition-colors shadow" />
                          </div>
                          <div
                            className="absolute top-0 bottom-0 -right-1 w-2 cursor-ew-resize flex items-center justify-center group/handle z-10"
                            onMouseDown={(e) =>
                              handleEdgeMouseDown(e, clip.clip_id, "end")
                            }
                            title="Drag to change segment end"
                          >
                            <div className="w-[3px] h-3/5 bg-indigo-400 rounded-full group-hover/handle:bg-indigo-300 transition-colors shadow" />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Ghost contiguous segment "+ Next Segment" placeholder */}
                {ghostNextSegment && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onAddNextSegment) {
                        onAddNextSegment(
                          ghostNextSegment.start,
                          ghostNextSegment.end,
                        );
                      }
                    }}
                    className="absolute top-1.5 bottom-1.5 rounded-lg border border-dashed border-indigo-500/35 bg-indigo-500/5 hover:bg-indigo-500/15 hover:border-indigo-400 flex flex-col justify-center items-center cursor-pointer transition-all px-2 select-none group/ghost text-indigo-300/80"
                    style={{
                      left: `${((ghostNextSegment.start - zoomStart) / zoomWindow) * 100}%`,
                      width: `${((ghostNextSegment.end - ghostNextSegment.start) / zoomWindow) * 100}%`,
                    }}
                    title="Click to instantly create next contiguous segment"
                  >
                    <span className="text-[9px] font-bold tracking-wide leading-none mb-0.5">
                      + Next Segment
                    </span>
                    <span className="text-[7px] opacity-60 font-mono leading-none">
                      {formatTime(ghostNextSegment.start)} -{" "}
                      {formatTime(ghostNextSegment.end)}
                    </span>
                  </div>
                )}

                {/* Live drag preview */}
                {dragPreviewStart !== null && dragPreviewEnd !== null && (
                  <div
                    className="absolute top-1 bottom-1 bg-indigo-400/20 border-x border-indigo-400/50 pointer-events-none"
                    style={{
                      left: `${((dragPreviewStart - zoomStart) / zoomWindow) * 100}%`,
                      width: `${((dragPreviewEnd - dragPreviewStart) / zoomWindow) * 100}%`,
                    }}
                  />
                )}

                {/* Confirmed creatingSegment preview */}
                {creatingSegment && (
                  <div
                    className="absolute top-1 bottom-1 bg-emerald-400/20 border-x border-emerald-400/50 pointer-events-none"
                    style={{
                      left: `${((Math.min(creatingSegment.start, creatingSegment.end) - zoomStart) / zoomWindow) * 100}%`,
                      width: `${((Math.max(creatingSegment.start, creatingSegment.end) - Math.min(creatingSegment.start, creatingSegment.end)) / zoomWindow) * 100}%`,
                    }}
                  />
                )}

                {/* Zoom Playhead bar (Red glow line) */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 shadow-[0_0_8px_rgba(239,68,68,0.8)] pointer-events-none"
                  style={{
                    left: `${((videoCurrentTime - zoomStart) / zoomWindow) * 100}%`,
                  }}
                />

                {/* Zoom hover guide line */}
                {hoverTime !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-[1px] bg-white/20 border-r border-dashed border-white/20 pointer-events-none"
                    style={{
                      left: `${((hoverTime - zoomStart) / zoomWindow) * 100}%`,
                    }}
                  />
                )}
              </div>

              {/* Hover time tooltip overlay */}
              {hoverTime !== null && (
                <div
                  className="absolute -top-6 px-1.5 py-0.5 bg-black/90 border border-white/10 text-[9px] font-mono rounded text-white pointer-events-none -translate-x-1/2 z-30 shadow-lg"
                  style={{
                    left: `${((hoverTime - zoomStart) / zoomWindow) * 100}%`,
                  }}
                >
                  {formatTime(hoverTime)} ({hoverTime.toFixed(1)}s)
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-300 font-mono">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onTogglePlayback}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
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
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
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
                className="px-2 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold transition-colors"
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
                className={`w-7 h-7 flex items-center justify-center rounded-md text-[10px] font-bold transition-colors ${loopClip ? "bg-indigo-500/30 text-indigo-200" : "bg-white/5 hover:bg-white/10 text-slate-300"}`}
                title="Loop clip"
              >
                ⟲
              </button>
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
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
