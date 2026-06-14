"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import Header from "./Header";
import ClipExplorer from "./ClipExplorer";
import VideoPlayer from "./VideoPlayer";
import IntentLabels from "./IntentLabels";
import AnnotationPanel from "./AnnotationPanel";
import CoverageMeter, { type CoverageStats } from "./CoverageMeter";
import SplitPrompt from "./SplitPrompt";
import {
  TACTIC_INTENTS,
  HOTKEY_MAP,
  getIntentLabel,
  getIntentId,
  isExclusionIntent,
  isAttackIntent,
  isDefenseIntent,
  isSetPieceIntent,
  HALF_LABEL,
  normalizeClip,
  makeUniqueClipIds,
  MATCH_PLAN_TOTAL,
  type Certainty,
  type Clip,
  type Annotation,
  type GameState,
  type TeamConfig,
  type AnnotatorState,
} from "@/lib/constants";

import { formatTime, formatMatchClock } from "@/lib/utils";
import { MAX_SEGMENT_DURATION } from "@/lib/constants";

const SERVER_URL = "/api";
const DEFAULT_TEAM_CONFIG: { team_a: TeamConfig; team_b: TeamConfig } = {
  team_a: { id: "A", name: "Team A", jersey_color: "#ef233c", is_home: true },
  team_b: { id: "B", name: "Team B", jersey_color: "#3b82f6", is_home: false },
};

const DEFAULT_GAME_STATE: GameState = {
  half: "1st",
  match_clock_sec: 0,
  score_home: 0,
  score_away: 0,
};
const MATCH_DURATION_SEC = 90 * 60;

function mp4Candidates(videoPath: string): string[] {
  if (!videoPath.toLowerCase().endsWith(".mkv")) return [videoPath];
  const withoutExt = videoPath.replace(/\.mkv$/i, "");
  return [`${withoutExt}_720p.mp4`, `${withoutExt}.mp4`];
}

async function resolveBrowserVideoPaths(clips: Clip[]): Promise<Clip[]> {
  const resolved = new Map<string, string>();
  const uniqueMkvPaths = Array.from(
    new Set(
      clips
        .map((clip) => clip.path)
        .filter((p) => p.toLowerCase().endsWith(".mkv")),
    ),
  );

  await Promise.all(
    uniqueMkvPaths.map(async (mkvPath) => {
      for (const candidate of mp4Candidates(mkvPath)) {
        try {
          const head = await fetch(`${SERVER_URL}/videos/${candidate}`, {
            method: "HEAD",
          });
          if (head.ok) {
            resolved.set(mkvPath, candidate);
            return;
          }
        } catch {}
      }
    }),
  );

  return clips.map((clip) =>
    resolved.has(clip.path)
      ? { ...clip, path: resolved.get(clip.path)! }
      : clip,
  );
}

function parseClockSeconds(clock?: string): number | null {
  if (!clock) return null;
  const parts = clock.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function defaultGameStateForClip(clip?: Clip, previous?: GameState): GameState {
  return {
    half: clip
      ? (HALF_LABEL(clip.half) as GameState["half"])
      : previous?.half || "1st",
    match_clock_sec: Math.round(
      parseClockSeconds(clip?.game_clock) ??
        clip?.annotation_start ??
        clip?.start ??
        previous?.match_clock_sec ??
        0,
    ),
    score_home: previous?.score_home ?? 0,
    score_away: previous?.score_away ?? 0,
  };
}

function modelCertainty(confidence: number): "low" | "medium" | "high" {
  if (confidence <= 2) return "low";
  if (confidence === 3) return "medium";
  return "high";
}

// Padding mask: always 150 elements. The first `tensorFrames` entries are
// 1 (real frame) and the rest are 0 (padded, masked out by the model).
// Without this distinction the model treats padded slots as real frames.
const PADDING_MASK_LENGTH = 150;
const buildPaddingMask = (tensorFrames: number) => {
  const realFrames = Math.max(0, Math.min(tensorFrames, PADDING_MASK_LENGTH));
  return Array.from({ length: PADDING_MASK_LENGTH }, (_, i) => i < realFrames);
};

// NPZ path is built deterministically from match + clip id so the export
// always points at the right trajectory file, regardless of the manifest.
const buildNpzPath = (clip: Clip) => {
  const matchId = clip.match_id || "unknown";
  return `data/trajectories/${matchId}/${clip.clip_id}.npz`;
};

// Returns the first clip that would overlap with [newStart, newEnd), excluding
// the clip with `excludeClipId` if provided. Returns null if no overlap.
function findOverlap(
  clips: Clip[],
  newStart: number,
  newEnd: number,
  excludeClipId?: string,
): Clip | null {
  return (
    clips.find(
      (c) =>
        c.clip_id !== excludeClipId &&
        newStart < c.annotation_end &&
        newEnd > c.annotation_start,
    ) ?? null
  );
}

export default function AnnotatorClient() {
  // ─── State declarations (all hooks must be at top level) ───

  // Annotation form state
  const [currentTeam, setCurrentTeam] = useState<"A" | "B">("A");
  const [confidence, setConfidence] = useState(4);
  const [confidenceA, setConfidenceA] = useState(4);
  const [confidenceB, setConfidenceB] = useState(4);
  const [certaintyA, setCertaintyA] = useState<Certainty>("high");
  const [certaintyB, setCertaintyB] = useState<Certainty>("high");
  const [coverageEstimate, setCoverageEstimate] = useState(95);
  const [isMixedPhase, setIsMixedPhase] = useState(false);
  const [segmentAdjustTenths, setSegmentAdjustTenths] = useState(0);
  const [breakAcknowledgedAt, setBreakAcknowledgedAt] = useState(0);
  const [selectedIntentA, setSelectedIntentA] = useState("");
  const [selectedIntentB, setSelectedIntentB] = useState("");
  const [isUncertain, setIsUncertain] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [teamConfig, setTeamConfig] = useState(DEFAULT_TEAM_CONFIG);
  const [gameState, setGameState] = useState<GameState>(DEFAULT_GAME_STATE);
  // User-selected possession for the current segment:
  // "A" | "B" | "contested" | null (null = follow trajectory-detected team)
  const [manualPossession, setManualPossession] = useState<
    "A" | "B" | "contested" | null
  >(null);

  // Core data state
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeVideoPath, setActiveVideoPath] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [loopClip, setLoopClip] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [isConverting, setIsConverting] = useState(false);

  // Video state
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const loadedVideoPathRef = useRef("");
  const videoAbortRef = useRef<AbortController | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Actual video duration (updated from <video>.duration once metadata loads).
  // Falls back to the hardcoded MATCH_DURATION_SEC for the match plan.
  const [videoDurationSec, setVideoDurationSec] = useState(MATCH_DURATION_SEC);

  // New segment workflow: drag on the timeline to set start + end.
  // { start, end } are both match-seconds.
  const [creatingSegment, setCreatingSegment] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // UI state
  const [showHelp, setShowHelp] = useState(false);
  const [recentlyCreatedClipId, setRecentlyCreatedClipId] = useState<
    string | null
  >(null);

  // Clip explorer state
  const [clipFilter, setClipFilter] = useState<"all" | "todo" | "done">("all");
  const [clipSearch, setClipSearch] = useState("");
  const clipListRef = useRef<HTMLDivElement>(null);

  // Refs for keyboard handler stability
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const currentTeamRef = useRef(currentTeam);
  currentTeamRef.current = currentTeam;
  const annotationStartTimeRef = useRef(Date.now());
  const isBlobVideoRef = useRef(false);

  // ─── Derived state ───
  const currentClip = clips[currentClipIndex];
  const activeConfidence = currentTeam === "A" ? confidenceA : confidenceB;
  const activeCertainty = currentTeam === "A" ? certaintyA : certaintyB;
  const segmentDuration = currentClip
    ? currentClip.annotation_end - currentClip.annotation_start
    : 0;
  const tensorFrameCount = Math.max(
    20,
    Math.min(2000, Math.round(Math.max(0, segmentDuration) * 10)),
  );
  const maxSplitFrame = Math.max(2, tensorFrameCount);
  const hasAnnotated = useCallback(
    (clipId: string) => annotations.some((a) => a.clip_id === clipId),
    [annotations],
  );
  const detectedPossessionTeam = useMemo<"A" | "B" | null>(() => {
    const team = currentClip?.possession_state?.team;
    return team === "A" || team === "B" ? team : null;
  }, [currentClip]);
  // Effective possession combines the trajectory-detected team with the
  // annotator's manual override. "contested" is treated as a null (no
  // single team) for downstream checks, so cross-team attack-intent guards
  // stop blocking inputs in contested situations.
  const effectivePossessionTeam: "A" | "B" | null = useMemo(() => {
    if (manualPossession === "A" || manualPossession === "B")
      return manualPossession;
    if (manualPossession === "contested") return null;
    return detectedPossessionTeam;
  }, [manualPossession, detectedPossessionTeam]);
  const hasManualPossessionOverride = manualPossession !== null;
  const trackedPlayers = useMemo(() => {
    const coverage = currentClip?.tracking_coverage;
    if (!coverage) return 22;
    return Math.round((coverage.team_a_avg || 0) + (coverage.team_b_avg || 0));
  }, [currentClip]);
  const redTrackerCount = Math.max(0, 22 - trackedPlayers);
  const qualityPass =
    trackedPlayers >= 18 &&
    redTrackerCount <= 3 &&
    (currentClip?.quality_score ?? 1) >= 0.8;
  const sessionBreakDue =
    annotations.length > 0 &&
    annotations.length % 20 === 0 &&
    breakAcknowledgedAt !== annotations.length;
  const isContestedPossessionSuggested = useMemo(() => {
    if (!currentClip?.possession_state) return false;
    return (
      !detectedPossessionTeam || currentClip.possession_state.confidence < 0.55
    );
  }, [currentClip, detectedPossessionTeam]);

  // ─── Algorithm proposal / annotator decision callbacks ───
  const getAnnotatorState = useCallback((clip: Clip): AnnotatorState => {
    if (clip.is_locked) return clip.annotator_state || "accepted";
    if (!clip.algorithm_proposal) return "manual";
    if (clip.annotator_state === "accepted") return "accepted";
    if (clip.annotator_state === "modified") return "modified";
    if (clip.annotator_state === "rejected") return "rejected";
    return "unseen";
  }, []);

  const handleAcceptProposal = useCallback((clipId: string) => {
    setClips((prev) =>
      prev.map((clip) =>
        clip.clip_id === clipId
          ? {
              ...clip,
              annotator_state: "accepted" as AnnotatorState,
              is_locked: true,
            }
          : clip,
      ),
    );
    setStatusMessage(`Segment ${clipId} accepted and locked.`);
  }, []);

  const handleDeleteProposal = useCallback((clipId: string) => {
    setClips((prev) => {
      if (prev.length <= 1) {
        // If only one clip remains, just return empty array
        setAnnotations((anns) => anns.filter((a) => a.clip_id !== clipId));
        setStatusMessage(`Segment ${clipId} removed.`);
        return prev.filter((c) => c.clip_id !== clipId);
      }
      const idx = prev.findIndex((c) => c.clip_id === clipId);
      if (idx < 0) return prev;
      const clip = prev[idx];
      const neighbors = [...prev];
      if (idx > 0) {
        neighbors[idx - 1] = {
          ...neighbors[idx - 1],
          end: clip.end,
          annotation_end: clip.annotation_end,
          annotation_window:
            clip.annotation_end - neighbors[idx - 1].annotation_start,
        };
      } else if (idx < prev.length - 1) {
        neighbors[idx + 1] = {
          ...neighbors[idx + 1],
          start: clip.start,
          annotation_start: clip.annotation_start,
          annotation_window:
            neighbors[idx + 1].annotation_end - clip.annotation_start,
        };
      }
      const result = neighbors.filter((c) => c.clip_id !== clipId);
      setAnnotations((anns) => anns.filter((a) => a.clip_id !== clipId));
      setStatusMessage(`Segment ${clipId} removed. Gap filled by neighbors.`);
      return result;
    });
  }, []);

  const handleMerge = useCallback((clipId: string) => {
    setClips((prev) => {
      const idx = prev.findIndex((c) => c.clip_id === clipId);
      if (idx <= 0) return prev;
      const current = prev[idx];
      const previous = prev[idx - 1];
      const merged: Clip = {
        ...previous,
        end: current.end,
        annotation_end: current.annotation_end,
        annotation_window: current.annotation_end - previous.annotation_start,
        annotator_state: "modified" as AnnotatorState,
        is_locked: false,
      };
      setAnnotations((anns) =>
        anns.filter(
          (a) => a.clip_id !== clipId && a.clip_id !== previous.clip_id,
        ),
      );
      setStatusMessage(`Merged ${previous.clip_id} + ${clipId}.`);
      const result = [...prev];
      result[idx - 1] = merged;
      return result.filter((_, i) => i !== idx);
    });
  }, []);

  // ─── Save segment to server ───
  const saveSegmentToServer = useCallback((clip: Clip) => {
    fetch(`${SERVER_URL}/segments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clip),
    }).catch(() => console.warn("Failed to save segment to server"));
  }, []);

  // ─── New-segment workflow: drag on the timeline ───
  // The VideoPlayer emits the proposed start/end after a drag-release.
  // Here we just promote that draft into a real clip.
  const handleConfirmSegmentCreate = useCallback(() => {
    if (!creatingSegment) {
      setStatusMessage("Drag on the timeline to define a new segment first.");
      return;
    }
    const start = Math.min(creatingSegment.start, creatingSegment.end);
    const end = Math.max(creatingSegment.start, creatingSegment.end);
    const duration = end - start;
    if (duration < 2) {
      setStatusMessage("Segment must be at least 2 seconds long.");
      return;
    }
    if (duration > MAX_SEGMENT_DURATION) {
      setStatusMessage(
        `Segment cannot exceed ${MAX_SEGMENT_DURATION}s (got ${duration.toFixed(1)}s).`,
      );
      return;
    }
    const overlap = findOverlap(clips, start, end);
    if (overlap) {
      setStatusMessage(
        `Overlaps with segment ${overlap.clip_id} (${overlap.annotation_start.toFixed(1)}s–${overlap.annotation_end.toFixed(1)}s). Adjust boundaries.`,
      );
      setCreatingSegment(null);
      return;
    }
    const half = currentClip?.half ?? 1;
    const matchId = currentClip?.match_id ?? "manual";
    // Compute a sequential index for this segment based on its position
    // among all clips sorted by annotation_start. This produces readable,
    // training-friendly IDs like "match_001_seg014".
    const existingCount = clips.filter(
      (c) => c.annotation_start < start && c.match_id === matchId,
    ).length;
    const id = `${matchId}_seg${String(existingCount).padStart(3, "0")}`;
    const newClip: Clip = {
      clip_id: id,
      match_id: matchId,
      path: currentClip?.path ?? "",
      start: Math.max(0, start - 4),
      end: Math.min(videoDurationSec, end + 4),
      annotation_start: start,
      annotation_end: end,
      annotation_window: duration,
      half,
      game_clock: formatMatchClock(half, start),
      window_idx: currentClip?.window_idx,
      match_name: currentClip?.match_name,
      competition: currentClip?.competition,
      season: currentClip?.season,
      trajectory_path: currentClip?.trajectory_path,
      anchor_event: currentClip?.anchor_event,
      following_event: currentClip?.following_event,
      possession_state: currentClip?.possession_state,
      team_perspective: currentClip?.team_perspective,
      resolution: currentClip?.resolution,
      features: currentClip?.features,
      quality_score: currentClip?.quality_score,
      tracking_coverage: currentClip?.tracking_coverage,
      annotator_state: "manual" as AnnotatorState,
      is_locked: false,
    };
    setClips((prev) => {
      const next = [...prev, newClip].sort(
        (a, b) => a.annotation_start - b.annotation_start,
      );
      const newIdx = next.findIndex((c) => c.clip_id === id);
      if (newIdx >= 0) setCurrentClipIndex(newIdx);
      return next;
    });
    setCreatingSegment(null);
    setRecentlyCreatedClipId(id);
    setTimeout(() => setRecentlyCreatedClipId(null), 1500);
    // Persist the segment
    saveSegmentToServer(newClip);
    setStatusMessage(
      `New segment created (${duration.toFixed(1)}s). Pick intents for both teams, then Submit (Enter).`,
    );
  }, [creatingSegment, currentClip, videoDurationSec, saveSegmentToServer]);

  // Wrappers used by VideoPlayer (no-arg) so the player stays simple.
  const readPlayhead = useCallback((): number => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.currentTime)) return v.currentTime;
    return videoCurrentTime;
  }, [videoCurrentTime]);

  // ─── Set start / end at playhead (button + keyboard I/O) ───
  // When creatingSegment is active, these set the draft boundaries instead
  // of modifying the current clip. Each key independently sets its anchor
  // point at the playhead — no cross-constraint, no sentinel-value issues.
  // I key: auto-enter draft mode if not already, and set start boundary.
  // No separate M key press needed — I/O are the primary workflow.
  const handleSetSegmentStart = useCallback(() => {
    const t = readPlayhead();
    if (creatingSegment) {
      // Already in draft mode — set the draft start at playhead.
      // Leave the end unchanged if already set; else default to start+2.
      setCreatingSegment((prev) => {
        if (!prev) return { start: t, end: t + 2 };
        return { start: t, end: Math.max(prev.end, t + 2) };
      });
      setStatusMessage(`Start boundary set to ${formatTime(t)}`);
      return;
    }
    // Not in draft mode: auto-enter draft mode AND set start in one step.
    setCreatingSegment({ start: t, end: t + 2 });
    setStatusMessage(
      `Start boundary set to ${formatTime(t)}. Now press O to set end, then Enter to submit.`,
    );
  }, [creatingSegment, readPlayhead]);

  // O key: set the draft end and auto-confirm (create the clip).
  // No separate Enter press needed — O both sets the end and creates the segment.
  // Then the user picks intents and presses Enter to submit the annotation.
  const handleSetSegmentEnd = useCallback(() => {
    const t = readPlayhead();
    if (creatingSegment) {
      // Finalize the draft: set end and immediately confirm it into a real clip.
      const start = Math.min(
        creatingSegment.start,
        creatingSegment.start >= 0 ? creatingSegment.start : Math.max(0, t - 2),
      );
      const end = Math.max(t, start + 2);
      const duration = end - start;
      if (duration < 2) {
        setStatusMessage("Segment must be at least 2 seconds long.");
        return;
      }
      if (duration > MAX_SEGMENT_DURATION) {
        setStatusMessage(
          `Segment cannot exceed ${MAX_SEGMENT_DURATION}s (got ${duration.toFixed(1)}s).`,
        );
        return;
      }
      const overlap = findOverlap(clips, start, end);
      if (overlap) {
        setStatusMessage(
          `Overlaps with segment ${overlap.clip_id}. Adjust boundaries.`,
        );
        return;
      }
      const half = currentClip?.half ?? 1;
      const matchId = currentClip?.match_id ?? "manual";
      const existingCount = clips.filter(
        (c) => c.annotation_start < start && c.match_id === matchId,
      ).length;
      const id = `${matchId}_seg${String(existingCount).padStart(3, "0")}`;
      const newClip: Clip = {
        clip_id: id,
        match_id: matchId,
        path: currentClip?.path ?? "",
        start: Math.max(0, start - 4),
        end: Math.min(videoDurationSec, end + 4),
        annotation_start: start,
        annotation_end: end,
        annotation_window: duration,
        half,
        game_clock: formatMatchClock(half, start),
        window_idx: currentClip?.window_idx,
        match_name: currentClip?.match_name,
        competition: currentClip?.competition,
        season: currentClip?.season,
        trajectory_path: currentClip?.trajectory_path,
        anchor_event: currentClip?.anchor_event,
        following_event: currentClip?.following_event,
        possession_state: currentClip?.possession_state,
        team_perspective: currentClip?.team_perspective,
        resolution: currentClip?.resolution,
        features: currentClip?.features,
        quality_score: currentClip?.quality_score,
        tracking_coverage: currentClip?.tracking_coverage,
        annotator_state: "manual" as AnnotatorState,
        is_locked: false,
      };
      setClips((prev) => {
        const next = [...prev, newClip].sort(
          (a, b) => a.annotation_start - b.annotation_start,
        );
        const newIdx = next.findIndex((c) => c.clip_id === id);
        if (newIdx >= 0) setCurrentClipIndex(newIdx);
        return next;
      });
      setCreatingSegment(null);
      setRecentlyCreatedClipId(id);
      setTimeout(() => setRecentlyCreatedClipId(null), 1500);
      // Persist the segment
      saveSegmentToServer(newClip);
      setStatusMessage(
        `Segment created (${duration.toFixed(1)}s). Pick intents, then Submit (Enter).`,
      );
      return;
    }
    // Normal mode: edit current clip's annotation end
    if (!currentClip) return;
    const newEnd = Math.min(
      videoDurationSec,
      Math.max(t, currentClip.annotation_start + 2),
    );
    const newDuration = newEnd - currentClip.annotation_start;
    if (newDuration < 2) {
      setStatusMessage("Segment would be too short (< 2s).");
      return;
    }
    if (newDuration > MAX_SEGMENT_DURATION) {
      setStatusMessage(
        `Segment would exceed ${MAX_SEGMENT_DURATION}s (${newDuration.toFixed(1)}s).`,
      );
      return;
    }
    const overlap = findOverlap(
      clips,
      currentClip.annotation_start,
      newEnd,
      currentClip.clip_id,
    );
    if (overlap) {
      setStatusMessage(`End change overlaps with ${overlap.clip_id}.`);
      return;
    }
    setClips((prev) =>
      prev.map((clip, idx) =>
        idx !== currentClipIndex
          ? clip
          : {
              ...clip,
              annotation_end: newEnd,
              annotation_window: newEnd - clip.annotation_start,
              annotator_state:
                clip.annotator_state === "accepted"
                  ? "modified"
                  : clip.annotator_state,
            },
      ),
    );
    setStatusMessage(`Annotation end set to ${formatTime(newEnd)}`);
  }, [
    creatingSegment,
    currentClip,
    currentClipIndex,
    readPlayhead,
    videoDurationSec,
  ]);

  // New-segment workflow callbacks, passed to VideoPlayer.
  // Set to a minimal truthy sentinel so the UI shows "New Segment" mode badge.
  // Actual I/O key presses will set real start/end boundaries.
  // Toggle segment-creation mode on/off with M key.
  // If already creating, calling this again cancels it (acts as toggle).
  const handleStartSegmentCreate = useCallback(() => {
    setCreatingSegment((prev) => {
      if (prev) {
        setStatusMessage("Segment creation cancelled.");
        return null;
      }
      setStatusMessage(
        "Segment creation mode: use I/O to set boundaries, then Enter to confirm, N/Esc to cancel.",
      );
      return { start: -1, end: -1 };
    });
  }, []);
  const handleCancelSegmentCreate = useCallback(() => {
    setCreatingSegment(null);
    setStatusMessage("Segment creation cancelled.");
  }, []);
  const handleUpdateSegmentDraft = useCallback(
    (start: number, end: number) => setCreatingSegment({ start, end }),
    [],
  );

  // ─── Data Loading ───
  useEffect(() => {
    (async () => {
      try {
        // Load saved segments from server first
        const segRes = await fetch(`${SERVER_URL}/segments`);
        let userSegments: Clip[] = [];
        if (segRes.ok) {
          const segData = await segRes.json();
          if (segData.segments && segData.segments.length > 0) {
            userSegments = segData.segments;
          }
        }

        const manifestRes = await fetch(`${SERVER_URL}/manifest`);
        let manifestClips: Clip[] = [];
        if (manifestRes.ok) {
          const data = await manifestRes.json();
          let raw: any[] = [];
          if (Array.isArray(data) && data.length > 0 && data[0].clips) {
            data.forEach((m: any) => raw.push(...m.clips));
          } else if (Array.isArray(data)) raw = data;
          const normalized = await resolveBrowserVideoPaths(
            makeUniqueClipIds(raw.map(normalizeClip)),
          );
          manifestClips = normalized;
        }

        // Merge user-created segments with manifest clips
        const allClips = [...manifestClips, ...userSegments].sort(
          (a, b) => a.annotation_start - b.annotation_start,
        );
        if (allClips.length > 0) {
          setClips(allClips);
          setActiveVideoPath(allClips[0].path);
          setStatusMessage(`${allClips.length} clips loaded`);
        }

        const annRes = await fetch(`${SERVER_URL}/annotations`);
        if (annRes.ok) {
          const annData = await annRes.json();
          setAnnotations(
            (annData.annotations || []).filter(
              (a: any) => a && a.clip_id && a.video_source,
            ),
          );
          if (annData.team_config?.team_a && annData.team_config?.team_b)
            setTeamConfig(annData.team_config);
        }
      } catch {
        // Server might be starting — not an error, user can load video directly
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ─── Video seek on clip change ───
  useEffect(() => {
    const video = videoRef.current;
    const clip = clips[currentClipIndex];
    if (!video || !clip || !clip.path) return;
    setVideoError("");
    video.pause();

    // For blob URLs (direct video load), skip server URL construction
    if (isBlobVideoRef.current || clip.path.startsWith("blob:")) {
      isBlobVideoRef.current = true;
      if (video.src !== clip.path) {
        video.src = clip.path;
        video.load();
      }
      loadedVideoPathRef.current = clip.path;
      // Update clip end + actual duration from video metadata
      const onMeta = () => {
        video.currentTime = clip.start;
        video.playbackRate = playbackRate;
        video.play().catch(() => {});
        setVideoDurationSec(video.duration);
        setClips((prev) =>
          prev.map((c) =>
            c.clip_id === clip.clip_id ? { ...c, end: video.duration } : c,
          ),
        );
        video.removeEventListener("loadedmetadata", onMeta);
      };
      video.addEventListener("loadedmetadata", onMeta);
      setIsPlaying(true);
      setVideoCurrentTime(clip.start);
      return () => video.removeEventListener("loadedmetadata", onMeta);
    }

    if (clip.path.toLowerCase().endsWith(".mkv")) {
      video.removeAttribute("src");
      video.load();
      loadedVideoPathRef.current = "";
      setIsPlaying(false);
      setVideoCurrentTime(clip.start);
      setVideoError(
        "MKV needs a browser-ready MP4. Click Prepare MP4 once; the original MKV is kept.",
      );
      return;
    }
    let cancelled = false;
    const onSeeked = () => {
      if (!cancelled) video.play().catch(() => {});
    };
    const onLoadedMeta = () => {
      if (cancelled) return;
      setVideoDurationSec(video.duration);
      video.currentTime = clip.start;
      video.playbackRate = playbackRate;
      video.muted = isMuted;
      video.addEventListener("seeked", onSeeked, { once: true });
    };
    const videoPath = clip.path;
    const needsReload =
      loadedVideoPathRef.current !== videoPath ||
      video.error != null ||
      video.networkState === 3;
    if (needsReload) {
      loadedVideoPathRef.current = videoPath;
      video.src = `${SERVER_URL}/videos/${encodeURI(videoPath)}`;
      video.load();
      video.addEventListener("loadedmetadata", onLoadedMeta, { once: true });
    } else {
      onLoadedMeta();
    }
    setIsPlaying(true);
    setVideoCurrentTime(clip.start);
    return () => {
      cancelled = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onLoadedMeta);
    };
    // playbackRate + isMuted are applied imperatively on the element above
    // to avoid re-loading the video on every speed/mute change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClipIndex, clips]);

  // ─── Generate Manifest ───
  const handleGenerateManifest = async () => {
    setIsGenerating(true);
    setStatusMessage("Generating manifest from raw videos...");
    try {
      const res = await fetch(`${SERVER_URL}/pipeline/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_duration: 18,
          annotation_window: 10,
          step_duration: 10,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        setStatusMessage(
          `Generate failed: ${data?.error || `HTTP ${res.status}`}`,
        );
      else if (data.success && data.manifest) {
        const normalized = await resolveBrowserVideoPaths(
          makeUniqueClipIds((data.manifest || []).map(normalizeClip)),
        );
        setClips(normalized);
        if (normalized.length > 0) {
          setActiveVideoPath(normalized[0].path);
        }
        setCurrentClipIndex(0);
        loadedVideoPathRef.current = "";
        setStatusMessage(`Manifest generated: ${normalized.length} clips`);
      } else
        setStatusMessage(`Generate failed: ${data.error || "unknown error"}`);
    } catch (err: any) {
      setStatusMessage(`Generate failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Convert MKV to MP4 ───
  const handleConvertVideo = async () => {
    const clip = clips[currentClipIndex];
    if (!clip) return;
    const sourceName = clip.path.replace(/^raw_videos\//, "");
    setIsConverting(true);
    setVideoError(
      "Preparing browser-ready MP4... This may take a few minutes the first time.",
    );
    try {
      const res = await fetch(`${SERVER_URL}/videos/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceName }),
      });
      const data = await res.json();
      if (data.success && data.filename) {
        setVideoError("");
        setStatusMessage(data.message || `Video ready: ${data.filename}`);
        const newPath = `raw_videos/${data.filename}`;
        setClips((prev) =>
          prev.map((c) => (c.path === clip.path ? { ...c, path: newPath } : c)),
        );
        loadedVideoPathRef.current = "";
      } else setVideoError(data.detail || data.error || "Conversion failed");
    } catch (err: any) {
      setVideoError(`Conversion error: ${err.message}`);
    } finally {
      setIsConverting(false);
    }
  };

  // ─── Restore annotation state when clip changes ───
  useEffect(() => {
    if (!currentClip) return;
    annotationStartTimeRef.current = Date.now();
    const existing = annotations.find((a) => a.clip_id === currentClip.clip_id);
    if (existing) {
      setSelectedIntentA(
        getIntentId(existing.team_a?.label?.intent_class || ""),
      );
      setSelectedIntentB(
        getIntentId(existing.team_b?.label?.intent_class || ""),
      );
      setConfidenceA(existing.team_a?.label?.confidence || 4);
      setConfidenceB(existing.team_b?.label?.confidence || 4);
      setCertaintyA(
        (existing.team_a?.label?.certainty as Certainty) ||
          modelCertainty(existing.team_a?.label?.confidence || 4),
      );
      setCertaintyB(
        (existing.team_b?.label?.certainty as Certainty) ||
          modelCertainty(existing.team_b?.label?.confidence || 4),
      );
      setCoverageEstimate(
        Math.round(
          (existing.segment_metadata?.coverage_estimate ?? 0.95) * 100,
        ),
      );
      setIsMixedPhase(existing.segment_metadata?.is_mixed_phase || false);
      setSegmentAdjustTenths(0);
      setConfidence(existing.team_a?.label?.confidence || 4);
      setIsUncertain(existing.agreement?.flagged_review || false);
      setGameState(existing.game_state || defaultGameStateForClip(currentClip));
      // Reconstruct manualPossession from saved possession flags.
      const aPoss = existing.team_a?.possession === true;
      const bPoss = existing.team_b?.possession === true;
      if (aPoss && !bPoss) setManualPossession("A");
      else if (bPoss && !aPoss) setManualPossession("B");
      else if (!aPoss && !bPoss) setManualPossession("contested");
      else setManualPossession(null);
    } else {
      setSelectedIntentA("");
      setSelectedIntentB("");
      setConfidenceA(4);
      setConfidenceB(4);
      setConfidence(4);
      setCertaintyA("high");
      setCertaintyB("high");
      setCoverageEstimate(95);
      setIsMixedPhase(false);
      setSegmentAdjustTenths(0);
      setIsUncertain(false);
      setGameState((prev) => defaultGameStateForClip(currentClip, prev));
      setManualPossession(null);
    }
  }, [
    currentClipIndex,
    clips,
    annotations,
    currentClip,
    detectedPossessionTeam,
  ]);

  useEffect(() => {
    if (!gameState.dead_ball) return;
    setSelectedIntentA(getIntentId("DeadBall"));
    setSelectedIntentB(getIntentId("DeadBall"));
  }, [gameState.dead_ball]);

  useEffect(() => {
    if (isContestedPossessionSuggested) {
      setStatusMessage(
        "Possession looks contested from trajectory data. Consider ContestedPlay.",
      );
    }
  }, [isContestedPossessionSuggested, currentClip?.clip_id]);

  // ─── Video time update (rAF-throttled, no progress state) ───
  // We only need currentTime for the playhead. requestVideoFrameCallback
  // would be ideal, but rAF is the universal fallback and runs at the
  // display refresh rate — plenty smooth for a playhead.
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Imperatively push currentTime updates through rAF so React doesn't
  // re-render on every browser `timeupdate` event (~4 Hz).
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    const clip = clips[currentClipIndex];
    if (!video || !clip) return;
    if (rafRef.current) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const t = video.currentTime;
      setVideoCurrentTime(t);
      if (t >= clip.end) {
        if (loopClip) {
          video.currentTime = clip.start;
          video.play().catch(() => {});
        } else {
          video.pause();
          setIsPlaying(false);
        }
      }
    });
  }, [clips, currentClipIndex, loopClip]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) video.pause();
    else {
      const clip = clips[currentClipIndex];
      if (clip && video.currentTime >= clip.end) video.currentTime = clip.start;
      video.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, clips, currentClipIndex]);

  const replayClip = useCallback(() => {
    const video = videoRef.current;
    const clip = clips[currentClipIndex];
    if (video && clip) {
      video.currentTime = clip.start;
      video.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [clips, currentClipIndex]);

  const toggleFullscreen = useCallback(() => {
    if (videoContainerRef.current) {
      if (document.fullscreenElement) document.exitFullscreen();
      else videoContainerRef.current.requestFullscreen();
    }
  }, []);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const video = videoRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const matchTime = Math.max(
        0,
        Math.min(
          videoDurationSec,
          ((e.clientX - rect.left) / rect.width) * videoDurationSec,
        ),
      );
      const segmentIdx = clips.findIndex(
        (clip) =>
          matchTime >= clip.annotation_start &&
          matchTime <= clip.annotation_end,
      );
      if (segmentIdx >= 0) setCurrentClipIndex(segmentIdx);
      if (video) video.currentTime = matchTime;
    },
    [clips, videoDurationSec],
  );

  const cycleSpeed = useCallback(() => {
    const rates = [0.25, 0.5, 1, 1.5, 2];
    const idx = rates.indexOf(playbackRate);
    const next = rates[(idx + 1) % rates.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }, [playbackRate]);

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  }, []);

  // Seek the <video> by deltaSec seconds, clamped to the full video range
  // when in segment-creation mode so arrows can freely move forward.
  const seekBy = useCallback(
    (deltaSec: number) => {
      const v = videoRef.current;
      if (!v) return;
      if (creatingSegment) {
        // In segment creation mode, allow free seeking across full video
        const next = Math.max(
          0,
          Math.min(videoDurationSec - 0.05, v.currentTime + deltaSec),
        );
        v.currentTime = next;
        return;
      }
      const clip = clips[currentClipIndex];
      if (!clip) return;
      const next = Math.max(
        clip.start,
        Math.min(clip.end - 0.05, v.currentTime + deltaSec),
      );
      v.currentTime = next;
    },
    [clips, currentClipIndex, creatingSegment, videoDurationSec],
  );

  // ─── Disabled intent IDs ───
  // Possession-based blocking: if a single team has possession (either
  // trajectory-detected or manual override), disable attack intents for
  // the non-possessing team and disable defense intents for the possessing
  // team. If contested/no-possession, fall back to the old cross-team
  // other-label blocking (what the other team selected).
  const disabledIntentIdsA = useMemo(() => {
    const disabled = new Set<string>();
    const intentA = getIntentLabel(selectedIntentA);
    const intentB = getIntentLabel(selectedIntentB);
    if (intentA === "DeadBall" || gameState.dead_ball) {
      TACTIC_INTENTS.forEach((g) =>
        g.items.forEach((i) => {
          if (i.label !== "DeadBall") disabled.add(i.id);
        }),
      );
      return Array.from(disabled);
    }
    if (!gameState.set_piece) {
      TACTIC_INTENTS.forEach((g) =>
        g.items.forEach((i) => {
          if (isSetPieceIntent(i.label)) disabled.add(i.id);
        }),
      );
    }
    // Possession-based blocking for Team A
    if (effectivePossessionTeam === "A") {
      // Team A has possession: disable defense intents for Team A
      TACTIC_INTENTS.forEach((g) =>
        g.items.forEach((i) => {
          if (isDefenseIntent(i.label)) disabled.add(i.id);
        }),
      );
    } else if (effectivePossessionTeam === "B") {
      // Team B has possession: disable attack intents for Team A
      TACTIC_INTENTS.forEach((g) =>
        g.items.forEach((i) => {
          if (isAttackIntent(i.label)) disabled.add(i.id);
        }),
      );
    } else {
      // Contested / no possession: fall back to cross-team other-label blocking
      if (intentB && isAttackIntent(intentB) && !isSetPieceIntent(intentB)) {
        TACTIC_INTENTS.forEach((g) =>
          g.items.forEach((i) => {
            if (isAttackIntent(i.label)) disabled.add(i.id);
          }),
        );
      } else if (
        intentB &&
        isDefenseIntent(intentB) &&
        !isSetPieceIntent(intentB)
      ) {
        TACTIC_INTENTS.forEach((g) =>
          g.items.forEach((i) => {
            if (isDefenseIntent(i.label)) disabled.add(i.id);
          }),
        );
      }
      if (intentB === "CounterAttack")
        disabled.add(getIntentId("CounterAttack"));
    }
    disabled.add(getIntentId("ContestedPlay"));
    return Array.from(disabled);
  }, [
    selectedIntentA,
    selectedIntentB,
    gameState.dead_ball,
    gameState.set_piece,
    effectivePossessionTeam,
  ]);

  const disabledIntentIdsB = useMemo(() => {
    const disabled = new Set<string>();
    const intentA = getIntentLabel(selectedIntentA);
    const intentB = getIntentLabel(selectedIntentB);
    if (intentB === "DeadBall" || gameState.dead_ball) {
      TACTIC_INTENTS.forEach((g) =>
        g.items.forEach((i) => {
          if (i.label !== "DeadBall") disabled.add(i.id);
        }),
      );
      return Array.from(disabled);
    }
    if (!gameState.set_piece) {
      TACTIC_INTENTS.forEach((g) =>
        g.items.forEach((i) => {
          if (isSetPieceIntent(i.label)) disabled.add(i.id);
        }),
      );
    }
    // Possession-based blocking for Team B
    if (effectivePossessionTeam === "B") {
      // Team B has possession: disable defense intents for Team B
      TACTIC_INTENTS.forEach((g) =>
        g.items.forEach((i) => {
          if (isDefenseIntent(i.label)) disabled.add(i.id);
        }),
      );
    } else if (effectivePossessionTeam === "A") {
      // Team A has possession: disable attack intents for Team B
      TACTIC_INTENTS.forEach((g) =>
        g.items.forEach((i) => {
          if (isAttackIntent(i.label)) disabled.add(i.id);
        }),
      );
    } else {
      // Contested / no possession: fall back to cross-team other-label blocking
      if (intentA && isAttackIntent(intentA) && !isSetPieceIntent(intentA)) {
        TACTIC_INTENTS.forEach((g) =>
          g.items.forEach((i) => {
            if (isAttackIntent(i.label)) disabled.add(i.id);
          }),
        );
      } else if (
        intentA &&
        isDefenseIntent(intentA) &&
        !isSetPieceIntent(intentA)
      ) {
        TACTIC_INTENTS.forEach((g) =>
          g.items.forEach((i) => {
            if (isDefenseIntent(i.label)) disabled.add(i.id);
          }),
        );
      }
      if (intentA === "CounterAttack")
        disabled.add(getIntentId("CounterAttack"));
    }
    disabled.add(getIntentId("ContestedPlay"));
    return Array.from(disabled);
  }, [
    selectedIntentA,
    selectedIntentB,
    gameState.dead_ball,
    gameState.set_piece,
    effectivePossessionTeam,
  ]);

  const disabledIntentIds =
    currentTeam === "A" ? disabledIntentIdsA : disabledIntentIdsB;

  // ─── Intent handler ───
  const handleIntentClick = useCallback(
    (id: string) => {
      if (disabledIntentIds.includes(id)) return;
      const label = getIntentLabel(id);
      if (label === "DeadBall")
        setGameState((prev) => ({
          ...prev,
          dead_ball: true,
          dead_ball_reason: prev.dead_ball_reason || "stoppage",
        }));
      if (currentTeam === "A") {
        const newVal = selectedIntentA === id ? "" : id;
        setSelectedIntentA(newVal);
        if (isExclusionIntent(label)) setSelectedIntentB("");
      } else {
        const newVal = selectedIntentB === id ? "" : id;
        setSelectedIntentB(newVal);
        if (isExclusionIntent(label)) setSelectedIntentA("");
      }
    },
    [currentTeam, selectedIntentA, selectedIntentB, disabledIntentIds],
  );

  // ─── Segment adjustment handlers ───
  const handleSegmentAdjust = useCallback(
    (value: number) => {
      if (!currentClip) return;
      const delta = (value - segmentAdjustTenths) / 10;
      setSegmentAdjustTenths(value);
      setClips((prev) =>
        prev.map((clip, idx) => {
          if (idx !== currentClipIndex) return clip;
          const nextStart = Math.max(clip.start, clip.annotation_start + delta);
          const nextEnd = Math.min(clip.end, clip.annotation_end + delta);
          if (nextEnd - nextStart < 2) return clip;
          return {
            ...clip,
            annotation_start: nextStart,
            annotation_end: nextEnd,
            annotation_window: nextEnd - nextStart,
          };
        }),
      );
    },
    [currentClip, currentClipIndex, segmentAdjustTenths],
  );

  const handleBoundaryNudge = useCallback(
    (edge: "start" | "end", deltaSec: number) => {
      if (!currentClip) return;
      let updatedClip: Clip | null = null;
      setClips((prev) =>
        prev.map((clip, idx) => {
          if (idx !== currentClipIndex) return clip;
          const nextStart =
            edge === "start"
              ? Math.max(0, clip.annotation_start + deltaSec)
              : clip.annotation_start;
          const nextEnd =
            edge === "end"
              ? Math.min(videoDurationSec, clip.annotation_end + deltaSec)
              : clip.annotation_end;
          if (nextEnd - nextStart < 2) return clip;
          let newState: AnnotatorState = clip.annotator_state || "unseen";
          if (clip.algorithm_proposal) {
            const startChanged =
              Math.abs(nextStart - clip.algorithm_proposal.start) > 0.5;
            const endChanged =
              Math.abs(nextEnd - clip.algorithm_proposal.end) > 0.5;
            if (startChanged || endChanged) newState = "modified";
          }
          updatedClip = {
            ...clip,
            start: Math.min(clip.start, nextStart),
            end: Math.max(clip.end, nextEnd),
            annotation_start: nextStart,
            annotation_end: nextEnd,
            annotation_window: nextEnd - nextStart,
            annotator_state: newState,
          };
          return updatedClip;
        }),
      );
      if (updatedClip) {
        saveSegmentToServer(updatedClip);
      }
    },
    [currentClip, currentClipIndex, videoDurationSec, saveSegmentToServer],
  );

  const handleUpdateSegmentTimes = useCallback(
    (start: number, end: number) => {
      if (!currentClip) return;
      const duration = end - start;
      if (duration < 2) {
        setStatusMessage("Segment must be at least 2 seconds long.");
        return;
      }
      if (duration > MAX_SEGMENT_DURATION) {
        setStatusMessage(`Segment cannot exceed ${MAX_SEGMENT_DURATION}s.`);
        return;
      }
      let newState: AnnotatorState = currentClip.annotator_state || "unseen";
      if (currentClip.algorithm_proposal) {
        const startChanged =
          Math.abs(start - currentClip.algorithm_proposal.start) > 0.5;
        const shadowEndChanged =
          Math.abs(end - currentClip.algorithm_proposal.end) > 0.5;
        if (startChanged || shadowEndChanged) newState = "modified";
      }
      const updatedClip: Clip = {
        ...currentClip,
        start: Math.min(currentClip.start, start),
        end: Math.max(currentClip.end, end),
        annotation_start: start,
        annotation_end: end,
        annotation_window: duration,
        annotator_state: newState,
      };
      setClips((prev) =>
        prev.map((c, idx) => (idx === currentClipIndex ? updatedClip : c)),
      );
      saveSegmentToServer(updatedClip);
      setStatusMessage(`Segment timing updated: ${start.toFixed(1)}s – ${end.toFixed(1)}s`);
    },
    [currentClip, currentClipIndex, saveSegmentToServer],
  );

  // ─── Delete segment ───
  const handleDeleteSegment = useCallback((clipId: string) => {
    setClips((prev) => prev.filter((c) => c.clip_id !== clipId));
    setAnnotations((prev) => prev.filter((a) => a.clip_id !== clipId));
    setStatusMessage(`Segment ${clipId} deleted.`);
    // Also delete from server
    fetch(`${SERVER_URL}/segments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clip_id: clipId }),
    }).catch(() => console.warn("Failed to delete segment from server"));
  }, []);

  // ─── Save annotation ───
  const saveAnnotation = useCallback(
    (skipped = false) => {
      if (!currentClip) {
        console.warn("[saveAnnotation] No current clip");
        return;
      }
      if (!skipped && !selectedIntentA && !selectedIntentB) {
        setStatusMessage(
          "Select at least one label or use ContestedPlay/Skip.",
        );
        return;
      }
      if (
        !skipped &&
        annotations.length >= 50 &&
        !hasAnnotated(currentClip.clip_id)
      ) {
        setStatusMessage(
          "Session hard cap reached at 50 clips. Export or reset before continuing.",
        );
        return;
      }
      if (!skipped && sessionBreakDue) {
        setStatusMessage(
          "Forced session break due. Click Resume After Break before continuing.",
        );
        return;
      }
      if (!skipped && !qualityPass) {
        setStatusMessage(
          "Quality gate blocked submit: need at least 18/22 tracked players and no more than 3 red tracker dots.",
        );
        return;
      }
      try {
        const fps = currentClip.resolution?.fps ?? 25;
        const clipDur = currentClip.end - currentClip.start;
        const labelDur =
          currentClip.annotation_end - currentClip.annotation_start;
        if (!skipped && labelDur < 2) {
          setStatusMessage(
            "Segment length blocked: submit requires at least 2.0s.",
          );
          return;
        }

        // Build cleanedGameState early so auto-split can use it
        const cleanedGameState: GameState = {
          half: gameState.half,
          match_clock_sec: gameState.match_clock_sec,
          score_home: gameState.score_home,
          score_away: gameState.score_away,
          ...(gameState.set_piece
            ? {
                set_piece: true,
                set_piece_type: gameState.set_piece_type || "corner",
              }
            : {}),
          ...(gameState.dead_ball
            ? {
                dead_ball: true,
                dead_ball_reason: gameState.dead_ball_reason || "stoppage",
              }
            : {}),
        };

        if (!skipped && labelDur > MAX_SEGMENT_DURATION) {
          // Auto-split at 15s: save segment A (0-15s), create segment B (15s-end)
          // with same intent labels pre-filled, then navigate to segment B.
          const splitSec = MAX_SEGMENT_DURATION;
          const restDur = labelDur - splitSec;

          // 1. Save annotation for segment A (0-15s)
          const tensorFramesA = Math.max(
            20,
            Math.min(150, Math.round(splitSec * 10)),
          );

          // Build annotation for the 15s portion
          const intentLabelA = getIntentLabel(selectedIntentA);
          const intentLabelB = getIntentLabel(selectedIntentB);
          const exclusionLabel = gameState.dead_ball
            ? "DeadBall"
            : isExclusionIntent(intentLabelA)
              ? intentLabelA
              : isExclusionIntent(intentLabelB)
                ? intentLabelB
                : null;
          const effectiveExclusion = skipped ? "ContestedPlay" : exclusionLabel;
          let teamAIntentClass: string | null = effectiveExclusion
            ? null
            : intentLabelA;
          let teamBIntentClass: string | null = effectiveExclusion
            ? null
            : intentLabelB;

          // Derive possession for segment A
          let teamAPossession =
            !effectiveExclusion && detectedPossessionTeam === "A";
          let teamBPossession =
            !effectiveExclusion && detectedPossessionTeam === "B";
          if (!effectiveExclusion && manualPossession === "A") {
            teamAPossession = true;
            teamBPossession = false;
          } else if (!effectiveExclusion && manualPossession === "B") {
            teamAPossession = false;
            teamBPossession = true;
          } else if (!effectiveExclusion && manualPossession === "contested") {
            teamAPossession = false;
            teamBPossession = false;
          } else if (!effectiveExclusion && !detectedPossessionTeam) {
            if (intentLabelA && isAttackIntent(intentLabelA))
              teamAPossession = true;
            if (intentLabelA && isDefenseIntent(intentLabelA))
              teamAPossession = false;
            if (intentLabelB && isAttackIntent(intentLabelB))
              teamBPossession = true;
            if (intentLabelB && isDefenseIntent(intentLabelB))
              teamBPossession = false;
            if (teamAPossession === teamBPossession) {
              if (teamAIntentClass && isAttackIntent(teamAIntentClass)) {
                teamAPossession = true;
                teamBPossession = false;
              } else if (teamBIntentClass && isAttackIntent(teamBIntentClass)) {
                teamAPossession = false;
                teamBPossession = true;
              } else if (
                teamAIntentClass &&
                isDefenseIntent(teamAIntentClass)
              ) {
                teamAPossession = false;
                teamBPossession = true;
              } else if (
                teamBIntentClass &&
                isDefenseIntent(teamBIntentClass)
              ) {
                teamAPossession = true;
                teamBPossession = false;
              } else {
                teamAPossession = currentTeam === "A";
                teamBPossession = currentTeam === "B";
              }
            }
          }

          // Create annotation for segment A
          const annA: Annotation = {
            schema_version: "1.0.0",
            dataset: "TACTIC-Bench",
            clip_id: currentClip.clip_id,
            match_id: currentClip.match_id,
            match_name: currentClip.match_name || currentClip.match_id,
            half: HALF_LABEL(currentClip.half),
            window_idx: currentClip.window_idx ?? currentClipIndex,
            segment_metadata: {
              start_sec: currentClip.annotation_start,
              end_sec: currentClip.annotation_start + splitSec,
              duration_sec: splitSec,
              tensor_frames: tensorFramesA,
              preceding_event: currentClip.anchor_event?.type,
              following_event: currentClip.following_event,
              coverage_estimate: Number((coverageEstimate / 100).toFixed(3)),
              is_mixed_phase: isMixedPhase,
            },
            game_state: cleanedGameState,
            video_source: {
              video_path: currentClip.path,
              seek_start_sec: currentClip.start,
              label_start_sec: currentClip.annotation_start,
              label_end_sec: currentClip.annotation_start + splitSec,
              seek_end_sec: currentClip.annotation_start + splitSec + 4,
              fps: currentClip.resolution?.fps ?? 25,
              tensor_fps: 10,
              source_frame_count: Math.round(
                (currentClip.end - currentClip.start) *
                  (currentClip.resolution?.fps ?? 25),
              ),
              tensor_frame_count: tensorFramesA,
            },
            reconstruction: {
              npz_path: buildNpzPath(currentClip),
              tensor_shape: [tensorFramesA, 23, 4],
              tensor_fps: 10,
              quality_pass: qualityPass,
              tracked_players: trackedPlayers,
              padding_mask: buildPaddingMask(tensorFramesA),
            },
            team_a: {
              team_id: "Team_A",
              team_name: teamConfig.team_a.name,
              jersey_color: teamConfig.team_a.jersey_color,
              is_home: teamConfig.team_a.is_home,
              is_primary: teamAPossession,
              label: {
                intent_class: teamAIntentClass,
                confidence: skipped ? 0 : confidenceA,
                certainty: skipped ? "low" : certaintyA,
              },
              possession: teamAPossession,
            },
            team_b: {
              team_id: "Team_B",
              team_name: teamConfig.team_b.name,
              jersey_color: teamConfig.team_b.jersey_color,
              is_home: teamConfig.team_b.is_home,
              is_primary: teamBPossession,
              label: {
                intent_class: teamBIntentClass,
                confidence: skipped ? 0 : confidenceB,
                certainty: skipped ? "low" : certaintyB,
              },
              possession: teamBPossession,
            },
            team_config: teamConfig,
            exclusion: effectiveExclusion,
            annotation_meta: {
              annotator_id: "coach_001",
              session_id: `sess_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
              annotation_timestamp: new Date().toISOString(),
              annotation_duration_sec: Math.round(
                (Date.now() - annotationStartTimeRef.current) / 1000,
              ),
              tool_version: "tactic-annotator-v3.0",
            },
            agreement: {
              annotated_at: new Date().toISOString(),
              flagged_review: isUncertain,
              skipped,
            },
            model_split: { assigned_split: "train" },
          };

          // 2. Update annotations with segment A
          const updatedA = [
            ...annotations.filter((a) => a.clip_id !== currentClip.clip_id),
            annA,
          ];

          // 3. Create segment B (clip + pre-filled annotation)
          const half = currentClip.half;
          const matchId = currentClip.match_id;
          const segBStart = currentClip.annotation_start + splitSec;
          const segBEnd = currentClip.annotation_end;
          const existingCount = clips.filter(
            (c) => c.annotation_start < segBStart && c.match_id === matchId,
          ).length;
          const segBId = `${matchId}_seg${String(existingCount).padStart(3, "0")}`;

          const segBClip: Clip = {
            clip_id: segBId,
            match_id: currentClip.match_id,
            path: currentClip.path,
            start: Math.max(0, segBStart - 4),
            end: Math.min(videoDurationSec, segBEnd + 4),
            annotation_start: segBStart,
            annotation_end: segBEnd,
            annotation_window: restDur,
            half,
            game_clock: formatMatchClock(half, segBStart),
            window_idx: currentClip.window_idx,
            match_name: currentClip.match_name,
            competition: currentClip.competition,
            season: currentClip.season,
            trajectory_path: currentClip.trajectory_path,
            anchor_event: currentClip.anchor_event,
            following_event: currentClip.following_event,
            possession_state: currentClip.possession_state,
            team_perspective: currentClip.team_perspective,
            resolution: currentClip.resolution,
            features: currentClip.features,
            quality_score: currentClip.quality_score,
            tracking_coverage: currentClip.tracking_coverage,
            annotator_state: "manual" as AnnotatorState,
            is_locked: false,
          };

          // Pre-fill annotation for segment B with same intents
          const tensorFramesB = Math.max(
            20,
            Math.min(150, Math.round(restDur * 10)),
          );
          const annB: Annotation = {
            schema_version: "1.0.0",
            dataset: "TACTIC-Bench",
            clip_id: segBId,
            match_id: currentClip.match_id,
            match_name: currentClip.match_name || currentClip.match_id,
            half: HALF_LABEL(half),
            window_idx: currentClip.window_idx ?? currentClipIndex,
            segment_metadata: {
              start_sec: segBStart,
              end_sec: segBEnd,
              duration_sec: restDur,
              tensor_frames: tensorFramesB,
              preceding_event: currentClip.anchor_event?.type,
              following_event: currentClip.following_event,
              coverage_estimate: Number((coverageEstimate / 100).toFixed(3)),
              is_mixed_phase: isMixedPhase,
            },
            game_state: cleanedGameState,
            video_source: {
              video_path: currentClip.path,
              seek_start_sec: segBClip.start,
              label_start_sec: segBStart,
              label_end_sec: segBEnd,
              seek_end_sec: segBClip.end,
              fps: currentClip.resolution?.fps ?? 25,
              tensor_fps: 10,
              source_frame_count: Math.round(
                (segBClip.end - segBClip.start) *
                  (currentClip.resolution?.fps ?? 25),
              ),
              tensor_frame_count: tensorFramesB,
            },
            reconstruction: {
              npz_path: buildNpzPath(segBClip),
              tensor_shape: [tensorFramesB, 23, 4],
              tensor_fps: 10,
              quality_pass: qualityPass,
              tracked_players: trackedPlayers,
              padding_mask: buildPaddingMask(tensorFramesB),
            },
            team_a: {
              team_id: "Team_A",
              team_name: teamConfig.team_a.name,
              jersey_color: teamConfig.team_a.jersey_color,
              is_home: teamConfig.team_a.is_home,
              is_primary: teamAPossession,
              label: {
                intent_class: teamAIntentClass,
                confidence: skipped ? 0 : confidenceA,
                certainty: skipped ? "low" : certaintyA,
              },
              possession: teamAPossession,
            },
            team_b: {
              team_id: "Team_B",
              team_name: teamConfig.team_b.name,
              jersey_color: teamConfig.team_b.jersey_color,
              is_home: teamConfig.team_b.is_home,
              is_primary: teamBPossession,
              label: {
                intent_class: teamBIntentClass,
                confidence: skipped ? 0 : confidenceB,
                certainty: skipped ? "low" : certaintyB,
              },
              possession: teamBPossession,
            },
            team_config: teamConfig,
            exclusion: effectiveExclusion,
            annotation_meta: {
              annotator_id: "coach_001",
              session_id: `sess_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
              annotation_timestamp: new Date().toISOString(),
              annotation_duration_sec: 0,
              tool_version: "tactic-annotator-v3.0",
            },
            agreement: {
              annotated_at: new Date().toISOString(),
              flagged_review: isUncertain,
              skipped,
            },
            model_split: { assigned_split: "train" },
          };

          // 4. Update state: add segment B clip and annotation, save segment A
          setAnnotations(
            [
              ...annotations.filter((a) => a.clip_id !== currentClip.clip_id),
              annA,
              annB,
            ].sort(
              (a, b) =>
                String(a.half).localeCompare(String(b.half)) ||
                (a.window_idx ?? 0) - (b.window_idx ?? 0),
            ),
          );

          // Replace current clip with segment B and add it
          saveSegmentToServer(segBClip);
          setClips((prev) => {
            const filtered = prev.filter(
              (c) => c.clip_id !== currentClip.clip_id,
            );
            const next = [...filtered, segBClip].sort(
              (a, b) => a.annotation_start - b.annotation_start,
            );
            const idxB = next.findIndex((c) => c.clip_id === segBId);
            if (idxB >= 0) setCurrentClipIndex(idxB);
            return next;
          });

          setCreatingSegment(null);
          setShowSplitPrompt(true);
          setStatusMessage(
            `Auto-split: segment A (0–15s) saved. Segment B (${restDur.toFixed(1)}s) starts at ${formatTime(segBStart)} with same intents pre-filled.`,
          );
          fetch(`${SERVER_URL}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schema_version: "1.0.0",
              dataset: "TACTIC-Bench",
              team_config: teamConfig,
              annotations: [
                ...annotations.filter((a) => a.clip_id !== currentClip.clip_id),
                annA,
                annB,
              ],
            }),
          }).catch(() => console.warn("Sync failed"));
          return;
        }
        const tensorFrames = Math.max(
          20,
          Math.min(150, Math.round(labelDur * 10)),
        );
        const intentLabelA = getIntentLabel(selectedIntentA);
        const intentLabelB = getIntentLabel(selectedIntentB);
        const exclusionLabel = gameState.dead_ball
          ? "DeadBall"
          : isExclusionIntent(intentLabelA)
            ? intentLabelA
            : isExclusionIntent(intentLabelB)
              ? intentLabelB
              : null;
        const effectiveExclusion = skipped ? "ContestedPlay" : exclusionLabel;
        let teamAIntentClass: string | null = effectiveExclusion
          ? null
          : intentLabelA;
        let teamBIntentClass: string | null = effectiveExclusion
          ? null
          : intentLabelB;
        // ─── Possession / primary derivation ───
        // Start from the trajectory-detected team, but let the annotator's
        // manual override ("A" | "B" | "contested") be the source of truth.
        let teamAPossession =
          !effectiveExclusion && detectedPossessionTeam === "A";
        let teamBPossession =
          !effectiveExclusion && detectedPossessionTeam === "B";
        if (!effectiveExclusion && manualPossession === "A") {
          teamAPossession = true;
          teamBPossession = false;
        } else if (!effectiveExclusion && manualPossession === "B") {
          teamAPossession = false;
          teamBPossession = true;
        } else if (!effectiveExclusion && manualPossession === "contested") {
          teamAPossession = false;
          teamBPossession = false;
        } else if (!effectiveExclusion && !detectedPossessionTeam) {
          // Fall back to intent-based heuristic when no manual selection and
          // no trajectory signal. Keep the original auto-derivation.
          if (intentLabelA && isAttackIntent(intentLabelA))
            teamAPossession = true;
          if (intentLabelA && isDefenseIntent(intentLabelA))
            teamAPossession = false;
          if (intentLabelB && isAttackIntent(intentLabelB))
            teamBPossession = true;
          if (intentLabelB && isDefenseIntent(intentLabelB))
            teamBPossession = false;
          if (teamAPossession === teamBPossession) {
            if (teamAIntentClass && isAttackIntent(teamAIntentClass)) {
              teamAPossession = true;
              teamBPossession = false;
            } else if (teamBIntentClass && isAttackIntent(teamBIntentClass)) {
              teamAPossession = false;
              teamBPossession = true;
            } else if (teamAIntentClass && isDefenseIntent(teamAIntentClass)) {
              teamAPossession = false;
              teamBPossession = true;
            } else if (teamBIntentClass && isDefenseIntent(teamBIntentClass)) {
              teamAPossession = true;
              teamBPossession = false;
            } else {
              teamAPossession = currentTeam === "A";
              teamBPossession = currentTeam === "B";
            }
          }
        }
        // is_primary mirrors the user-selected possession: the team with the
        // ball is primary. Contested / no-team selections yield primary=false
        // for both sides (matches the existing ContestedPlay exclusion case).
        const teamAPrimary = teamAPossession;
        const teamBPrimary = teamBPossession;
        if (
          !effectiveExclusion &&
          teamAIntentClass === "CounterAttack" &&
          teamBIntentClass === "CounterAttack"
        ) {
          setStatusMessage("CounterAttack cannot be assigned to both teams.");
          return;
        }
        if (!effectiveExclusion && (!teamAIntentClass || !teamBIntentClass)) {
          setStatusMessage(
            "Both teams need an intent before submit, unless this is an exclusion.",
          );
          return;
        }
        if (
          !effectiveExclusion &&
          ((teamAPossession && isAttackIntent(teamBIntentClass || "")) ||
            (teamBPossession && isAttackIntent(teamAIntentClass || "")))
        ) {
          setStatusMessage(
            "Offensive intents are disabled for the team without possession.",
          );
          return;
        }

        const ann: Annotation = {
          schema_version: "1.0.0",
          dataset: "TACTIC-Bench",
          clip_id: currentClip.clip_id,
          match_id: currentClip.match_id,
          match_name: currentClip.match_name || currentClip.match_id,
          half: HALF_LABEL(currentClip.half),
          window_idx: currentClip.window_idx ?? currentClipIndex,
          segment_metadata: {
            start_sec: currentClip.annotation_start,
            end_sec: currentClip.annotation_end,
            duration_sec: Number(labelDur.toFixed(3)),
            tensor_frames: tensorFrames,
            preceding_event: currentClip.anchor_event?.type,
            following_event: currentClip.following_event,
            coverage_estimate: Number((coverageEstimate / 100).toFixed(3)),
            is_mixed_phase: isMixedPhase,
          },
          game_state: cleanedGameState,
          video_source: {
            video_path: currentClip.path,
            seek_start_sec: currentClip.start,
            label_start_sec: currentClip.annotation_start,
            label_end_sec: currentClip.annotation_end,
            seek_end_sec: currentClip.end,
            fps,
            tensor_fps: 10,
            source_frame_count: Math.round(clipDur * fps),
            tensor_frame_count: tensorFrames,
          },
          reconstruction: {
            npz_path: buildNpzPath(currentClip),
            tensor_shape: [tensorFrames, 23, 4],
            tensor_fps: 10,
            quality_pass: qualityPass,
            tracked_players: trackedPlayers,
            padding_mask: buildPaddingMask(tensorFrames),
          },
          team_a: {
            team_id: "Team_A",
            team_name: teamConfig.team_a.name,

            jersey_color: teamConfig.team_a.jersey_color,
            is_home: teamConfig.team_a.is_home,
            is_primary: teamAPrimary,
            label: {
              intent_class: teamAIntentClass,
              confidence: skipped ? 0 : confidenceA,
              certainty: skipped ? "low" : certaintyA,
            },
            possession: teamAPossession,
          },
          team_b: {
            team_id: "Team_B",
            team_name: teamConfig.team_b.name,
            jersey_color: teamConfig.team_b.jersey_color,
            is_home: teamConfig.team_b.is_home,
            is_primary: teamBPrimary,
            label: {
              intent_class: teamBIntentClass,
              confidence: skipped ? 0 : confidenceB,
              certainty: skipped ? "low" : certaintyB,
            },
            possession: teamBPossession,
          },
          team_config: teamConfig,
          exclusion: effectiveExclusion,
          annotation_meta: {
            annotator_id: "coach_001",
            session_id: `sess_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
            annotation_timestamp: new Date().toISOString(),
            annotation_duration_sec: Math.round(
              (Date.now() - annotationStartTimeRef.current) / 1000,
            ),
            tool_version: "tactic-annotator-v3.0",
          },
          agreement: {
            annotated_at: new Date().toISOString(),
            flagged_review: isUncertain,
            skipped,
          },
          model_split: { assigned_split: "train" },
        };

        const updated = [
          ...annotations.filter((a) => a.clip_id !== currentClip.clip_id),
          ann,
        ];
        updated.sort((a, b) => {
          const halfCmp = String(a.half).localeCompare(String(b.half));
          if (halfCmp !== 0) return halfCmp;
          const windowCmp = (a.window_idx ?? 0) - (b.window_idx ?? 0);
          if (windowCmp !== 0) return windowCmp;
          return String(a.video_source?.video_path || "").localeCompare(
            String(b.video_source?.video_path || ""),
          );
        });
        setAnnotations(updated);
        if (autoNext && currentClipIndex < clips.length - 1) {
          setCurrentClipIndex((i) => {
            // Skip rejected clips when auto-next is enabled
            let next = i + 1;
            while (
              next < clips.length - 1 &&
              clips[next]?.annotator_state === "rejected"
            ) {
              next++;
            }
            // If all remaining clips are rejected, stay at current+1
            return next;
          });
        }
        // Auto-advance: next segment starts at the previous segment's END.
        // This eliminates gaps and keeps the workflow continuous — no separate
        // M key press needed. The annotator just watches, presses O to mark END,
        // labels both teams, and presses Enter to submit & chain forward.
        const nextStartSec = currentClip.annotation_end;
        setCreatingSegment({ start: nextStartSec, end: nextStartSec + 2 });
        setStatusMessage(
          `Segment saved (${labelDur.toFixed(1)}s). Next segment starts at ${formatTime(nextStartSec)}. Watch the video, press O to mark END of the next segment.`,
        );
        fetch(`${SERVER_URL}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "1.0.0",
            dataset: "TACTIC-Bench",
            team_config: teamConfig,
            annotations: updated,
          }),
        }).catch(() => console.warn("Sync failed"));
      } catch (err) {
        console.error("[saveAnnotation] Error:", err);
        setStatusMessage(`Save error: ${(err as Error).message}`);
      }
    },
    [
      currentClip,
      selectedIntentA,
      selectedIntentB,
      annotations,
      hasAnnotated,
      sessionBreakDue,
      qualityPass,
      confidenceA,
      confidenceB,
      certaintyA,
      certaintyB,
      coverageEstimate,
      isMixedPhase,
      isUncertain,
      autoNext,
      currentClipIndex,
      clips,
      teamConfig,
      gameState,
      currentTeam,
      manualPossession,
      detectedPossessionTeam,
    ],
  );

  // ─── Load manifest (JSON clips definition) ───
  const handleLoadManifest = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        let raw: any[] = Array.isArray(data) ? data : data.clips || [];
        const normalized = await resolveBrowserVideoPaths(
          makeUniqueClipIds(raw.map(normalizeClip)),
        );
        setClips(normalized);
        setCurrentClipIndex(0);
        loadedVideoPathRef.current = "";
        setStatusMessage(`${normalized.length} clips from file`);
      } catch {
        setStatusMessage("Invalid manifest file");
      }
    };
    input.click();
  }, []);

  // ─── List videos from server ───
  const [serverVideos, setServerVideos] = useState<string[]>([]);
  const [showVideoPicker, setShowVideoPicker] = useState(false);

  const handleLoadVideoDirect = useCallback(() => {
    // Fetch list of available videos from the server
    fetch(`${SERVER_URL}/videos/list`)
      .then((res) => res.json())
      .then((data) => {
        if (data.videos && data.videos.length > 0) {
          setServerVideos(data.videos);
          setShowVideoPicker(true);
        } else {
          setStatusMessage(
            "No videos found in raw_videos/ directory. Place video files there and try again.",
          );
        }
      })
      .catch(() => {
        setStatusMessage(
          "Server unavailable. Make sure the Next.js server is running.",
        );
      });
  }, []);

  const handleSelectServerVideo = useCallback((filename: string) => {
    setShowVideoPicker(false);
    isBlobVideoRef.current = false;
    const videoPath = `raw_videos/${filename}`;
    loadedVideoPathRef.current = videoPath;
    setActiveVideoPath(videoPath);
    setClips([]);
    setCurrentClipIndex(0);
    setVideoError("");
    // Reset video duration so it gets updated from actual <video>.duration when metadata loads
    setVideoDurationSec(MATCH_DURATION_SEC);
    setIsPlaying(true);
    setStatusMessage(`Loading: ${filename}`);
  }, []);

  // ─── Export ───
  const exportJSON = useCallback(() => {
    const matchId = clips[0]?.match_id || (activeVideoPath ? activeVideoPath.split("/").pop()?.replace(/\.[^.]+$/, "") : "unknown");
    const modelSamples = toModelSamples(annotations);
    fetch(`${SERVER_URL}/export/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations, match_id: matchId }),
    }).catch(() => {});
    const blob = new Blob([JSON.stringify(modelSamples, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TACTIC_FP_Annotated_${matchId}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }, [annotations, clips, activeVideoPath]);

  const exportCSV = useCallback(() => {
    if (!annotations.length) return;
    const matchId = clips[0]?.match_id || (activeVideoPath ? activeVideoPath.split("/").pop()?.replace(/\.[^.]+$/, "") : "unknown");
    const exportAnnotations = withCurrentTeamIdentity(annotations, teamConfig);
    fetch(`${SERVER_URL}/export/csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations: exportAnnotations,
        team_config: teamConfig,
      }),
    }).catch(() => {});
    const headers = [
      "clip_id",
      "match_id",
      "match_name",
      "half",
      "window_idx",
      "video_path",
      "seek_start_sec",
      "label_start_sec",
      "label_end_sec",
      "seek_end_sec",
      "team_a_id",
      "team_a_name",
      "team_a_jersey_color",
      "team_a_intent",
      "team_a_confidence",
      "team_a_possession",
      "team_b_id",
      "team_b_name",
      "team_b_jersey_color",
      "team_b_intent",
      "team_b_confidence",
      "team_b_possession",
      "exclusion",
      "flagged_review",
      "skipped",
      "annotated_at",
    ];
    const csvVal = (v: any) => {
      if (v == null) return "";
      if (typeof v === "boolean") return v ? "true" : "false";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };
    const flatten = (ann: Annotation) => ({
      clip_id: ann.clip_id,
      match_id: ann.match_id,
      match_name: ann.match_name,
      half: ann.half,
      window_idx: ann.window_idx,
      video_path: ann.video_source?.video_path,
      seek_start_sec: ann.video_source?.seek_start_sec,
      label_start_sec: ann.video_source?.label_start_sec,
      label_end_sec: ann.video_source?.label_end_sec,
      seek_end_sec: ann.video_source?.seek_end_sec,
      team_a_id: ann.team_a?.team_id,
      team_a_name: ann.team_a?.team_name || teamConfig.team_a.name,
      team_a_jersey_color:
        ann.team_a?.jersey_color || teamConfig.team_a.jersey_color,
      team_a_intent: ann.team_a?.label?.intent_class,
      team_a_confidence: ann.team_a?.label?.confidence,
      team_a_possession: ann.team_a?.possession,
      team_b_id: ann.team_b?.team_id,
      team_b_name: ann.team_b?.team_name || teamConfig.team_b.name,
      team_b_jersey_color:
        ann.team_b?.jersey_color || teamConfig.team_b.jersey_color,
      team_b_intent: ann.team_b?.label?.intent_class,
      team_b_confidence: ann.team_b?.label?.confidence,
      team_b_possession: ann.team_b?.possession,
      exclusion: ann.exclusion,
      flagged_review: ann.agreement?.flagged_review,
      skipped: ann.agreement?.skipped,
      annotated_at: ann.agreement?.annotated_at,
    });
    const rows = [
      headers.join(","),
      ...exportAnnotations.map((ann) => {
        const row = flatten(ann);
        return headers.map((h) => csvVal((row as any)[h])).join(",");
      }),
    ];
    const blob = new Blob([rows.join("\r\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TACTIC_FP_Annotated_${matchId}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }, [annotations, clips, teamConfig, activeVideoPath]);

  // ─── Reset ───
  const resetSession = useCallback(() => {
    if (
      !window.confirm(
        "Reset session and clear generated annotations, manifests, exports, and converted MP4 files? Original raw videos are kept.",
      )
    )
      return;
    setAnnotations([]);
    setClips([]);
    setActiveVideoPath(null);
    setCurrentClipIndex(0);
    setSelectedIntentA("");
    setSelectedIntentB("");
    setConfidence(4);
    setConfidenceA(4);
    setConfidenceB(4);
    setCertaintyA("high");
    setCertaintyB("high");
    setCoverageEstimate(95);
    setIsMixedPhase(false);
    setSegmentAdjustTenths(0);
    setBreakAcknowledgedAt(0);
    setIsUncertain(false);
    setTeamConfig(DEFAULT_TEAM_CONFIG);
    setGameState(DEFAULT_GAME_STATE);
    setManualPossession(null);
    loadedVideoPathRef.current = "";
    setStatusMessage("Resetting generated session files...");
    fetch(`${SERVER_URL}/annotations/reset`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          setStatusMessage(`Reset failed: ${res.status} ${text}`);
          return;
        }
        setStatusMessage("Session reset. Raw videos kept.");
      })
      .catch((err) => setStatusMessage(`Reset failed: ${err.message}`));
  }, []);

  // ─── Keyboard shortcuts ───
  // Stable refs for handlers invoked from the global keydown listener.
  const togglePlaybackRef = useRef(togglePlayback);
  togglePlaybackRef.current = togglePlayback;
  const saveAnnotationRef = useRef<(s: boolean) => void>(saveAnnotation);
  saveAnnotationRef.current = saveAnnotation;
  const handleStartSegmentCreateRef = useRef(handleStartSegmentCreate);
  handleStartSegmentCreateRef.current = handleStartSegmentCreate;
  const handleCancelSegmentCreateRef = useRef(() => setCreatingSegment(null));
  const handleConfirmSegmentCreateRef = useRef(handleConfirmSegmentCreate);
  handleConfirmSegmentCreateRef.current = handleConfirmSegmentCreate;
  const toggleMuteRef = useRef(toggleMute);
  toggleMuteRef.current = toggleMute;
  const toggleFullscreenRef = useRef(toggleFullscreen);
  toggleFullscreenRef.current = toggleFullscreen;
  const seekByRef = useRef(seekBy);
  seekByRef.current = seekBy;
  const setShowHelpRef = useRef(setShowHelp);
  setShowHelpRef.current = setShowHelp;
  const handleSetSegmentStartRef = useRef(handleSetSegmentStart);
  handleSetSegmentStartRef.current = handleSetSegmentStart;
  const handleSetSegmentEndRef = useRef(handleSetSegmentEnd);
  handleSetSegmentEndRef.current = handleSetSegmentEnd;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey || e.altKey;
      if (mod) return; // don't hijack browser shortcuts

      // Help modal
      if (e.key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        setShowHelpRef.current(true);
        return;
      }
      if (key === "escape") {
        e.preventDefault();
        handleCancelSegmentCreateRef.current();
        setShowHelpRef.current(false);
        return;
      }

      // Team switch
      if (key === "a") {
        e.preventDefault();
        setCurrentTeam("A");
        return;
      }
      if (key === "b") {
        e.preventDefault();
        setCurrentTeam("B");
        return;
      }

      // Playback
      if (e.key === " " || key === "k") {
        e.preventDefault();
        togglePlaybackRef.current();
        return;
      }
      if (key === "j") {
        e.preventDefault();
        seekByRef.current(-10);
        return;
      }
      if (key === "l") {
        e.preventDefault();
        seekByRef.current(10);
        return;
      }
      if (key === "arrowleft") {
        e.preventDefault();
        if (e.shiftKey) seekByRef.current(-1);
        else seekByRef.current(-5);
        return;
      }
      if (key === "arrowright") {
        e.preventDefault();
        if (e.shiftKey) seekByRef.current(1);
        else seekByRef.current(5);
        return;
      }
      if (key === "[") {
        e.preventDefault();
        setCurrentClipIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key === "]") {
        e.preventDefault();
        setCurrentClipIndex((i) =>
          Math.min(clipsRef.current.length - 1, i + 1),
        );
        return;
      }

      // Mute (U to avoid clash with M = mark start)
      if (key === "u") {
        e.preventDefault();
        toggleMuteRef.current();
        return;
      }
      // Fullscreen
      if (key === "f") {
        e.preventDefault();
        toggleFullscreenRef.current();
        return;
      }

      // Mark workflow
      if (key === "m") {
        e.preventDefault();
        handleStartSegmentCreateRef.current();
        return;
      }
      if (key === "n") {
        e.preventDefault();
        handleCancelSegmentCreateRef.current();
        return;
      }
      // ─── Set segment start / end at playhead ───
      if (key === "i") {
        e.preventDefault();
        handleSetSegmentStartRef.current();
        return;
      }
      if (key === "o") {
        e.preventDefault();
        handleSetSegmentEndRef.current();
        return;
      }

      // Save / Skip
      if (key === "s") {
        e.preventDefault();
        saveAnnotationRef.current(true); // skip
        return;
      }
      if (key === "enter") {
        e.preventDefault();
        // If we're in the segment-create workflow, confirm it; otherwise submit
        if (creatingSegment) {
          handleConfirmSegmentCreateRef.current();
        } else {
          saveAnnotationRef.current(false);
        }
        return;
      }

      // Intent hotkeys
      if (HOTKEY_MAP[key]) {
        e.preventDefault();
        const intentId = HOTKEY_MAP[key];
        if (disabledIntentIds.includes(intentId)) return;
        if (currentTeamRef.current === "A")
          setSelectedIntentA((prev) => (prev === intentId ? "" : intentId));
        else setSelectedIntentB((prev) => (prev === intentId ? "" : intentId));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [disabledIntentIds, creatingSegment]);

  // ─── Filtered clips ───
  const filteredClips = useMemo(() => {
    let result = clips;
    if (clipFilter === "todo")
      result = result.filter((c) => !hasAnnotated(c.clip_id));
    if (clipFilter === "done")
      result = result.filter((c) => hasAnnotated(c.clip_id));
    if (clipSearch) {
      const q = clipSearch.toLowerCase();
      result = result.filter(
        (c) =>
          c.clip_id.toLowerCase().includes(q) ||
          c.match_id.toLowerCase().includes(q),
      );
    }
    return result;
  }, [clips, clipFilter, clipSearch, hasAnnotated]);

  // ─── Class distribution ───
  const classDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    annotations.forEach((a) => {
      if (
        a.team_a?.label?.intent_class &&
        a.team_a.label.intent_class !== "Skipped"
      )
        counts[a.team_a.label.intent_class] =
          (counts[a.team_a.label.intent_class] || 0) + 1;
      if (
        a.team_b?.label?.intent_class &&
        a.team_b.label.intent_class !== "Skipped"
      )
        counts[a.team_b.label.intent_class] =
          (counts[a.team_b.label.intent_class] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = sorted.length > 0 ? sorted[0][1] : 1;
    return sorted.map(([label, count]) => ({
      label,
      count,
      pct: Math.round((count / max) * 100),
      hex: getGroupHex(label),
    }));
  }, [annotations]);

  useEffect(() => {
    if (clipListRef.current) {
      const el = clipListRef.current.querySelector('[data-active="true"]');
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentClipIndex]);

  // ─── Coverage stats (real-time) ───
  const coverageStats: CoverageStats = useMemo(() => {
    const totalMatchSec =
      videoDurationSec > 0 ? videoDurationSec : MATCH_DURATION_SEC;
    let labeledSec = 0;
    let excludedSec = 0;
    annotations.forEach((ann) => {
      const dur = ann.segment_metadata?.duration_sec ?? 0;
      if (ann.exclusion) excludedSec += dur;
      else labeledSec += dur;
    });
    const currentSegmentSec = currentClip?.annotation_window ?? 0;
    const accounted = labeledSec + excludedSec + currentSegmentSec;
    const remainingSec = Math.max(0, totalMatchSec - accounted);
    return {
      totalMatchSec,
      labeledSec,
      excludedSec,
      currentSegmentSec,
      remainingSec,
    };
  }, [annotations, currentClip, videoDurationSec]);

  // ─── Split segment at playhead ───
  const [showSplitPrompt, setShowSplitPrompt] = useState(false);
  const hasShownSplitPromptRef = useRef(false);

  // When creatingSegment has a valid start, check if duration >= 15s and prompt
  useEffect(() => {
    if (creatingSegment && creatingSegment.start >= 0) {
      const draftDuration = Math.max(
        0,
        (creatingSegment.end >= 0 ? creatingSegment.end : videoCurrentTime) -
          creatingSegment.start,
      );
      if (
        draftDuration >= MAX_SEGMENT_DURATION &&
        !hasShownSplitPromptRef.current
      ) {
        setShowSplitPrompt(true);
        hasShownSplitPromptRef.current = true;
      }
      if (draftDuration < MAX_SEGMENT_DURATION) {
        hasShownSplitPromptRef.current = false;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoCurrentTime, creatingSegment]);

  const handleSplitSegment = useCallback(() => {
    setShowSplitPrompt(false);
    if (!currentClip) return;
    const splitPoint = readPlayhead();
    const start = currentClip.annotation_start;
    const end = currentClip.annotation_end;
    if (splitPoint - start < 2 || end - splitPoint < 2) {
      setStatusMessage("Split point too close to boundary (min 2s each side).");
      return;
    }
    // Create segment 1: start → splitPoint (preserves clip_id)
    // Create segment 2: splitPoint → end (new clip)
    const half = currentClip.half;
    const matchId = currentClip.match_id;
    const seg1Id = currentClip.clip_id;
    const existingCount = clips.filter(
      (c) => c.annotation_start < splitPoint && c.match_id === matchId,
    ).length;
    const seg2Id = `${matchId}_seg${String(existingCount).padStart(3, "0")}`;
    const seg1: Clip = {
      ...currentClip,
      annotation_end: splitPoint,
      annotation_window: splitPoint - start,
      annotator_state: "modified" as AnnotatorState,
      is_locked: false,
    };
    const seg2: Clip = {
      ...currentClip,
      clip_id: seg2Id,
      annotation_start: splitPoint,
      annotation_end: end,
      annotation_window: end - splitPoint,
      annotator_state: "manual" as AnnotatorState,
      is_locked: false,
    };
    // Remove current clip, add both sorted
    setClips((prev) => {
      const filtered = prev.filter((c) => c.clip_id !== currentClip.clip_id);
      const next = [...filtered, seg1, seg2].sort(
        (a, b) => a.annotation_start - b.annotation_start,
      );
      const idx1 = next.findIndex((c) => c.clip_id === seg1Id);
      if (idx1 >= 0) setCurrentClipIndex(idx1);
      return next;
    });
    setStatusMessage(
      `Split at ${formatTime(splitPoint)}. Segment 1: ${formatTime(start)}–${formatTime(splitPoint)}, Segment 2: ${formatTime(splitPoint)}–${formatTime(end)}.`,
    );
  }, [currentClip, clips, readPlayhead]);

  const handleSplitPromptContinue = useCallback(() => {
    setShowSplitPrompt(false);
    hasShownSplitPromptRef.current = true;
  }, []);



  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0a0c10] text-slate-200 font-sans selection:bg-indigo-500/30">
      <Header
        coverageStats={coverageStats}
        currentClip={currentClip}
        currentClipIndex={currentClipIndex}
        totalClips={clips.length}
        annotatedCount={annotations.length}
        matchPlanTotal={MATCH_PLAN_TOTAL}
        isGenerating={isGenerating}
        statusMessage={statusMessage}
        onLoadManifest={handleLoadManifest}
        onGenerateManifest={handleGenerateManifest}
        onLoadVideoDirect={handleLoadVideoDirect}
      />

      <div className="flex-1 flex overflow-hidden">
        <ClipExplorer
          clips={clips}
          filteredClips={filteredClips}
          currentClipIndex={currentClipIndex}
          annotations={annotations}
          clipFilter={clipFilter}
          clipSearch={clipSearch}
          clipListRef={clipListRef}
          isLoading={isLoading}
          onClipFilterChange={setClipFilter}
          onClipSearchChange={setClipSearch}
          onClipSelect={setCurrentClipIndex}
          onLoadManifest={handleLoadManifest}
          onLoadVideoDirect={handleLoadVideoDirect}
          onGenerateManifest={handleGenerateManifest}
          isGenerating={isGenerating}
          formatTime={formatTime}
          formatMatchClock={formatMatchClock}
          hasAnnotated={hasAnnotated}
          recentlyCreatedClipId={recentlyCreatedClipId}
          onDeleteSegment={handleDeleteSegment}
        />
        <main className="flex-1 flex flex-col p-4 overflow-hidden">
          <VideoPlayer
            videoRef={videoRef}
            videoContainerRef={videoContainerRef}
            currentClip={currentClip}
            clips={clips}
            currentClipIndex={currentClipIndex}
            matchDurationSec={videoDurationSec}
            isLoading={isLoading}
            isPlaying={isPlaying}
            isBuffering={isBuffering}
            videoCurrentTime={videoCurrentTime}
            isMuted={isMuted}
            playbackRate={playbackRate}
            loopClip={loopClip}
            videoError={videoError}
            isConverting={isConverting}
            creatingSegment={creatingSegment}
            onTogglePlayback={togglePlayback}
            onReplayClip={replayClip}
            onToggleFullscreen={toggleFullscreen}
            onProgressClick={handleProgressClick}
            onCycleSpeed={cycleSpeed}
            onToggleMute={toggleMute}
            onToggleLoop={() => setLoopClip(!loopClip)}
            onVideoPlay={() => setIsPlaying(true)}
            onVideoPause={() => setIsPlaying(false)}
            onVideoWaiting={() => setIsBuffering(true)}
            onVideoPlaying={() => setIsBuffering(false)}
            onVideoError={() => {
              setIsPlaying(false);
              const isMkv = currentClip?.path?.endsWith(".mkv");
              setVideoError(
                isMkv
                  ? 'MKV not supported. Click "Convert to MP4".'
                  : "Video load error",
              );
            }}
            onConvertVideo={handleConvertVideo}
            onLoadVideoDirect={handleLoadVideoDirect}
            onBoundaryNudge={handleBoundaryNudge}
            onStartSegmentCreate={handleStartSegmentCreate}
            onUpdateSegmentDraft={handleUpdateSegmentDraft}
            onCancelSegmentCreate={handleCancelSegmentCreate}
            onConfirmSegmentCreate={handleConfirmSegmentCreate}
            onHelp={() => setShowHelp(true)}
            getAnnotatorState={getAnnotatorState}
            formatTime={formatTime}
            setVideoError={setVideoError}
            onSetSegmentStart={handleSetSegmentStart}
            onSetSegmentEnd={handleSetSegmentEnd}
          />
          <IntentLabels
            currentTeam={currentTeam}
            selectedIntentA={selectedIntentA}
            selectedIntentB={selectedIntentB}
            teamConfig={teamConfig}
            disabledIntentIds={disabledIntentIds}
            detectedPossessionTeam={effectivePossessionTeam}
            contestedPossessionSuggested={isContestedPossessionSuggested}
            hasManualPossessionOverride={hasManualPossessionOverride}
            onIntentClick={handleIntentClick}
            onSubmit={() => saveAnnotation(false)}
            onSkip={() => saveAnnotation(true)}
          />
        </main>
        <AnnotationPanel
          currentTeam={currentTeam}
          onTeamChange={setCurrentTeam}
          teamConfig={teamConfig}
          onTeamConfigChange={setTeamConfig}
          gameState={gameState}
          onGameStateChange={setGameState}
          selectedIntentA={selectedIntentA}
          selectedIntentB={selectedIntentB}
          confidence={activeConfidence}
          onConfidenceChange={(value) => {
            setConfidence(value);
            currentTeam === "A" ? setConfidenceA(value) : setConfidenceB(value);
          }}
          certainty={activeCertainty}
          onCertaintyChange={(value) =>
            currentTeam === "A" ? setCertaintyA(value) : setCertaintyB(value)
          }
          coverageEstimate={coverageEstimate}
          onCoverageEstimateChange={setCoverageEstimate}
          segmentAdjustTenths={segmentAdjustTenths}
          onSegmentAdjustChange={handleSegmentAdjust}
          onAutoSegment={() => {}}
          onApproveSegment={() => {}}
          onRejectSegment={() => {}}
          detectedPossessionTeam={detectedPossessionTeam}
          manualPossession={manualPossession}
          onManualPossessionChange={setManualPossession}
          trackedPlayers={trackedPlayers}
          redTrackerCount={redTrackerCount}
          qualityPass={qualityPass}
          sessionBreakDue={sessionBreakDue}
          onAcknowledgeBreak={() => {
            setBreakAcknowledgedAt(annotations.length);
            setStatusMessage("Break acknowledged. Continue when ready.");
          }}
          isUncertain={isUncertain}
          onUncertainChange={setIsUncertain}
          autoNext={autoNext}
          onAutoNextChange={setAutoNext}
          annotationsCount={annotations.length}
          totalClips={clips.length}
          classDistribution={classDistribution}
          onSkip={() => saveAnnotation(true)}
          onSubmit={() => saveAnnotation(false)}
          onExportJSON={exportJSON}
          onExportCSV={exportCSV}
          onReset={resetSession}
        />
      </div>

      {/* Help modal */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="modal-in bg-[#0e1117] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">
                Keyboard Shortcuts
              </h3>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[11px]">
              {(
                [
                  ["Space / K", "Play / pause"],
                  ["J / L", "Seek -10s / +10s"],
                  ["← / →", "Seek -5s / +5s"],
                  ["⇧ ← / →", "Seek -1s / +1s"],
                  ["[ / ]", "Previous / next clip"],
                  ["A / B", "Switch team A / B"],
                  ["I", "Set segment start at playhead"],
                  ["O", "Set segment end at playhead"],
                  ["U", "Mute / unmute"],
                  ["F", "Toggle fullscreen"],
                  ["1–9, 0, Q, W, R, T", "Pick intent for active team"],
                  ["S", "Skip clip"],
                  ["Enter", "Submit / confirm mark → create segment"],
                  ["Esc", "Cancel marks / close help"],
                  ["?", "Show this help"],
                ] as const
              ).map(([keys, desc]) => (
                <div key={keys} className="flex items-center gap-2">
                  <kbd className="shrink-0 bg-white/10 border border-white/15 text-white px-1.5 py-0.5 rounded font-mono">
                    {keys}
                  </kbd>
                  <span className="text-slate-300">{desc}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[10px] text-slate-500">
              Tip: click anywhere on the timeline to seek. Use{" "}
              <kbd className="bg-white/10 border border-white/15 text-white px-1 py-0.5 rounded font-mono">
                I
              </kbd>{" "}
              and{" "}
              <kbd className="bg-white/10 border border-white/15 text-white px-1 py-0.5 rounded font-mono">
                O
              </kbd>{" "}
              to set the segment start/end at the current playhead.
            </p>
          </div>
        </div>
      )}

      {/* Video picker modal */}
      {showVideoPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a1d23] border border-white/10 rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-sm font-semibold text-white mb-1">
              Select a video
            </h3>
            <p className="text-[10px] text-slate-400 mb-4">
              Videos in{" "}
              <code className="bg-black/30 px-1 rounded">raw_videos/</code>{" "}
              directory
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
              {serverVideos.map((fname) => {
                const isMkv = fname.toLowerCase().endsWith(".mkv");
                return (
                  <button
                    key={fname}
                    type="button"
                    onClick={() => {
                      if (isMkv) {
                        setStatusMessage(
                          "MKV files need conversion. Click 'Prepare MP4' after loading.",
                        );
                      }
                      handleSelectServerVideo(fname);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/10 transition-colors text-left flex items-center gap-2"
                  >
                    <span className="text-indigo-400 text-[10px] font-mono">
                      {isMkv ? "\u{1F4E6}" : "\u{1F3AC}"}
                    </span>
                    <span className="text-xs text-slate-200 truncate">
                      {fname}
                    </span>
                    {isMkv && (
                      <span className="ml-auto text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                        MKV
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setShowVideoPicker(false)}
              className="mt-4 w-full px-3 py-2 text-[10px] text-slate-400 hover:text-white border border-white/10 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {showSplitPrompt && creatingSegment && (
        <SplitPrompt
          durationSec={Math.max(
            0,
            (creatingSegment.end >= 0
              ? creatingSegment.end
              : videoCurrentTime) - creatingSegment.start,
          )}
          onSplit={handleSplitSegment}
          onContinue={handleSplitPromptContinue}
        />
      )}
    </div>
  );
}

function getGroupHex(label: string): string {
  for (const g of TACTIC_INTENTS) {
    if (g.items.some((i) => i.label === label)) return g.hex;
  }
  return "#94a3b8";
}

function withCurrentTeamIdentity(
  annotations: Annotation[],
  teamConfig: { team_a: TeamConfig; team_b: TeamConfig },
): Annotation[] {
  return annotations.map((ann) => ({
    ...ann,
    team_config: teamConfig,
    team_a: {
      ...ann.team_a,
      team_name: teamConfig.team_a.name,
      jersey_color: teamConfig.team_a.jersey_color,
      is_home: teamConfig.team_a.is_home,
    },
    team_b: {
      ...ann.team_b,
      team_name: teamConfig.team_b.name,
      jersey_color: teamConfig.team_b.jersey_color,
      is_home: teamConfig.team_b.is_home,
    },
  }));
}

// Padding mask: first `tensorFrames` entries are 1 (real), rest are 0 (padded).
// The model uses this to ignore padded frames during training.
function makePaddingMask(tensorFrames: number): boolean[] {
  const realFrames = Math.max(0, Math.min(tensorFrames, 150));
  return Array.from({ length: 150 }, (_, i) => i < realFrames);
}

function toModelSamples(annotations: Annotation[]) {
  return annotations.map((ann) => {
    const tensorFrames =
      ann.segment_metadata?.tensor_frames ||
      ann.video_source?.tensor_frame_count ||
      ann.reconstruction.tensor_shape?.[0] ||
      100;

    const start_sec = Number(
      ann.segment_metadata?.start_sec ??
        ann.video_source?.label_start_sec ??
        ann.video_source?.seek_start_sec ??
        0,
    );
    const end_sec = Number(
      ann.segment_metadata?.end_sec ??
        ann.video_source?.label_end_sec ??
        ann.video_source?.seek_end_sec ??
        0,
    );
    const duration_sec = Number(
      ann.segment_metadata?.duration_sec ??
        (ann.video_source?.label_end_sec ?? 0) -
          (ann.video_source?.label_start_sec ?? 0),
    );
    const coverage_estimate = Number(
      ann.segment_metadata?.coverage_estimate ?? 1,
    );

    // Build deterministic npz path from clip metadata so export never has empty path.
    const matchId = ann.match_id || "unknown";
    const npzPath =
      ann.reconstruction.npz_path ||
      `data/trajectories/${matchId}/${ann.clip_id}.npz`;

    const common = {
      segment_id: ann.clip_id,
      match_id: ann.match_id || "unknown",
      half: ann.half || ann.game_state?.half || "1st",
      start_sec,
      end_sec,
      duration_sec,
      coverage_estimate,
      reconstruction: {
        npz_path: npzPath,
        tensor_shape: ann.reconstruction.tensor_shape || [150, 23, 4],
        tensor_fps:
          ann.reconstruction.tensor_fps || ann.video_source?.tensor_fps || 10,
        quality_pass: ann.reconstruction.quality_pass === true,
        tracked_players: ann.reconstruction.tracked_players || 22,
        padding_mask: (
          ann.reconstruction.padding_mask || makePaddingMask(tensorFrames)
        ).map((value) => (value ? 1 : 0)),
      },
    };

    if (ann.exclusion) {
      return {
        ...common,
        exclusion: ann.exclusion,
        model_split: ann.model_split?.assigned_split || "train",
      };
    }

    const confidenceA = ann.team_a?.label?.confidence || 3;
    const confidenceB = ann.team_b?.label?.confidence || 3;

    return {
      ...common,
      team_a: {
        label: {
          intent_class: ann.team_a.label.intent_class ?? null,
          confidence: confidenceA,
          certainty: ann.team_a.label.certainty || modelCertainty(confidenceA),
        },
        is_primary: ann.team_a.is_primary === true,
        possession: ann.team_a.possession === true,
      },
      team_b: {
        label: {
          intent_class: ann.team_b.label.intent_class ?? null,
          confidence: confidenceB,
          certainty: ann.team_b.label.certainty || modelCertainty(confidenceB),
        },
        is_primary: ann.team_b.is_primary === true,
        possession: ann.team_b.possession === true,
      },
      exclusion: null,
      model_split: ann.model_split?.assigned_split || "train",
    };
  });
}
