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
  type Certainty,
  type Clip,
  type Annotation,
  type GameState,
  type TeamConfig,
  type AnnotatorState,
  type ModelSplit,
} from "@/lib/constants";

import { formatTime, formatMatchClock } from "@/lib/utils";
import {
  MAX_SEGMENT_DURATION,
  MIN_SEGMENT_DURATION,
  generateClipId,
  generateNpzPath,
  MODEL_FPS,
  MAX_MODEL_FRAMES,
  computeTensorFrames,
  computePaddingMask,
  computeTensorShape,
} from "@/lib/constants";
import { splitSegmentBounds } from "@/lib/splitSegmentBounds";

const SERVER_URL = "/api";
interface MatchConfig {
  match_id: string;
  competition: string;
  season: string;
  match_date: string;
  home_team: string;
  away_team: string;
  final_score: string;
  halftime_score: string;
  annotator: string;
  annotator_license: string;
  session_id: string;
}

const DEFAULT_MATCH_CONFIG: MatchConfig = {
  match_id: "epl_2014-15_chelsea_burnley_2015-02-21",
  competition: "england_epl",
  season: "2014-2015",
  match_date: "2015-02-21",
  home_team: "Chelsea",
  away_team: "Burnley",
  final_score: "1-1",
  halftime_score: "1-0",
  annotator: "coach_001",
  annotator_license: "UEFA_Pro",
  session_id: "session_042",
};

const DEFAULT_TEAM_CONFIG: { team_a: TeamConfig; team_b: TeamConfig } = {
  team_a: { id: "A", name: "Chelsea", jersey_color: "#ef233c", is_home: true },
  team_b: { id: "B", name: "Burnley", jersey_color: "#3b82f6", is_home: false },
};

const DEFAULT_GAME_STATE: GameState = {
  half: "1st",
  match_clock_sec: 0,
  score_home: 0,
  score_away: 0,
};
const MATCH_DURATION_SEC = 90 * 60;

function titleCaseToken(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function deriveMatchDefaults(fileName: string) {
  const cleanName = fileName.replace(/\.[^.]+$/, "");
  const safeMatchId = cleanName
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const match_id = /^match[_-]/i.test(safeMatchId)
    ? safeMatchId
    : `match_${safeMatchId || "manual"}`;
  const parts = safeMatchId.split(/[_-]/).filter(Boolean);
  const hasTeamLikeName =
    parts.length >= 2 && !/^match$/i.test(parts[0]) && !/^\d+$/.test(parts[1]);
  const home_team = hasTeamLikeName ? titleCaseToken(parts[0]) : "Team A";
  const away_team = hasTeamLikeName ? titleCaseToken(parts[1]) : "Team B";

  return { match_id, home_team, away_team };
}

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

function validateBeforeSubmit(
  clip: Clip,
  teamAIntent: string | null,
  teamBIntent: string | null,
  coverageEstimate: number,
  usedNpzPaths: Set<string>,
  exclusion: string | null,
): { valid: boolean; error?: string } {
  const duration =
    (clip.annotation_end ?? clip.end) - (clip.annotation_start ?? clip.start);

  // 1. Duration gate
  if (duration < MIN_SEGMENT_DURATION) {
    return {
      valid: false,
      error: `Segment too short (${duration.toFixed(2)}s). Minimum is ${MIN_SEGMENT_DURATION}s.`,
    };
  }


  // 2. Exclusion gate (symmetrical check)
  if (exclusion) {
    const isTeamAValid = !teamAIntent || isExclusionIntent(teamAIntent);
    const isTeamBValid = !teamBIntent || isExclusionIntent(teamBIntent);
    if (!isTeamAValid || !isTeamBValid) {
      return {
        valid: false,
        error: "Exclusion intents cannot be mixed with tactical intents.",
      };
    }
  }

  // 3. Coverage gate
  if (coverageEstimate < 0.8) {
    return {
      valid: false,
      error: `Coverage too low (${(coverageEstimate * 100).toFixed(0)}%). Minimum is 80%.`,
    };
  }

  // 4. NPZ path uniqueness gate
  const npzPath = generateNpzPath(clip.match_id, clip.clip_id);
  if (usedNpzPaths.has(npzPath)) {
    return {
      valid: false,
      error: `Duplicate trajectory path: ${npzPath}. Regenerate clip ID.`,
    };
  }

  return { valid: true };
}

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
  const [matchConfig, setMatchConfig] =
    useState<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const [gameState, setGameState] = useState<GameState>(DEFAULT_GAME_STATE);
  // User-selected possession for the current segment:
  // "A" | "B" | "contested" | null (null = follow trajectory-detected team)
  const [manualPossession, setManualPossession] = useState<
    "A" | "B" | "contested" | null
  >(null);
  const [exclusion, setExclusion] = useState<
    "DeadBall" | "ContestedPlay" | null
  >(null);
  const [modelSplit, setModelSplit] = useState<string>("train");

  // Core data state
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeVideoPath, setActiveVideoPath] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [loopClip, setLoopClip] = useState(true);
  const [videoError, setVideoError] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);
  const convertPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [serverVideos, setServerVideos] = useState<string[]>([]);
  const [showVideoPicker, setShowVideoPicker] = useState(false);

  // Video state
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const loadedVideoPathRef = useRef("");
  const lastSeekClipIdRef = useRef("");
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
  const lastClip = clips[clips.length - 1];
  const draftStart = lastClip ? lastClip.annotation_end : 0;

  const currentClip = useMemo((): Clip | undefined => {
    if (clips.length > 0 && currentClipIndex < clips.length) {
      return clips[currentClipIndex];
    }
    if (!activeVideoPath) return undefined;
    const draftSegmentStart =
      creatingSegment && creatingSegment.start >= 0
        ? creatingSegment.start
        : draftStart;
    const endVal =
      creatingSegment && creatingSegment.end >= 0
        ? creatingSegment.end
        : videoCurrentTime;
    return {
      clip_id: "Draft Segment",
      match_id: lastClip?.match_id ?? "manual",
      path: lastClip?.path ?? activeVideoPath ?? "",
      start: Math.max(0, draftSegmentStart - 4),
      end: Math.min(videoDurationSec, endVal + 4),
      annotation_start: draftSegmentStart,
      annotation_end: endVal,
      annotation_window: Math.max(0, endVal - draftSegmentStart),
      half: lastClip?.half ?? 1,
      annotator_state: "manual" as AnnotatorState,
      is_locked: false,
    };
  }, [
    clips,
    currentClipIndex,
    draftStart,
    videoCurrentTime,
    activeVideoPath,
    lastClip,
    creatingSegment,
    videoDurationSec,
  ]);

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

  // ─── Save segment to server ───
  const saveSegmentToServer = useCallback((clip: Clip) => {
    fetch(`${SERVER_URL}/segments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clip),
    }).catch(() => console.warn("Failed to save segment to server"));
  }, []);

  // ─── Algorithm proposal / annotator decision callbacks ───
  const getAnnotatorState = useCallback((clip: Clip): AnnotatorState => {
    if (clip.is_locked) return clip.annotator_state || "accepted";
    if (!clip.algorithm_proposal) return "manual";
    if (clip.annotator_state === "accepted") return "accepted";
    if (clip.annotator_state === "modified") return "modified";
    if (clip.annotator_state === "rejected") return "rejected";
    return "unseen";
  }, []);

  const handleAcceptProposal = useCallback(
    (clipId: string) => {
      setClips((prev) => {
        const next = prev.map((clip) => {
          if (clip.clip_id === clipId) {
            const updated = {
              ...clip,
              annotator_state: "accepted" as AnnotatorState,
              is_locked: true,
            };
            saveSegmentToServer(updated);
            return updated;
          }
          return clip;
        });

        // Sync segments to server
        fetch(`${SERVER_URL}/segments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: next }),
        }).catch(() => console.warn("Failed to sync segments"));

        return next;
      });
      setStatusMessage(`Segment ${clipId} accepted and locked.`);
    },
    [saveSegmentToServer],
  );

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

  const handleMerge = useCallback(
    (clipId: string) => {
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
        const result = [...prev];
        result[idx - 1] = merged;
        const filteredClips = result.filter((_, i) => i !== idx);

        // Save merged segment to server and sync segments list
        saveSegmentToServer(merged);
        fetch(`${SERVER_URL}/segments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: filteredClips }),
        }).catch(() => console.warn("Failed to sync segments"));

        // Update annotations and sync to server
        setAnnotations((anns) => {
          const filteredAnns = anns.filter(
            (a) => a.clip_id !== clipId && a.clip_id !== previous.clip_id,
          );

          // Sort chronologically by half and start time
          const sortedAnn = [...filteredAnns].sort((a, b) => {
            const halfCmp = String(a.half).localeCompare(String(b.half));
            if (halfCmp !== 0) return halfCmp;
            const aStart =
              a.segment_metadata?.start_sec ??
              a.video_source?.label_start_sec ??
              0;
            const bStart =
              b.segment_metadata?.start_sec ??
              b.video_source?.label_start_sec ??
              0;
            return aStart - bStart;
          });

          fetch(`${SERVER_URL}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schema_version: "1.0.0",
              dataset: "TACTIC-Bench",
              team_config: teamConfig,
              match_config: matchConfig,
              annotations: sortedAnn,
            }),
          }).catch(() => console.warn("Sync failed"));
          return sortedAnn;
        });

        setStatusMessage(`Merged ${previous.clip_id} + ${clipId}.`);
        setCurrentClipIndex((prevIdx) => Math.max(0, idx - 1));
        return filteredClips;
      });
    },
    [saveSegmentToServer, teamConfig, matchConfig],
  );

  const copyAnnotationWithNewTimes = useCallback(
    (ann: Annotation, clip: Clip): Annotation => {
      const duration = clip.annotation_end - clip.annotation_start;
      const tensorFrames = Math.max(
        20,
        Math.min(150, Math.round(duration * 10)),
      );
      return {
        ...ann,
        clip_id: clip.clip_id,
        segment_metadata: {
          coverage_estimate: ann.segment_metadata?.coverage_estimate ?? 1.0,
          is_mixed_phase: ann.segment_metadata?.is_mixed_phase ?? false,
          ...ann.segment_metadata,
          start_sec: clip.annotation_start,
          end_sec: clip.annotation_end,
          duration_sec: Number(duration.toFixed(3)),
          tensor_frames: tensorFrames,
        },
        video_source: {
          ...ann.video_source,
          seek_start_sec: clip.start,
          label_start_sec: clip.annotation_start,
          label_end_sec: clip.annotation_end,
          seek_end_sec: clip.end,
          tensor_frame_count: tensorFrames,
        },
        reconstruction: {
          ...ann.reconstruction,
          npz_path:
            clip.reconstruction?.npz_path ||
            generateNpzPath(clip.match_id, clip.clip_id),
        },
      };
    },
    [],
  );

  const createSegmentsFromBoundary = useCallback(
    (
      matchId: string,
      half: number,
      startSec: number,
      endSec: number,
      baseClip: Partial<Clip>,
    ): Clip[] => {
      const totalDuration = endSec - startSec;
      const chunks: Clip[] = [];

      // Use the robust splitSegmentBounds algorithm from the library
      const bounds = splitSegmentBounds(
        Math.round(startSec * 1000),
        Math.round(endSec * 1000),
      );

      for (let i = 0; i < bounds.length; i++) {
        const bound = bounds[i];
        const chunkStartSec = bound.start / 1000;
        const chunkEndSec = bound.end / 1000;
        const chunkDuration = chunkEndSec - chunkStartSec;
        const clipId = generateClipId(matchId, half, chunkStartSec);

        const chunk: Clip = {
          ...baseClip,
          clip_id: clipId,
          match_id: matchId,
          path: baseClip.path || "",
          half,
          start: Math.max(0, chunkStartSec - 4),
          end: Math.min(videoDurationSec, chunkEndSec + 4),
          annotation_start: chunkStartSec,
          annotation_end: chunkEndSec,
          annotation_window: chunkDuration,
          game_clock: formatMatchClock(half, chunkStartSec),
          trajectory_path: generateNpzPath(matchId, clipId),
          reconstruction: {
            npz_path: generateNpzPath(matchId, clipId),
          },
        };

        chunks.push(chunk);
      }

      return chunks;
    },
    [videoDurationSec],
  );

  const buildSplitAnnotations = useCallback(
    (splitClips: Clip[], templateAnn: Annotation): Annotation[] => {
      const parentSegmentId = templateAnn.clip_id;
      const sourceStartSec =
        templateAnn.segment_metadata?.start_sec ??
        templateAnn.video_source?.label_start_sec;
      const sourceEndSec =
        templateAnn.segment_metadata?.end_sec ??
        templateAnn.video_source?.label_end_sec;

      return splitClips.map((clip, index) => {
        const ann = copyAnnotationWithNewTimes(templateAnn, clip);
        const segmentMetadata = ann.segment_metadata;
        return {
          ...ann,
          segment_metadata: {
            start_sec: segmentMetadata?.start_sec ?? clip.annotation_start,
            end_sec: segmentMetadata?.end_sec ?? clip.annotation_end,
            duration_sec:
              segmentMetadata?.duration_sec ??
              Number((clip.annotation_end - clip.annotation_start).toFixed(3)),
            tensor_frames:
              segmentMetadata?.tensor_frames ??
              Math.max(
                20,
                Math.min(
                  150,
                  Math.round(
                    (clip.annotation_end - clip.annotation_start) * 10,
                  ),
                ),
              ),
            preceding_event: segmentMetadata?.preceding_event,
            following_event: segmentMetadata?.following_event,
            coverage_estimate: segmentMetadata?.coverage_estimate ?? 1,
            is_mixed_phase: segmentMetadata?.is_mixed_phase ?? false,
            parent_segment_id: parentSegmentId,
            split_index: index + 1,
            split_count: splitClips.length,
            split_source_start_sec: sourceStartSec,
            split_source_end_sec: sourceEndSec,
          },
        };
      });
    },
    [copyAnnotationWithNewTimes],
  );

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
    if (duration < MIN_SEGMENT_DURATION) {
      setStatusMessage(
        `Segment must be at least ${MIN_SEGMENT_DURATION} seconds long.`,
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
    const matchId = matchConfig.match_id || currentClip?.match_id || "manual";
    const path = currentClip?.path ?? activeVideoPath ?? "";

    const id = generateClipId(matchId, half, start);
    const newClip: Clip = {
      clip_id: id,
      match_id: matchId,
      path,
      start: Math.max(0, start - 4),
      end: Math.min(videoDurationSec, end + 4),
      annotation_start: start,
      annotation_end: end,
      annotation_window: duration,
      half,
      game_clock: formatMatchClock(half, start),
      window_idx: currentClip?.window_idx,
      match_name: currentClip?.match_name || matchId,
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
      const idx = next.findIndex((c) => c.clip_id === id);
      if (idx >= 0) setCurrentClipIndex(idx);

      if (duration <= MAX_SEGMENT_DURATION) {
        fetch(`${SERVER_URL}/segments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: next }),
        }).catch(() => console.warn("Failed to sync segments"));
      }

      return next;
    });

    if (duration <= MAX_SEGMENT_DURATION) {
      saveSegmentToServer(newClip);
    }
    setCreatingSegment(null);
    setStatusMessage(
      duration > MAX_SEGMENT_DURATION
        ? `Segment created (${duration.toFixed(1)}s). It will split into valid chunks after you pick intents and press Enter.`
        : `Segment created (${duration.toFixed(1)}s). Pick intents and press Enter.`,
    );
  }, [
    creatingSegment,
    currentClip,
    videoDurationSec,
    saveSegmentToServer,
    clips,
    matchConfig,
    activeVideoPath,
  ]);

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
        if (!prev) return { start: t, end: t + MIN_SEGMENT_DURATION };
        return { start: t, end: Math.max(prev.end, t + MIN_SEGMENT_DURATION) };
      });
      setStatusMessage(`Start boundary set to ${formatTime(t)}`);
      return;
    }
    // Not in draft mode: auto-enter draft mode AND set start in one step.
    setCreatingSegment({ start: t, end: t + MIN_SEGMENT_DURATION });
    setStatusMessage(
      `Start boundary set to ${formatTime(t)}. Now press O to set end, then Enter to submit.`,
    );
  }, [creatingSegment, readPlayhead]);

  // O key: set the draft end and auto-confirm (create the clip).
  // No separate Enter press needed — O both sets the end and creates the segment.
  // Then the user picks intents and presses Enter to submit the annotation.
  const handleSetSegmentEnd = useCallback(() => {
    const t = readPlayhead();
    const isDraftMode =
      currentClipIndex >= clips.length ||
      (currentClip && currentClip.clip_id === "Draft Segment");
    if (isDraftMode) {
      const start = creatingSegment?.start ?? currentClip?.annotation_start ?? draftStart;
      const end = t;
      const duration = end - start;
      if (duration < MIN_SEGMENT_DURATION) {
        setStatusMessage(
          `Segment must be at least ${MIN_SEGMENT_DURATION} seconds long. Current: ${duration.toFixed(2)}s.`,
        );
        return;
      }
      if (duration > MAX_SEGMENT_DURATION) {
        setStatusMessage(
          `Segment too long (${duration.toFixed(1)}s). Will auto-split on submit. Press Enter to confirm.`,
        );
        // Don't return — allow creation, auto-split happens on submit
      }

      const path = lastClip?.path ?? activeVideoPath ?? "";
      const matchId = lastClip?.match_id ?? "manual";
      const half = lastClip?.half ?? 1;

      // Always create single segment — auto-split happens at submit time (Enter)
      const id = generateClipId(matchId, half, start);
      const newClip: Clip = {
        clip_id: id,
        match_id: matchId,
        path,
        start: Math.max(0, start - 4),
        end: Math.min(videoDurationSec, end + 4),
        annotation_start: start,
        annotation_end: end,
        annotation_window: duration,
        half,
        game_clock: formatMatchClock(half, start),
        annotator_state: "manual" as AnnotatorState,
        is_locked: false,
      };

      setClips((prev) => {
        const next = [...prev, newClip].sort(
          (a, b) => a.annotation_start - b.annotation_start,
        );
        const idx = next.findIndex((c) => c.clip_id === id);
        if (idx >= 0) setCurrentClipIndex(idx);

        if (duration <= MAX_SEGMENT_DURATION) {
          fetch(`${SERVER_URL}/segments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ segments: next }),
          }).catch(() => console.warn("Failed to sync segments"));
        }

        return next;
      });

      if (duration <= MAX_SEGMENT_DURATION) {
        saveSegmentToServer(newClip);
      }
      setCreatingSegment(null);
      if (duration > MAX_SEGMENT_DURATION) {
        setStatusMessage(
          `Segment created (${duration.toFixed(1)}s). Will auto-split into 15s chunks on submit. Pick intents and press Enter.`,
        );
      } else {
        setStatusMessage(
          `Segment created (${duration.toFixed(1)}s). Pick intents and press Enter.`,
        );
      }
      return;
    }

    // Normal mode: edit current clip's annotation end
    if (!currentClip) return;
    const newEnd = Math.min(
      videoDurationSec,
      Math.max(t, currentClip.annotation_start + MIN_SEGMENT_DURATION),
    );
    // Use deferred call so handleUpdateSegmentTimes doesn't need to be declared above
    handleUpdateSegmentTimesRef.current?.(currentClip.annotation_start, newEnd);
  }, [
    currentClipIndex,
    clips,
    creatingSegment,
    draftStart,
    lastClip,
    activeVideoPath,
    readPlayhead,
    videoDurationSec,
    saveSegmentToServer,
    currentClip,
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

  const handleAddNextSegment = useCallback(
    (start: number, end: number) => {
      const half = currentClip?.half ?? 1;
      const matchId = matchConfig.match_id || currentClip?.match_id || "manual";
      const path = currentClip?.path ?? activeVideoPath ?? "";
      const id = generateClipId(matchId, half, start);
      const duration = end - start;
      const newClip: Clip = {
        clip_id: id,
        match_id: matchId,
        path,
        start: Math.max(0, start - 4),
        end: Math.min(videoDurationSec, end + 4),
        annotation_start: start,
        annotation_end: end,
        annotation_window: duration,
        half,
        game_clock: formatMatchClock(half, start),
        annotator_state: "manual" as AnnotatorState,
        is_locked: false,
      };

      setClips((prev) => {
        const next = [...prev, newClip].sort(
          (a, b) => a.annotation_start - b.annotation_start,
        );
        const idx = next.findIndex((c) => c.clip_id === id);
        if (idx >= 0) setCurrentClipIndex(idx);

        // Sync segments to server
        fetch(`${SERVER_URL}/segments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: next }),
        }).catch(() => console.warn("Failed to sync segments"));

        return next;
      });

      saveSegmentToServer(newClip);
      setStatusMessage(
        `Contiguous segment created from ${formatTime(start)} to ${formatTime(end)}. Pick intents and press Enter.`,
      );
    },
    [
      currentClip,
      matchConfig,
      activeVideoPath,
      videoDurationSec,
      saveSegmentToServer,
    ],
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
          const lastIdx = allClips.length - 1;
          setActiveVideoPath(allClips[lastIdx].path);
          setCurrentClipIndex(lastIdx);
          setStatusMessage(`${allClips.length} clips loaded`);
          // Probe real duration so the timeline is correct from the start
          if (!allClips[lastIdx].path.startsWith("blob:")) {
            fetch(
              `${SERVER_URL}/videos/metadata?path=${encodeURIComponent(allClips[lastIdx].path)}`,
            )
              .then((r) => r.json())
              .then((d) => {
                if (d.durationSec > 0) setVideoDurationSec(d.durationSec);
              })
              .catch(() => {});
          }
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
          if (annData.match_config) setMatchConfig(annData.match_config);
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
    const videoPath = clip ? clip.path : activeVideoPath;
    if (!video || !videoPath) return;

    // Skip re-seeking when only clip times changed (same clip, same video)
    const clipId = clip?.clip_id ?? "";
    if (
      clipId &&
      clipId === lastSeekClipIdRef.current &&
      loadedVideoPathRef.current === videoPath
    ) {
      return;
    }
    lastSeekClipIdRef.current = clipId;

    setVideoError("");
    video.pause();

    const start = clip ? clip.annotation_start : 0;

    // For blob URLs (direct video load), skip server URL construction
    if (isBlobVideoRef.current || videoPath.startsWith("blob:")) {
      isBlobVideoRef.current = true;

      const onMeta = () => {
        video.currentTime = start;
        video.playbackRate = playbackRate;
        video.play().catch(() => {});
        setVideoDurationSec(video.duration);
        if (clip) {
          setClips((prev) =>
            prev.map((c) =>
              c.clip_id === clip.clip_id ? { ...c, end: video.duration } : c,
            ),
          );
        }
      };

      if (video.src !== videoPath) {
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        video.src = videoPath;
        video.load();
      } else {
        if (video.readyState >= 1) {
          onMeta();
        } else {
          video.addEventListener("loadedmetadata", onMeta, { once: true });
        }
      }

      loadedVideoPathRef.current = videoPath;
      setIsPlaying(true);
      setVideoCurrentTime(start);
      return () => {
        video.removeEventListener("loadedmetadata", onMeta);
      };
    }

    if (videoPath.toLowerCase().endsWith(".mkv")) {
      video.removeAttribute("src");
      video.load();
      loadedVideoPathRef.current = "";
      setIsPlaying(false);
      setVideoCurrentTime(start);
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
      video.currentTime = start;
      video.playbackRate = playbackRate;
      video.muted = isMuted;
      video.addEventListener("seeked", onSeeked, { once: true });
    };
    const needsReload =
      loadedVideoPathRef.current !== videoPath ||
      video.error != null ||
      video.networkState === 3;
    if (needsReload) {
      loadedVideoPathRef.current = videoPath;
      video.addEventListener("loadedmetadata", onLoadedMeta, { once: true });
      video.src = `${SERVER_URL}/videos/${encodeURI(videoPath)}`;
      video.load();
    } else {
      onLoadedMeta();
    }
    setIsPlaying(true);
    setVideoCurrentTime(start);
    return () => {
      cancelled = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onLoadedMeta);
    };
    // playbackRate + isMuted are applied imperatively on the element above
    // to avoid re-loading the video on every speed/mute change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClipIndex, clips, activeVideoPath]);

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

  // ─── Fetch real video duration via ffprobe ───
  const fetchVideoMetadata = useCallback(async (videoPath: string) => {
    try {
      const res = await fetch(
        `${SERVER_URL}/videos/metadata?path=${encodeURIComponent(videoPath)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.durationSec && data.durationSec > 0) {
        setVideoDurationSec(data.durationSec);
      }
    } catch {
      // ffprobe not available — <video>.loadedmetadata will set it later
    }
  }, []);

  // ─── Convert MKV to MP4 (background job with progress polling) ───
  const handleConvertVideo = async () => {
    const clip = clips[currentClipIndex];
    const videoPathToConvert = clip ? clip.path : activeVideoPath;
    if (!videoPathToConvert) return;
    if (videoPathToConvert.startsWith("blob:") || isBlobVideoRef.current) {
      setVideoError(
        "Conversion is only supported for server-hosted video files.",
      );
      return;
    }
    const sourceName = videoPathToConvert.replace(/^raw_videos\//, "");
    setIsConverting(true);
    setConvertProgress(0);
    setVideoError("Preparing browser-ready MP4… starting conversion.");
    try {
      const res = await fetch(`${SERVER_URL}/videos/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceName }),
      });
      const init = await res.json();

      // Legacy path: server returned success immediately (MP4 already existed)
      if (init.success && init.filename) {
        setVideoError("");
        setStatusMessage(init.message || `Video ready: ${init.filename}`);
        const newPath = `raw_videos/${init.filename}`;
        setClips((prev) =>
          prev.map((c) =>
            c.path === videoPathToConvert ? { ...c, path: newPath } : c,
          ),
        );
        setActiveVideoPath(newPath);
        loadedVideoPathRef.current = "";
        setIsConverting(false);
        fetchVideoMetadata(newPath);
        return;
      }

      if (!init.jobId) {
        setVideoError(init.error || "Failed to start conversion");
        setIsConverting(false);
        return;
      }

      // Poll the job status every 2 s
      const { jobId } = init;
      if (convertPollRef.current) clearInterval(convertPollRef.current);
      convertPollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(
            `${SERVER_URL}/videos/convert?jobId=${jobId}`,
          );
          const job = await pollRes.json();

          if (job.status === "running") {
            setConvertProgress(job.progress ?? 0);
            setVideoError(
              `Converting… ${job.progress ?? 0}% — large files may take several minutes.`,
            );
            return;
          }

          // Terminal state — stop polling
          clearInterval(convertPollRef.current!);
          convertPollRef.current = null;
          setIsConverting(false);

          if (job.status === "done") {
            setConvertProgress(100);
            setVideoError("");
            setStatusMessage(job.message || `Video ready: ${job.filename}`);
            const newPath = `raw_videos/${job.filename}`;
            setClips((prev) =>
              prev.map((c) =>
                c.path === videoPathToConvert ? { ...c, path: newPath } : c,
              ),
            );
            setActiveVideoPath(newPath);
            loadedVideoPathRef.current = "";
            fetchVideoMetadata(newPath);
          } else {
            setVideoError(job.detail || job.error || "Conversion failed");
          }
        } catch (pollErr: any) {
          clearInterval(convertPollRef.current!);
          convertPollRef.current = null;
          setIsConverting(false);
          setVideoError(`Poll error: ${pollErr.message}`);
        }
      }, 2000);
    } catch (err: any) {
      setVideoError(`Conversion error: ${err.message}`);
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
      setExclusion(
        (existing.exclusion as "DeadBall" | "ContestedPlay" | null) || null,
      );
      setModelSplit(existing.model_split?.assigned_split || "train");
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
      setExclusion(null);
      setModelSplit("train");
    }
  }, [
    currentClipIndex,
    clips,
    annotations,
    currentClip,
    detectedPossessionTeam,
  ]);

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
  // The video loops within the annotation window [annotation_start, annotation_end],
  // not the full video context [start, end]. This ensures the user only sees
  // the segment they are labeling.
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    const clip = clips[currentClipIndex];
    if (!video || !clip) return;
    if (rafRef.current) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const t = video.currentTime;
      setVideoCurrentTime(t);
      // Loop within the annotation window ONLY for previously created segments (not draft)
      const isDraft = clip.clip_id === "Draft Segment";
      if (!isDraft && t >= clip.annotation_end) {
        if (loopClip) {
          video.currentTime = clip.annotation_start;
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
    (matchTime: number) => {
      const video = videoRef.current;
      const segmentIdx = clips.findIndex(
        (clip) =>
          matchTime >= clip.annotation_start &&
          matchTime <= clip.annotation_end,
      );
      if (segmentIdx >= 0) setCurrentClipIndex(segmentIdx);
      if (video) video.currentTime = matchTime;
    },
    [clips],
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
    if (exclusion) {
      TACTIC_INTENTS.forEach((g) => {
        if (g.group !== "EXCLUSION") {
          g.items.forEach((i) => disabled.add(i.id));
        }
      });
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
    return Array.from(disabled);
  }, [
    selectedIntentA,
    selectedIntentB,
    exclusion,
    gameState.set_piece,
    effectivePossessionTeam,
  ]);

  const disabledIntentIdsB = useMemo(() => {
    const disabled = new Set<string>();
    const intentA = getIntentLabel(selectedIntentA);
    const intentB = getIntentLabel(selectedIntentB);
    if (exclusion) {
      TACTIC_INTENTS.forEach((g) => {
        if (g.group !== "EXCLUSION") {
          g.items.forEach((i) => disabled.add(i.id));
        }
      });
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
    return Array.from(disabled);
  }, [
    selectedIntentA,
    selectedIntentB,
    exclusion,
    gameState.set_piece,
    effectivePossessionTeam,
  ]);

  const disabledIntentIds =
    currentTeam === "A" ? disabledIntentIdsA : disabledIntentIdsB;

  const handleToggleExclusion = useCallback(
    (type: "DeadBall" | "ContestedPlay" | null) => {
      setExclusion((prev) => {
        const next = prev === type ? null : type;
        if (next) {
          setSelectedIntentA("");
          setSelectedIntentB("");
          setModelSplit("excluded");
        } else {
          setModelSplit("train");
        }
        return next;
      });
    },
    [],
  );

  // ─── Intent handler ───
  const handleIntentClick = useCallback(
    (id: string) => {
      if (disabledIntentIds.includes(id)) return;
      const label = getIntentLabel(id);
      if (isExclusionIntent(label)) {
        handleToggleExclusion(label as "DeadBall" | "ContestedPlay");
        return;
      }
      const isSetPiece = isSetPieceIntent(label);
      if (currentTeam === "A") {
        const newVal = selectedIntentA === id ? "" : id;
        setSelectedIntentA(newVal);
        if (isSetPiece && newVal !== "") {
          setGameState((prev) => ({
            ...prev,
            set_piece: true,
            set_piece_type: prev.set_piece_type || "corner",
          }));
        }
      } else {
        const newVal = selectedIntentB === id ? "" : id;
        setSelectedIntentB(newVal);
        if (isSetPiece && newVal !== "") {
          setGameState((prev) => ({
            ...prev,
            set_piece: true,
            set_piece_type: prev.set_piece_type || "corner",
          }));
        }
      }
    },
    [
      currentTeam,
      selectedIntentA,
      selectedIntentB,
      disabledIntentIds,
      handleToggleExclusion,
      setGameState,
    ],
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
      const isDraft =
        currentClip.clip_id === "Draft Segment" ||
        currentClipIndex >= clips.length;
      if (isDraft) {
        const previousClip = clips[clips.length - 1];
        const minStart = previousClip?.annotation_end ?? 0;
        const maxEnd = videoDurationSec;
        const nextStart =
          edge === "start"
            ? Math.max(
                minStart,
                Math.min(
                  currentClip.annotation_start + deltaSec,
                  currentClip.annotation_end - MIN_SEGMENT_DURATION,
                ),
              )
            : currentClip.annotation_start;
        const nextEnd =
          edge === "end"
            ? Math.min(
                maxEnd,
                Math.max(
                  currentClip.annotation_end + deltaSec,
                  nextStart + MIN_SEGMENT_DURATION,
                ),
              )
            : currentClip.annotation_end;
        setCreatingSegment({ start: nextStart, end: nextEnd });
        return;
      }

      const previousClip = clips[currentClipIndex - 1];
      const nextClip = clips[currentClipIndex + 1];
      const minStart = previousClip?.annotation_end ?? 0;
      const maxEnd = nextClip?.annotation_start ?? videoDurationSec;
      const nextStart =
        edge === "start"
          ? Math.max(
              minStart,
              Math.min(
                currentClip.annotation_start + deltaSec,
                currentClip.annotation_end - MIN_SEGMENT_DURATION,
              ),
            )
          : currentClip.annotation_start;
      const nextEnd =
        edge === "end"
          ? Math.min(
              maxEnd,
              Math.max(
                currentClip.annotation_end + deltaSec,
                nextStart + MIN_SEGMENT_DURATION,
              ),
            )
          : currentClip.annotation_end;

      if (nextEnd - nextStart < MIN_SEGMENT_DURATION) return;

      let newState: AnnotatorState = currentClip.annotator_state || "unseen";
      if (currentClip.algorithm_proposal) {
        const startChanged =
          Math.abs(nextStart - currentClip.algorithm_proposal.start) > 0.5;
        const endChanged =
          Math.abs(nextEnd - currentClip.algorithm_proposal.end) > 0.5;
        if (startChanged || endChanged) newState = "modified";
      }

      const updatedClip: Clip = {
        ...currentClip,
        start: Math.max(0, nextStart - 4),
        end: Math.min(videoDurationSec, nextEnd + 4),
        annotation_start: nextStart,
        annotation_end: nextEnd,
        annotation_window: nextEnd - nextStart,
        annotator_state: newState,
        game_clock: formatMatchClock(currentClip.half ?? 1, nextStart),
      };

      setClips((prev) =>
        prev.map((clip, idx) => (idx === currentClipIndex ? updatedClip : clip)),
      );

      saveSegmentToServer(updatedClip);
      const video = videoRef.current;
      if (video) {
        video.currentTime = edge === "start" ? nextStart : nextEnd;
      }

      // Update annotation in annotations list and sync to server immediately
      setAnnotations((prevAnn) => {
        const updatedAnn = prevAnn.map((ann) => {
          if (ann.clip_id !== updatedClip.clip_id) return ann;
          const duration =
            updatedClip.annotation_end - updatedClip.annotation_start;
          const tensorFrames = Math.max(
            20,
            Math.min(150, Math.round(duration * 10)),
          );
          return {
            ...ann,
            segment_metadata: {
              coverage_estimate:
                ann.segment_metadata?.coverage_estimate ?? 1.0,
              is_mixed_phase: ann.segment_metadata?.is_mixed_phase ?? false,
              ...ann.segment_metadata,
              start_sec: updatedClip.annotation_start,
              end_sec: updatedClip.annotation_end,
              duration_sec: duration,
              tensor_frames: tensorFrames,
            },
            video_source: {
              ...ann.video_source,
              seek_start_sec: updatedClip.start,
              label_start_sec: updatedClip.annotation_start,
              label_end_sec: updatedClip.annotation_end,
              seek_end_sec: updatedClip.end,
              tensor_frame_count: tensorFrames,
            },
            reconstruction: {
              ...ann.reconstruction,
            },
          };
        });

        // Sort annotations chronologically by half and start time
        const sortedAnn = [...updatedAnn].sort((a, b) => {
          const halfCmp = String(a.half).localeCompare(String(b.half));
          if (halfCmp !== 0) return halfCmp;
          const aStart =
            a.segment_metadata?.start_sec ??
            a.video_source?.label_start_sec ??
            0;
          const bStart =
            b.segment_metadata?.start_sec ??
            b.video_source?.label_start_sec ??
            0;
          return aStart - bStart;
        });

        fetch(`${SERVER_URL}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "1.0.0",
            dataset: "TACTIC-Bench",
            team_config: teamConfig,
            match_config: matchConfig,
            annotations: sortedAnn,
          }),
        }).catch(() => console.warn("Sync failed"));

        return sortedAnn;
      });
    },
    [
      currentClip,
      currentClipIndex,
      clips,
      videoDurationSec,
      saveSegmentToServer,
      teamConfig,
      matchConfig,
    ],
  );

  const syncAnnotationsWithClips = useCallback(
    (updatedClips: Clip[], currentAnnotations: Annotation[]): Annotation[] => {
      const clipIds = new Set(updatedClips.map((c) => c.clip_id));
      let filtered = currentAnnotations.filter((a) => clipIds.has(a.clip_id));

      filtered = filtered.map((ann) => {
        const clip = updatedClips.find((c) => c.clip_id === ann.clip_id);
        if (!clip) return ann;
        const duration = clip.annotation_end - clip.annotation_start;
        const tensorFrames = Math.max(
          20,
          Math.min(150, Math.round(duration * 10)),
        );
        return {
          ...ann,
          segment_metadata: {
            ...ann.segment_metadata,
            start_sec: clip.annotation_start,
            end_sec: clip.annotation_end,
            duration_sec: duration,
            tensor_frames: tensorFrames,
          },
          video_source: {
            ...ann.video_source,
            seek_start_sec: clip.start,
            label_start_sec: clip.annotation_start,
            label_end_sec: clip.annotation_end,
            seek_end_sec: clip.end,
            tensor_frame_count: tensorFrames,
          },
          reconstruction: {
            ...ann.reconstruction,
          },
        } as Annotation;
      });

      return filtered;
    },
    [],
  );

  const handleUpdateSegmentTimes = useCallback(
    (
      start: number,
      end: number,
      editedEdge: "start" | "end" | "both" = "both",
    ) => {
      if (!currentClip) return;
      const isDraft =
        currentClip.clip_id === "Draft Segment" ||
        currentClipIndex >= clips.length;

      const previousClip = isDraft
        ? clips[clips.length - 1]
        : clips[currentClipIndex - 1];
      const nextClip = isDraft ? undefined : clips[currentClipIndex + 1];
      const minStart = previousClip?.annotation_end ?? 0;
      const maxEnd = nextClip?.annotation_start ?? videoDurationSec;

      const activeStart = currentClip.annotation_start;
      const activeEnd = currentClip.annotation_end;
      const startChanged = Math.abs(start - activeStart) > 0.001;
      const endChanged = Math.abs(end - activeEnd) > 0.001;
      const resolvedEdge =
        editedEdge !== "both"
          ? editedEdge
          : startChanged && !endChanged
            ? "start"
            : endChanged && !startChanged
              ? "end"
              : "both";

      let boundedStart = activeStart;
      let boundedEnd = activeEnd;
      if (resolvedEdge === "start") {
        boundedEnd = activeEnd;
        boundedStart = Math.max(
          minStart,
          Math.min(start, boundedEnd - MIN_SEGMENT_DURATION),
        );
      } else if (resolvedEdge === "end") {
        boundedStart = activeStart;
        boundedEnd = Math.min(
          maxEnd,
          Math.max(end, boundedStart + MIN_SEGMENT_DURATION),
        );
      } else {
        boundedStart = Math.max(
          minStart,
          Math.min(start, maxEnd - MIN_SEGMENT_DURATION),
        );
        boundedEnd = Math.min(
          maxEnd,
          Math.max(end, boundedStart + MIN_SEGMENT_DURATION),
        );
      }
      const duration = boundedEnd - boundedStart;

      if (duration < MIN_SEGMENT_DURATION) {
        setStatusMessage(
          `Segment must be at least ${MIN_SEGMENT_DURATION} seconds long.`,
        );
        return;
      }

      if (isDraft) {
        setCreatingSegment({ start: boundedStart, end: boundedEnd });
        setStatusMessage(
          `Draft timing updated: ${boundedStart.toFixed(1)}s - ${boundedEnd.toFixed(1)}s`,
        );
        return;
      }

      if (duration > MAX_SEGMENT_DURATION) {
        setClips((prev) => {
          const next = prev.map((c, idx) => {
            if (idx !== currentClipIndex) return c;
            let newState: AnnotatorState = c.annotator_state || "unseen";
            if (c.algorithm_proposal) {
              const startChanged =
                Math.abs(boundedStart - c.algorithm_proposal.start) > 0.5;
              const endChanged =
                Math.abs(boundedEnd - c.algorithm_proposal.end) > 0.5;
              if (startChanged || endChanged) newState = "modified";
            }
            return {
              ...c,
              start: Math.max(0, boundedStart - 4),
              end: Math.min(videoDurationSec, boundedEnd + 4),
              annotation_start: boundedStart,
              annotation_end: boundedEnd,
              annotation_window: duration,
              annotator_state: newState,
              game_clock: formatMatchClock(c.half ?? 1, boundedStart),
            };
          });
          return [...next].sort(
            (a, b) => a.annotation_start - b.annotation_start,
          );
        });
        setStatusMessage(
          `Segment timing updated (${duration.toFixed(1)}s). It will split into valid chunks when you press Enter.`,
        );
        return;
      }

      setClips((prev) => {
        const next = prev.map((c, idx) => {
          if (idx !== currentClipIndex) return c;
          let newState: AnnotatorState = c.annotator_state || "unseen";
          if (c.algorithm_proposal) {
            const startChanged =
              Math.abs(boundedStart - c.algorithm_proposal.start) > 0.5;
            const endChanged =
              Math.abs(boundedEnd - c.algorithm_proposal.end) > 0.5;
            if (startChanged || endChanged) newState = "modified";
          }
          return {
            ...c,
            start: Math.max(0, boundedStart - 4),
            end: Math.min(videoDurationSec, boundedEnd + 4),
            annotation_start: boundedStart,
            annotation_end: boundedEnd,
            annotation_window: duration,
            annotator_state: newState,
            game_clock: formatMatchClock(c.half ?? 1, boundedStart),
          };
        });

        const sorted = [...next].sort(
          (a, b) => a.annotation_start - b.annotation_start,
        );

        // Update annotations state and sync to server
        setAnnotations((prevAnn) => {
          const updatedAnn = syncAnnotationsWithClips(sorted, prevAnn);
          fetch(`${SERVER_URL}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schema_version: "1.0.0",
              dataset: "TACTIC-Bench",
              team_config: teamConfig,
              match_config: matchConfig,
              annotations: updatedAnn,
            }),
          }).catch(() => console.warn("Sync failed"));
          return updatedAnn;
        });

        // Sync segments to server
        fetch(`${SERVER_URL}/segments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: sorted }),
        }).catch(() => console.warn("Failed to sync segments"));

        return sorted;
      });

      setStatusMessage(
        `Segment timing updated: ${boundedStart.toFixed(1)}s - ${boundedEnd.toFixed(1)}s`,
      );
    },
    [
      currentClip,
      currentClipIndex,
      videoDurationSec,
      teamConfig,
      matchConfig,
      syncAnnotationsWithClips,
      clips,
    ],
  );

  const handleUpdateSegmentEdgeTime = useCallback(
    (edge: "start" | "end", value: number) => {
      if (!currentClip) return;
      const isDraft =
        currentClip.clip_id === "Draft Segment" ||
        currentClipIndex >= clips.length;

      if (isDraft) {
        const previousClip = clips[clips.length - 1];
        const minStart = previousClip?.annotation_end ?? 0;
        const maxEnd = videoDurationSec;
        const baseStart =
          creatingSegment?.start ?? currentClip.annotation_start ?? minStart;
        const baseEnd =
          creatingSegment?.end ??
          currentClip.annotation_end ??
          baseStart + MIN_SEGMENT_DURATION;
        const nextStart =
          edge === "start"
            ? Math.max(
                minStart,
                Math.min(value, baseEnd - MIN_SEGMENT_DURATION),
              )
            : baseStart;
        const nextEnd =
          edge === "end"
            ? Math.min(
                maxEnd,
                Math.max(value, nextStart + MIN_SEGMENT_DURATION),
              )
            : baseEnd;
        setCreatingSegment({ start: nextStart, end: nextEnd });
        setStatusMessage(
          `Draft ${edge} updated: ${nextStart.toFixed(1)}s - ${nextEnd.toFixed(1)}s`,
        );
        return;
      }

      setClips((prev) => {
        const selected = prev[currentClipIndex];
        if (!selected) return prev;

        const previousClip = prev[currentClipIndex - 1];
        const nextClip = prev[currentClipIndex + 1];
        const minStart = previousClip?.annotation_end ?? 0;
        const maxEnd = nextClip?.annotation_start ?? videoDurationSec;

        const nextStart =
          edge === "start"
            ? Math.max(
                minStart,
                Math.min(value, selected.annotation_end - MIN_SEGMENT_DURATION),
              )
            : selected.annotation_start;
        const nextEnd =
          edge === "end"
            ? Math.min(
                maxEnd,
                Math.max(value, selected.annotation_start + MIN_SEGMENT_DURATION),
              )
            : selected.annotation_end;
        const duration = nextEnd - nextStart;
        if (duration < MIN_SEGMENT_DURATION) return prev;

        let newState: AnnotatorState =
          selected.annotator_state || "unseen";
        if (selected.algorithm_proposal) {
          const startChanged =
            Math.abs(nextStart - selected.algorithm_proposal.start) > 0.5;
          const endChanged =
            Math.abs(nextEnd - selected.algorithm_proposal.end) > 0.5;
          if (startChanged || endChanged) newState = "modified";
        }

        const updatedClip: Clip = {
          ...selected,
          start: Math.max(0, nextStart - 4),
          end: Math.min(videoDurationSec, nextEnd + 4),
          annotation_start: nextStart,
          annotation_end: nextEnd,
          annotation_window: duration,
          annotator_state: newState,
          game_clock: formatMatchClock(selected.half ?? 1, nextStart),
        };

        const next = prev.map((clip, idx) =>
          idx === currentClipIndex ? updatedClip : clip,
        );
        const sorted = [...next].sort(
          (a, b) => a.annotation_start - b.annotation_start,
        );

        setAnnotations((prevAnn) => {
          const updatedAnn = syncAnnotationsWithClips(sorted, prevAnn);
          fetch(`${SERVER_URL}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schema_version: "1.0.0",
              dataset: "TACTIC-Bench",
              team_config: teamConfig,
              match_config: matchConfig,
              annotations: updatedAnn,
            }),
          }).catch(() => console.warn("Sync failed"));
          return updatedAnn;
        });

        fetch(`${SERVER_URL}/segments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: sorted }),
        }).catch(() => console.warn("Failed to sync segments"));

        saveSegmentToServer(updatedClip);
        const video = videoRef.current;
        if (video) {
          video.currentTime = edge === "start" ? nextStart : nextEnd;
        }
        setStatusMessage(
          `Segment ${edge} updated: ${nextStart.toFixed(1)}s - ${nextEnd.toFixed(1)}s`,
        );

        return sorted;
      });
    },
    [
      currentClip,
      currentClipIndex,
      clips,
      creatingSegment,
      videoDurationSec,
      saveSegmentToServer,
      syncAnnotationsWithClips,
      teamConfig,
      matchConfig,
    ],
  );

  const handleUpdateSegmentStart = useCallback(
    (start: number) => handleUpdateSegmentEdgeTime("start", start),
    [handleUpdateSegmentEdgeTime],
  );

  const handleUpdateSegmentEnd = useCallback(
    (end: number) => handleUpdateSegmentEdgeTime("end", end),
    [handleUpdateSegmentEdgeTime],
  );

  // Ref so handleSetSegmentEnd can call handleUpdateSegmentTimes without forward-reference issues
  const handleUpdateSegmentTimesRef = useRef(handleUpdateSegmentTimes);
  handleUpdateSegmentTimesRef.current = handleUpdateSegmentTimes;

  // ─── Delete segment ───
  const handleDeleteSegment = useCallback(
    (clipId: string) => {
      if (!window.confirm(`Delete segment ${clipId}? This cannot be undone.`)) {
        return;
      }
      setClips((prev) => {
        const filtered = prev.filter((c) => c.clip_id !== clipId);
        // Don't re-chain timestamps — keep original times intact.
        // Just remove the clip. Annotations for other clips remain valid.

        // Update annotations: remove the deleted clip's annotation
        setAnnotations((prevAnn) => {
          const filteredAnn = prevAnn.filter((a) => a.clip_id !== clipId);
          // Sort chronologically by half and start time
          const sortedAnn = [...filteredAnn].sort((a, b) => {
            const halfCmp = String(a.half).localeCompare(String(b.half));
            if (halfCmp !== 0) return halfCmp;
            const aStart =
              a.segment_metadata?.start_sec ??
              a.video_source?.label_start_sec ??
              0;
            const bStart =
              b.segment_metadata?.start_sec ??
              b.video_source?.label_start_sec ??
              0;
            return aStart - bStart;
          });

          // Sync to server
          fetch(`${SERVER_URL}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schema_version: "1.0.0",
              dataset: "TACTIC-Bench",
              team_config: teamConfig,
              match_config: matchConfig,
              annotations: sortedAnn,
            }),
          }).catch(() => console.warn("Sync failed"));
          return sortedAnn;
        });

        // Save all segments to server (overwrite the list on server)
        fetch(`${SERVER_URL}/segments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: filtered }),
        }).catch(() => console.warn("Failed to sync segments on server"));

        // Select appropriate index
        if (filtered.length > 0) {
          setCurrentClipIndex((prevIdx) =>
            Math.min(prevIdx, filtered.length - 1),
          );
        } else {
          setCurrentClipIndex(0);
          setCreatingSegment({ start: 0, end: 2 });
        }

        return filtered;
      });

      setStatusMessage(`Segment ${clipId} deleted.`);
    },
    [teamConfig, matchConfig],
  );

  // ─── Save annotation ───
  const saveAnnotation = useCallback(() => {
    if (!currentClip) {
      console.warn("[saveAnnotation] No current clip");
      return;
    }
    if (!exclusion && !selectedIntentA && !selectedIntentB) {
      setStatusMessage("Select at least one label or use ContestedPlay.");
      return;
    }
    if (annotations.length >= 50 && !hasAnnotated(currentClip.clip_id)) {
      setStatusMessage(
        "Session hard cap reached at 50 clips. Export or reset before continuing.",
      );
      return;
    }
    if (sessionBreakDue) {
      setStatusMessage(
        "Forced session break due. Click Resume After Break before continuing.",
      );
      return;
    }
    const intentLabelA = getIntentLabel(selectedIntentA);
    const intentLabelB = getIntentLabel(selectedIntentB);
    const isDraft = currentClip.clip_id === "Draft Segment";
    const matchId = matchConfig.match_id || currentClip.match_id || "manual";
    const realClipId = isDraft
      ? generateClipId(
          matchId,
          currentClip.half ?? 1,
          currentClip.annotation_start,
        )
      : currentClip.clip_id;

    const newClip: Clip = isDraft
      ? { ...currentClip, clip_id: realClipId, match_id: matchId }
      : { ...currentClip, match_id: matchId };

    const usedNpzPaths = new Set(
      clips
        .filter(
          (c) => c.clip_id !== currentClip.clip_id && c.clip_id !== realClipId,
        )
        .map((c) => generateNpzPath(c.match_id, c.clip_id)),
    );

    const validation = validateBeforeSubmit(
      newClip,
      intentLabelA,
      intentLabelB,
      coverageEstimate / 100,
      usedNpzPaths,
      exclusion,
    );

    if (!validation.valid) {
      setStatusMessage(validation.error || "Validation failed.");
      return;
    }
    try {
      const fps = currentClip.resolution?.fps ?? 25;
      const clipDur = currentClip.end - currentClip.start;
      const labelDur =
        currentClip.annotation_end - currentClip.annotation_start;
      if (labelDur < 2) {
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
      };

      const isDraft = currentClip.clip_id === "Draft Segment";
      const matchId = matchConfig.match_id || currentClip.match_id || "manual";
      const realClipId = isDraft
        ? generateClipId(
            matchId,
            currentClip.half ?? 1,
            currentClip.annotation_start,
          )
        : currentClip.clip_id;

      const newClip: Clip = isDraft
        ? { ...currentClip, clip_id: realClipId, match_id: matchId }
        : { ...currentClip, match_id: matchId };

      const tensorFrames = Math.max(
        20,
        Math.min(150, Math.round(labelDur * 10)),
      );

      if (labelDur > MAX_SEGMENT_DURATION) {
        // Auto-split at 15s
        const splitClips = createSegmentsFromBoundary(
          newClip.match_id,
          newClip.half,
          newClip.annotation_start,
          newClip.annotation_end,
          newClip,
        );
        const remainderId = splitClips[splitClips.length - 1].clip_id;

        const intentLabelA = getIntentLabel(selectedIntentA);
        const intentLabelB = getIntentLabel(selectedIntentB);
        const effectiveExclusion = exclusion;
        let teamAIntentClass: string | null = effectiveExclusion
          ? null
          : intentLabelA;
        let teamBIntentClass: string | null = effectiveExclusion
          ? null
          : intentLabelB;

        // Derive possession for Segment A
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
        if (!effectiveExclusion && !teamAPossession && !teamBPossession) {
          setStatusMessage(
            "Choose Team A/B possession for tactical labels, or mark the segment as ContestedPlay.",
          );
          return;
        }

        const templateAnn: Annotation = {
          schema_version: "1.0.0",
          dataset: "TACTIC-Bench",
          clip_id: realClipId,
          match_id: newClip.match_id,
          match_name: newClip.match_name || newClip.match_id,
          half: HALF_LABEL(newClip.half),
          window_idx: isDraft
            ? clips.length
            : (newClip.window_idx ?? currentClipIndex),
          segment_metadata: {
            start_sec: newClip.annotation_start,
            end_sec: newClip.annotation_end,
            duration_sec: Number(labelDur.toFixed(3)),
            tensor_frames: tensorFrames,
            preceding_event: newClip.anchor_event?.type,
            following_event: newClip.following_event,
            coverage_estimate: Number((coverageEstimate / 100).toFixed(3)),
            is_mixed_phase: isMixedPhase,
          },
          game_state: cleanedGameState,
          video_source: {
            video_path: newClip.path,
            seek_start_sec: newClip.start,
            label_start_sec: newClip.annotation_start,
            label_end_sec: newClip.annotation_end,
            seek_end_sec: newClip.end,
            fps,
            tensor_fps: 10,
            source_frame_count: Math.round(clipDur * fps),
            tensor_frame_count: tensorFrames,
          },
          reconstruction: {
            npz_path: generateNpzPath(newClip.match_id, newClip.clip_id),
            quality_pass: qualityPass,
            tracked_players: trackedPlayers,
          },
          team_a: {
            team_id: "Team_A",
            team_name: teamConfig.team_a.name,
            jersey_color: teamConfig.team_a.jersey_color,
            is_home: teamConfig.team_a.is_home,
            is_primary: teamAPossession,
            label: {
              intent_class: teamAIntentClass,
              confidence: confidenceA,
              certainty: certaintyA,
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
              confidence: confidenceB,
              certainty: certaintyB,
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
            skipped: false,
          },
          model_split: {
            assigned_split: effectiveExclusion ? "excluded" : modelSplit,
          },
        };

        const newAnns = buildSplitAnnotations(splitClips, templateAnn);
        const newAnnIds = new Set(newAnns.map((ann) => ann.clip_id));

        const updated = [
          ...annotations.filter(
            (a) =>
              !newAnnIds.has(a.clip_id) &&
              a.clip_id !== currentClip.clip_id &&
              a.clip_id !== realClipId,
          ),
          ...newAnns,
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

        setClips((prev) => {
          const filtered = prev.filter(
            (c) =>
              c.clip_id !== currentClip.clip_id && c.clip_id !== realClipId,
          );
          const next = [...filtered, ...splitClips].sort(
            (a, b) => a.annotation_start - b.annotation_start,
          );

          // Always advance to draft mode for next segment
          setCurrentClipIndex(next.length);

          // Sync segments to server
          fetch(`${SERVER_URL}/segments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ segments: next }),
          }).catch(() => console.warn("Failed to sync segments"));

          return next;
        });

        splitClips.forEach((c) => saveSegmentToServer(c));
        // Auto-chain: create new segment draft from end of last split
        const lastSplitEnd = splitClips[splitClips.length - 1].annotation_end;
        setCreatingSegment({ start: lastSplitEnd, end: lastSplitEnd + 2 });
        if (videoRef.current) {
          videoRef.current.currentTime = lastSplitEnd;
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
        }
        setStatusMessage(
          `Auto-split: ${splitClips.length} segments saved. Next segment starts at ${formatTime(lastSplitEnd)}. Press O to mark end.`,
        );

        // Sync annotations to server
        fetch(`${SERVER_URL}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "1.0.0",
            dataset: "TACTIC-Bench",
            team_config: teamConfig,
            match_config: matchConfig,
            annotations: updated,
          }),
        }).catch(() => console.warn("Sync failed"));

        return;
      }

      const intentLabelA = getIntentLabel(selectedIntentA);
      const intentLabelB = getIntentLabel(selectedIntentB);
      const effectiveExclusion = exclusion;
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
      if (!effectiveExclusion && !teamAPossession && !teamBPossession) {
        setStatusMessage(
          "Choose Team A/B possession for tactical labels, or mark the segment as ContestedPlay.",
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
        clip_id: realClipId,
        match_id: newClip.match_id,
        match_name: newClip.match_name || newClip.match_id,
        half: HALF_LABEL(newClip.half),
        window_idx: isDraft
          ? clips.length
          : (newClip.window_idx ?? currentClipIndex),
        segment_metadata: {
          start_sec: newClip.annotation_start,
          end_sec: newClip.annotation_end,
          duration_sec: Number(labelDur.toFixed(3)),
          tensor_frames: tensorFrames,
          preceding_event: newClip.anchor_event?.type,
          following_event: newClip.following_event,
          coverage_estimate: Number((coverageEstimate / 100).toFixed(3)),
          is_mixed_phase: isMixedPhase,
        },
        game_state: cleanedGameState,
        video_source: {
          video_path: newClip.path,
          seek_start_sec: newClip.start,
          label_start_sec: newClip.annotation_start,
          label_end_sec: newClip.annotation_end,
          seek_end_sec: newClip.end,
          fps,
          tensor_fps: 10,
          source_frame_count: Math.round(clipDur * fps),
          tensor_frame_count: tensorFrames,
        },
        reconstruction: {
          npz_path: generateNpzPath(newClip.match_id, newClip.clip_id),
          quality_pass: qualityPass,
          tracked_players: trackedPlayers,
        },
        team_a: {
          team_id: "Team_A",
          team_name: teamConfig.team_a.name,
          jersey_color: teamConfig.team_a.jersey_color,
          is_home: teamConfig.team_a.is_home,
          is_primary: teamAPrimary,
          label: {
            intent_class: teamAIntentClass,
            confidence: confidenceA,
            certainty: certaintyA,
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
            confidence: confidenceB,
            certainty: certaintyB,
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
          skipped: false,
        },
        model_split: {
          assigned_split: effectiveExclusion ? "excluded" : modelSplit,
        },
      };

      const updated = [
        ...annotations.filter((a) => a.clip_id !== realClipId),
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

      if (isDraft) {
        saveSegmentToServer(newClip);
        setClips((prev) => {
          const next = [...prev, newClip];
          setCurrentClipIndex(next.length);
          return next;
        });
      } else if (currentClipIndex < clips.length - 1) {
        // Automatically advance to the next non-rejected segment
        setCurrentClipIndex((i) => {
          let next = i + 1;
          while (
            next < clips.length &&
            clips[next]?.annotator_state === "rejected"
          ) {
            next++;
          }
          return next >= clips.length ? clips.length : next;
        });
      } else {
        // Submitted the last segment -> transition to new draft segment
        setCurrentClipIndex(clips.length);
      }
        const nextStartSec = newClip.annotation_end;
        if (isDraft || currentClipIndex === clips.length - 1) {
          // Auto-chain: create new segment draft from end of this segment
          setCreatingSegment({ start: nextStartSec, end: nextStartSec + 2 });
          if (videoRef.current) {
            videoRef.current.currentTime = nextStartSec;
            videoRef.current.play().catch(() => {});
            setIsPlaying(true);
          }
          setStatusMessage(
            `Segment saved (${labelDur.toFixed(1)}s). Next segment starts at ${formatTime(nextStartSec)}. Press O to mark end.`,
          );
        } else {
          setCreatingSegment(null);
          setStatusMessage(`Segment updated (${labelDur.toFixed(1)}s).`);
        }

        fetch(`${SERVER_URL}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "1.0.0",
            dataset: "TACTIC-Bench",
            team_config: teamConfig,
            match_config: matchConfig,
            annotations: updated,
          }),
        }).catch(() => console.warn("Sync failed"));
      } catch (err) {
        console.error("[saveAnnotation] Error:", err);
        setStatusMessage(`Save error: ${(err as Error).message}`);
      }
    }, [
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
      currentClipIndex,
      clips,
      teamConfig,
      matchConfig,
      gameState,
      currentTeam,
      manualPossession,
      createSegmentsFromBoundary,
      buildSplitAnnotations,
      saveSegmentToServer,
      detectedPossessionTeam,
      trackedPlayers,
      exclusion,
      modelSplit,
      fetchVideoMetadata,
    ]);

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
        if (normalized.length > 0) {
          setActiveVideoPath(normalized[normalized.length - 1].path);
          setCurrentClipIndex(normalized.length - 1);
        } else {
          setCurrentClipIndex(0);
        }
        loadedVideoPathRef.current = "";
        setStatusMessage(`${normalized.length} clips from file`);
      } catch {
        setStatusMessage("Invalid manifest file");
      }
    };
    input.click();
  }, []);

  const handleLoadVideoDirect = useCallback(() => {
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

  const handleSelectServerVideo = useCallback(
    (filename: string) => {
      setShowVideoPicker(false);
      isBlobVideoRef.current = false;
      const videoPath = `raw_videos/${filename}`;
      loadedVideoPathRef.current = videoPath;
      setActiveVideoPath(videoPath);
      setClips([]);
      setCurrentClipIndex(0);
      setCreatingSegment({ start: 0, end: 2 });
      setVideoError("");
      setVideoDurationSec(MATCH_DURATION_SEC);
      setIsPlaying(true);
      setSelectedIntentA("");
      setSelectedIntentB("");
      setManualPossession(null);
      setStatusMessage(
        `Loading: ${filename}. Press O to mark end of first segment.`,
      );

      const {
        match_id: derivedMatchId,
        home_team: home,
        away_team: away,
      } = deriveMatchDefaults(filename);
      setMatchConfig((prev) => ({
        ...prev,
        match_id: derivedMatchId,
        home_team: home,
        away_team: away,
      }));
      setTeamConfig({
        team_a: { id: "A", name: home, jersey_color: "#ef233c", is_home: true },
        team_b: {
          id: "B",
          name: away,
          jersey_color: "#3b82f6",
          is_home: false,
        },
      });

      fetchVideoMetadata(videoPath);
    },
    [fetchVideoMetadata],
  );

  const handleBrowseVideoFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const blobUrl = URL.createObjectURL(file);
      isBlobVideoRef.current = true;
      loadedVideoPathRef.current = blobUrl;
      setActiveVideoPath(blobUrl);
      setClips([]);
      setCurrentClipIndex(0);
      setVideoError("");
      setVideoDurationSec(MATCH_DURATION_SEC);
      setIsPlaying(true);

      const {
        match_id: derivedMatchId,
        home_team: home,
        away_team: away,
      } = deriveMatchDefaults(file.name);
      setMatchConfig((prev) => ({
        ...prev,
        match_id: derivedMatchId,
        home_team: home,
        away_team: away,
      }));
      setTeamConfig({
        team_a: { id: "A", name: home, jersey_color: "#ef233c", is_home: true },
        team_b: {
          id: "B",
          name: away,
          jersey_color: "#3b82f6",
          is_home: false,
        },
      });

      setCreatingSegment({ start: 0, end: 2 });
      setStatusMessage(
        `Loaded: ${file.name}. Press O to mark end of first segment.`,
      );
    };
    input.click();
  }, []);

  const handleFileDrop = useCallback((file: File) => {
    if (!file.type.startsWith("video/")) {
      setStatusMessage("Only video files are supported.");
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    isBlobVideoRef.current = true;
    loadedVideoPathRef.current = blobUrl;
    setActiveVideoPath(blobUrl);
    setClips([]);
    setCurrentClipIndex(0);
    setVideoError("");
    setVideoDurationSec(MATCH_DURATION_SEC);
    setIsPlaying(true);

    const {
      match_id: derivedMatchId,
      home_team: home,
      away_team: away,
    } = deriveMatchDefaults(file.name);
    setMatchConfig((prev) => ({
      ...prev,
      match_id: derivedMatchId,
      home_team: home,
      away_team: away,
    }));
    setTeamConfig({
      team_a: { id: "A", name: home, jersey_color: "#ef233c", is_home: true },
      team_b: { id: "B", name: away, jersey_color: "#3b82f6", is_home: false },
    });

    setCreatingSegment({ start: 0, end: 2 });
    setStatusMessage(
      `Loaded: ${file.name}. Press O to mark end of first segment.`,
    );
  }, []);

  // ─── Export JSON ───
  const exportJSON = useCallback(async () => {
    try {
      const exportAnnotations = withCurrentTeamIdentity(
        annotations,
        teamConfig,
      );

      // 1. Attempt strict Training mode export
      let res = await fetch(`${SERVER_URL}/export/json?mode=train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_config: matchConfig,
          team_config: teamConfig,
          annotations: exportAnnotations,
        }),
      });
      let data = await res.json();

      let isTrainMode = true;
      let trainFailures: string[] = [];

      if (!res.ok) {
        trainFailures = data.gate_failures || (data.error ? [data.error] : []);

        // 2. Fallback to Standard/Full JSON export if training validation fails
        res = await fetch(`${SERVER_URL}/export/json?mode=full`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            match_config: matchConfig,
            team_config: teamConfig,
            annotations: exportAnnotations,
          }),
        });
        data = await res.json();
        isTrainMode = false;
      }

      if (res.ok && data.exportedData) {
        const failureSummary =
          trainFailures.length > 0
            ? ` (Training mode skipped: ${trainFailures.join("; ")})`
            : "";
        setStatusMessage(
          isTrainMode
            ? `Training JSON exported.${data.warning ? ` Warning: ${data.warning}` : ""}`
            : `Standard JSON exported.${failureSummary}`,
        );

        const blob = new Blob([JSON.stringify(data.exportedData, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
          data.fileName ||
          `TACTIC_FP_Annotated_${matchConfig.match_id}${isTrainMode ? "_TRAIN" : ""}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
      } else {
        const failures =
          data.gate_failures?.join("; ") || data.error || "Server error";
        const detail = data.detail ? ` — ${data.detail}` : "";
        setStatusMessage(`JSON export failed: ${failures}${detail}`);
      }
    } catch (err: any) {
      setStatusMessage(`JSON export failed: ${err.message}`);
    }
  }, [annotations, matchConfig, teamConfig]);

  // ─── Export CSV ───
  const exportCSV = useCallback(async () => {
      const exportAnnotations = withCurrentTeamIdentity(
        annotations,
        teamConfig,
      );
      if (exportAnnotations.length === 0) {
        setStatusMessage("No annotations to export.");
        return;
      }
      const matchId = matchConfig.match_id || "unknown";
      fetch(`${SERVER_URL}/export/csv?match_id=${matchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportAnnotations),
      })
      .then((res) => {
        if (!res.ok) throw new Error("Export failed");
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `TACTIC_FP_Annotated_${matchId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatusMessage("CSV exported successfully.");
      })
      .catch((err) => {
        console.error("CSV export network error:", err);
        setStatusMessage("CSV export failed.");
      });
    const headers = [
      "clip_id",
      "match_id",
      "match_name",
      "half",
      "window_idx",
      "parent_segment_id",
      "split_index",
      "split_count",
      "split_source_start_sec",
      "split_source_end_sec",
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
      parent_segment_id: ann.segment_metadata?.parent_segment_id,
      split_index: ann.segment_metadata?.split_index,
      split_count: ann.segment_metadata?.split_count,
      split_source_start_sec: ann.segment_metadata?.split_source_start_sec,
      split_source_end_sec: ann.segment_metadata?.split_source_end_sec,
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
        "Reset session and clear generated annotations, segments, manifest, and exports? Raw videos, converted MP4 files, and trajectories are kept.",
      )
    )
      return;
    // Clear all client state
    setAnnotations([]);
    setClips([]);
    setActiveVideoPath(null);
    setCurrentClipIndex(0);
    setCreatingSegment(null);
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
    setMatchConfig(DEFAULT_MATCH_CONFIG);
    setGameState(DEFAULT_GAME_STATE);
    setManualPossession(null);
    setVideoError("");
    setVideoDurationSec(MATCH_DURATION_SEC);
    setShowSplitPrompt(false);
    hasShownSplitPromptRef.current = false;
    loadedVideoPathRef.current = "";
    isBlobVideoRef.current = false;
    setStatusMessage("Resetting generated session files...");
    fetch(`${SERVER_URL}/annotations/reset`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          setStatusMessage(`Reset failed: ${res.status} ${text}`);
          return;
        }
        setStatusMessage("Session reset. Raw videos and trajectories kept.");
      })
      .catch((err) => setStatusMessage(`Reset failed: ${err.message}`));
  }, []);

  // ─── Keyboard shortcuts ───
  // Stable refs for handlers invoked from the global keydown listener.
  const togglePlaybackRef = useRef(togglePlayback);
  togglePlaybackRef.current = togglePlayback;
  const saveAnnotationRef = useRef<() => void>(saveAnnotation);
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
  const handleToggleExclusionRef = useRef(handleToggleExclusion);
  handleToggleExclusionRef.current = handleToggleExclusion;
  const exclusionRef = useRef(exclusion);
  exclusionRef.current = exclusion;

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
        setExclusion(null);
        setModelSplit("train");
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

      // Submit
      if (key === "enter") {
        e.preventDefault();
        // If we're in the segment-create workflow, confirm it; otherwise submit
        if (creatingSegment) {
          handleConfirmSegmentCreateRef.current();
        } else {
          saveAnnotationRef.current();
        }
        return;
      }

      // Intent hotkeys
      if (HOTKEY_MAP[key]) {
        e.preventDefault();
        const intentId = HOTKEY_MAP[key];
        if (disabledIntentIds.includes(intentId)) return;
        const label = getIntentLabel(intentId);
        if (isExclusionIntent(label)) {
          handleToggleExclusionRef.current?.(
            label as "DeadBall" | "ContestedPlay",
          );
          return;
        }
        if (exclusionRef.current) return;
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
      if (a.exclusion) {
        counts[a.exclusion] = (counts[a.exclusion] || 0) + 1;
        return;
      }
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
        // Non-blocking: just inform the user, auto-split happens on submit
        setStatusMessage(
          `Segment is ${draftDuration.toFixed(0)}s — will auto-split into 15s chunks when you press Enter.`,
        );
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
    const seg2Id = generateClipId(matchId, half, splitPoint);
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
      game_clock: formatMatchClock(half, splitPoint),
      trajectory_path: generateNpzPath(matchId, seg2Id),
      reconstruction: {
        npz_path: generateNpzPath(matchId, seg2Id),
      },
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
  }, [currentClip, readPlayhead]);

  const handleSplitPromptContinue = useCallback(() => {
    setShowSplitPrompt(false);
    hasShownSplitPromptRef.current = true;
  }, []);

  // Stable video event handlers to prevent infinite re-render loops
  const handleToggleLoop = useCallback(() => {
    setLoopClip((prev) => !prev);
  }, []);

  const handleVideoPlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handleVideoPause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleVideoWaiting = useCallback(() => {
    setIsBuffering(true);
  }, []);

  const handleVideoPlaying = useCallback(() => {
    setIsBuffering(false);
  }, []);

  const handleVideoError = useCallback(() => {
    setIsPlaying(false);
    const isMkv = (currentClip?.path ?? activeVideoPath)?.endsWith(".mkv");
    setVideoError(
      isMkv ? 'MKV not supported. Click "Convert to MP4".' : "Video load error",
    );
  }, [currentClip?.path, activeVideoPath]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0a0c10] text-slate-200 font-sans selection:bg-indigo-500/30">
      <Header
        coverageStats={coverageStats}
        currentClip={currentClip}
        currentClipIndex={currentClipIndex}
        totalClips={clips.length}
        annotatedCount={annotations.length}
        isGenerating={isGenerating}
        statusMessage={statusMessage}
        onLoadManifest={handleLoadManifest}
        onGenerateManifest={handleGenerateManifest}
        onLoadVideoDirect={handleLoadVideoDirect}
      />

          formatTime={formatTime}
          formatMatchClock={formatMatchClock}
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
            convertProgress={convertProgress}
            creatingSegment={creatingSegment}
            onTogglePlayback={togglePlayback}
            onReplayClip={replayClip}
            onToggleFullscreen={toggleFullscreen}
            onProgressClick={handleProgressClick}
            onCycleSpeed={cycleSpeed}
            onToggleMute={toggleMute}
            onToggleLoop={handleToggleLoop}
            onVideoPlay={handleVideoPlay}
            onVideoPause={handleVideoPause}
            onVideoWaiting={handleVideoWaiting}
            onVideoPlaying={handleVideoPlaying}
            onVideoError={handleVideoError}
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
            annotations={annotations}
            onAddNextSegment={handleAddNextSegment}
            onTimeUpdate={handleTimeUpdate}
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
            onSubmit={() => saveAnnotation()}
            exclusion={exclusion}
            setExclusion={(val) => {
              setExclusion(val);
              if (val) {
                setSelectedIntentA("");
                setSelectedIntentB("");
                setModelSplit("excluded");
              } else {
                setModelSplit("train");
              }
            }}
            gameState={gameState}
            onGameStateChange={setGameState}
          />
        </main>
        <AnnotationPanel
          currentClip={currentClip}
          onUpdateSegmentTimes={handleUpdateSegmentTimes}
          currentTeam={currentTeam}
          onTeamChange={setCurrentTeam}
          teamConfig={teamConfig}
          onTeamConfigChange={setTeamConfig}
          matchConfig={matchConfig}
          onMatchConfigChange={setMatchConfig}
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
          onSkip={() => {}}
          onSubmit={() => saveAnnotation()}
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
      {/* SplitPrompt removed — auto-split happens silently on submit */}
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
    const coverage_estimate = Number(
      ann.segment_metadata?.coverage_estimate ?? 1,
    );

    // Build deterministic npz path from clip metadata so export never has empty path.
    const matchId = ann.match_id || "unknown";
    const npzPath =
      ann.reconstruction.npz_path ||
      `data/trajectories/${matchId}/${ann.clip_id}.npz`;

    // Quantize to 100 ms grid (10 fps decimation, §3.1)
    const startMs = Math.round(Math.round(start_sec * 1000) / 100) * 100;
    // Duration derived from tensor shape: tensor_shape[0] × 100 (§6.3.1)
    const durationMs = tensorFrames * 100;
    const endMs = startMs + durationMs;

    const paddingMask = Array.from({ length: 150 }, (_, i) =>
      i < tensorFrames ? 1 : 0,
    );

    const common = {
      segment_id: ann.clip_id,
      start_ms: startMs,
      end_ms: endMs,
      duration_ms: durationMs,
      time_from_kickoff_ms: startMs,
      coverage_estimate,
      reconstruction: {
        npz_path: npzPath,
        tensor_shape: ann.reconstruction.tensor_shape || [tensorFrames, 23, 4],
        tensor_fps:
          ann.reconstruction.tensor_fps || ann.video_source?.tensor_fps || 10,
        padding_mask: paddingMask,
      },
    };

    if (ann.exclusion) {
      return {
        ...common,
        exclusion: ann.exclusion,
      };
    }

    // Determine primary team: the one with is_primary === true
    const teamAIsPrimary = ann.team_a?.is_primary === true;
    const primaryTeamObj = teamAIsPrimary ? ann.team_a : ann.team_b;
    const primaryConfidence = primaryTeamObj?.label?.confidence || 3;

    return {
      ...common,
      exclusion: null,
      primary_team: {
        intent_class: primaryTeamObj?.label?.intent_class ?? null,
        confidence: primaryConfidence,
        is_primary: true,
        possession: primaryTeamObj?.possession === true,
      },
    };
  });
}
