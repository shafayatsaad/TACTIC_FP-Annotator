"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Star,
  Flag,
  SkipForward,
  FileJson,
  FileSpreadsheet,
  Trash2,
  Wand2,
  ShieldCheck,
  CircleDot,
  Hand,
} from "lucide-react";
import {
  getIntentLabel,
  type Certainty,
  type GameState,
  type TeamConfig,
  type Clip,
  MODEL_FPS,
  MAX_MODEL_FRAMES,
  computeTensorFrames,
} from "@/lib/constants";

export type ManualPossession = "A" | "B" | "contested" | null;

interface ClassDistItem {
  label: string;
  count: number;
  pct: number;
  hex: string;
}

interface Props {
  currentClip?: Clip;
  onUpdateSegmentTimes?: (start: number, end: number) => void;
  currentTeam: "A" | "B";
  onTeamChange: (team: "A" | "B") => void;
  teamConfig: { team_a: TeamConfig; team_b: TeamConfig };
  onTeamConfigChange: (config: {
    team_a: TeamConfig;
    team_b: TeamConfig;
  }) => void;
  gameState: GameState;
  onGameStateChange: (state: GameState) => void;
  selectedIntentA: string;
  selectedIntentB: string;
  confidence: number;
  onConfidenceChange: (c: number) => void;
  certainty: Certainty;
  onCertaintyChange: (c: Certainty) => void;
  coverageEstimate: number;
  onCoverageEstimateChange: (v: number) => void;
  segmentProposal?: {
    reason: string;
    confidence: number;
    approved?: boolean;
    rejected?: boolean;
  };
  onApproveSegment: () => void;
  onRejectSegment: () => void;
  segmentAdjustTenths: number;
  onSegmentAdjustChange: (value: number) => void;
  onAutoSegment: () => void;
  detectedPossessionTeam: "A" | "B" | null;
  manualPossession: ManualPossession;
  onManualPossessionChange: (p: ManualPossession) => void;
  sessionBreakDue: boolean;
  onAcknowledgeBreak: () => void;
  isUncertain: boolean;
  onUncertainChange: (v: boolean) => void;
  autoNext: boolean;
  onAutoNextChange: (v: boolean) => void;
  annotationsCount: number;
  totalClips: number;
  classDistribution: ClassDistItem[];
  onSkip: () => void;
  onSubmit: () => void;
  onExportJSON?: () => void;
  onExportCSV: () => void;
  onReset: () => void;
  matchConfig: {
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
  };
  onMatchConfigChange: (config: any) => void;
}

const CONFIDENCE_LABELS = [
  "Guess",
  "Uncertain",
  "Moderate",
  "Confident",
  "Certain",
];

export default function AnnotationPanel({
  currentClip,
  onUpdateSegmentTimes,
  currentTeam,
  onTeamChange,
  teamConfig,
  onTeamConfigChange,
  gameState,
  onGameStateChange,
  selectedIntentA,
  selectedIntentB,
  confidence,
  onConfidenceChange,
  certainty,
  onCertaintyChange,
  coverageEstimate,
  onCoverageEstimateChange,
  segmentProposal,
  onApproveSegment,
  onRejectSegment,
  segmentAdjustTenths,
  onSegmentAdjustChange,
  onAutoSegment,
  detectedPossessionTeam,
  manualPossession,
  onManualPossessionChange,
  sessionBreakDue,
  onAcknowledgeBreak,
  isUncertain,
  onUncertainChange,
  autoNext,
  onAutoNextChange,
  annotationsCount,
  totalClips,
  classDistribution,
  onSkip,
  onSubmit,
  onExportJSON,
  onExportCSV,
  onReset,
  matchConfig,
  onMatchConfigChange,
}: Props) {
  const [showMatchDetails, setShowMatchDetails] = useState(false);
  const [localStart, setLocalStart] = useState("");
  const [localEnd, setLocalEnd] = useState("");

  useEffect(() => {
    if (currentClip) {
      setLocalStart(currentClip.annotation_start.toFixed(1));
      setLocalEnd(currentClip.annotation_end.toFixed(1));
    } else {
      setLocalStart("");
      setLocalEnd("");
    }
  }, [currentClip]);

  const handleStartBlur = () => {
    if (!currentClip || !onUpdateSegmentTimes) return;
    const val = parseFloat(localStart);
    if (Number.isFinite(val)) {
      onUpdateSegmentTimes(val, currentClip.annotation_end);
    } else {
      setLocalStart(currentClip.annotation_start.toFixed(1));
    }
  };

  const handleEndBlur = () => {
    if (!currentClip || !onUpdateSegmentTimes) return;
    const val = parseFloat(localEnd);
    if (Number.isFinite(val)) {
      onUpdateSegmentTimes(currentClip.annotation_start, val);
    } else {
      setLocalEnd(currentClip.annotation_end.toFixed(1));
    }
  };

  const handleNudgeStart = (delta: number) => {
    if (!currentClip || !onUpdateSegmentTimes) return;
    const newStart = Math.max(0, currentClip.annotation_start + delta);
    onUpdateSegmentTimes(newStart, currentClip.annotation_end);
  };

  const handleNudgeEnd = (delta: number) => {
    if (!currentClip || !onUpdateSegmentTimes) return;
    const newEnd = currentClip.annotation_end + delta;
    onUpdateSegmentTimes(currentClip.annotation_start, newEnd);
  };

  const remaining = totalClips - annotationsCount;
  const activeTeam =
    currentTeam === "A" ? teamConfig.team_a : teamConfig.team_b;

  const updateTeam = (key: "team_a" | "team_b", patch: Partial<TeamConfig>) => {
    onTeamConfigChange({
      ...teamConfig,
      [key]: { ...teamConfig[key], ...patch },
    });
  };
  const updateGameState = (patch: Partial<GameState>) =>
    onGameStateChange({ ...gameState, ...patch });
  const renderTeamCard = (
    teamKey: "team_a" | "team_b",
    teamLetter: "A" | "B",
    selectedIntent: string,
  ) => {
    const team = teamConfig[teamKey];
    const isActive = currentTeam === teamLetter;

    return (
      <button
        type="button"
        onClick={() => onTeamChange(teamLetter)}
        className="w-full p-3 rounded-lg border mb-2 transition-all text-left bg-white/[0.02] hover:bg-white/[0.05]"
        style={{
          borderColor: isActive
            ? `${team.jersey_color}99`
            : "rgba(255,255,255,0.08)",
          boxShadow: isActive ? `inset 2px 0 0 0 ${team.jersey_color}` : "none",
          backgroundColor: isActive ? `${team.jersey_color}14` : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-white/20"
              style={{ backgroundColor: team.jersey_color }}
            />
            <div className="min-w-0">
              <span className="block truncate text-xs font-semibold text-white">
                {team.name}
              </span>
              <span className="text-[9px] text-slate-500">
                {team.is_home ? "HOME" : "AWAY"} - Team {teamLetter}
              </span>
            </div>
          </div>
          {isActive && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold"
              style={{
                color: team.jersey_color,
                backgroundColor: `${team.jersey_color}22`,
              }}
            >
              {teamLetter}
            </span>
          )}
        </div>
        {selectedIntent && (
          <div
            className="mt-1 truncate text-[10px] font-medium flex items-center gap-1"
            style={{ color: team.jersey_color }}
          >
            <CircleDot className="w-2.5 h-2.5 shrink-0" />
            {getIntentLabel(selectedIntent)}
          </div>
        )}
      </button>
    );
  };

  return (
    <aside className="w-72 bg-black/40 border-l border-white/10 flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
      <div className="p-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Active Segment Timing
          </h3>
          {currentClip && (
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                currentClip.annotator_state === "accepted"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : currentClip.annotator_state === "modified"
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
              }`}
            >
              {currentClip.annotator_state || "manual"}
            </span>
          )}
        </div>

        {currentClip ? (
          <div className="space-y-3">
            <div className="text-[11px] text-slate-400 font-mono">
              ID:{" "}
              <span className="text-white font-bold">
                {currentClip.clip_id}
              </span>
            </div>

            {/* Start Time Control */}
            <div>
              <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                Start Time (sec)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNudgeStart(-0.5)}
                  className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[10px] font-mono text-slate-300"
                >
                  -0.5s
                </button>
                <input
                  type="text"
                  value={localStart}
                  onChange={(e) => setLocalStart(e.target.value)}
                  onBlur={handleStartBlur}
                  onKeyDown={(e) => e.key === "Enter" && handleStartBlur()}
                  className="w-full text-center rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 font-mono outline-none focus:border-indigo-500/50"
                />
                <button
                  type="button"
                  onClick={() => handleNudgeStart(0.5)}
                  className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[10px] font-mono text-slate-300"
                >
                  +0.5s
                </button>
              </div>
            </div>

            {/* End Time Control */}
            <div>
              <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                End Time (sec)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNudgeEnd(-0.5)}
                  className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[10px] font-mono text-slate-300"
                >
                  -0.5s
                </button>
                <input
                  type="text"
                  value={localEnd}
                  onChange={(e) => setLocalEnd(e.target.value)}
                  onBlur={handleEndBlur}
                  onKeyDown={(e) => e.key === "Enter" && handleEndBlur()}
                  className="w-full text-center rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 font-mono outline-none focus:border-indigo-500/50"
                />
                <button
                  type="button"
                  onClick={() => handleNudgeEnd(0.5)}
                  className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[10px] font-mono text-slate-300"
                >
                  +0.5s
                </button>
              </div>
            </div>

            {(() => {
              const durationSec =
                (currentClip.annotation_end ?? currentClip.end) -
                (currentClip.annotation_start ?? currentClip.start);
              const computedFrames = computeTensorFrames(durationSec);
              const isOverMax = computedFrames > MAX_MODEL_FRAMES;
              return (
                <div className="flex flex-col gap-1 text-[10px] text-slate-400 bg-white/[0.02] border border-white/5 rounded-md p-2 font-mono">
                  <div className="flex items-center justify-between">
                    <span>Duration:</span>
                    <span className="text-white font-bold">
                      {durationSec.toFixed(2)}s
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Frames:</span>
                    <span className="text-white font-bold">
                      {computedFrames} frames @ {MODEL_FPS} fps
                    </span>
                  </div>
                  {isOverMax && (
                    <div className="text-rose-400 text-[9px] mt-1 flex items-center gap-1">
                      <span>
                        ⚠️ Exceeds {MAX_MODEL_FRAMES} frame max — will be
                        truncated
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="text-center py-4 bg-white/[0.01] border border-dashed border-white/10 rounded-lg">
            <span className="text-[10px] text-slate-500">
              No active segment
            </span>
          </div>
        )}
      </div>

      {/* Match Details Accordion */}
      <div className="p-3 border-b border-white/5">
        <button
          type="button"
          onClick={() => setShowMatchDetails(!showMatchDetails)}
          className="w-full flex items-center justify-between text-left outline-none"
        >
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Match Details
          </h3>
          <span className="text-slate-500 text-xs font-bold leading-none select-none">
            {showMatchDetails ? "▼" : "▶"}
          </span>
        </button>
        {showMatchDetails && (
          <div className="space-y-2.5 mt-3">
            <label className="block">
              <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                Match ID
              </span>
              <input
                type="text"
                value={matchConfig.match_id}
                onChange={(e) =>
                  onMatchConfigChange({
                    ...matchConfig,
                    match_id: e.target.value,
                  })
                }
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Home Team
                </span>
                <input
                  type="text"
                  value={matchConfig.home_team}
                  onChange={(e) => {
                    const val = e.target.value;
                    onMatchConfigChange({ ...matchConfig, home_team: val });
                    onTeamConfigChange({
                      ...teamConfig,
                      team_a: { ...teamConfig.team_a, name: val },
                    });
                  }}
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Away Team
                </span>
                <input
                  type="text"
                  value={matchConfig.away_team}
                  onChange={(e) => {
                    const val = e.target.value;
                    onMatchConfigChange({ ...matchConfig, away_team: val });
                    onTeamConfigChange({
                      ...teamConfig,
                      team_b: { ...teamConfig.team_b, name: val },
                    });
                  }}
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Competition
                </span>
                <input
                  type="text"
                  value={matchConfig.competition}
                  onChange={(e) =>
                    onMatchConfigChange({
                      ...matchConfig,
                      competition: e.target.value,
                    })
                  }
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Season
                </span>
                <input
                  type="text"
                  value={matchConfig.season}
                  onChange={(e) =>
                    onMatchConfigChange({
                      ...matchConfig,
                      season: e.target.value,
                    })
                  }
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Match Date
                </span>
                <input
                  type="text"
                  value={matchConfig.match_date}
                  onChange={(e) =>
                    onMatchConfigChange({
                      ...matchConfig,
                      match_date: e.target.value,
                    })
                  }
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Final Score
                </span>
                <input
                  type="text"
                  value={matchConfig.final_score}
                  onChange={(e) =>
                    onMatchConfigChange({
                      ...matchConfig,
                      final_score: e.target.value,
                    })
                  }
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Halftime Score
                </span>
                <input
                  type="text"
                  value={matchConfig.halftime_score}
                  onChange={(e) =>
                    onMatchConfigChange({
                      ...matchConfig,
                      halftime_score: e.target.value,
                    })
                  }
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Annotator
                </span>
                <input
                  type="text"
                  value={matchConfig.annotator}
                  onChange={(e) =>
                    onMatchConfigChange({
                      ...matchConfig,
                      annotator: e.target.value,
                    })
                  }
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  License
                </span>
                <input
                  type="text"
                  value={matchConfig.annotator_license}
                  onChange={(e) =>
                    onMatchConfigChange({
                      ...matchConfig,
                      annotator_license: e.target.value,
                    })
                  }
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="block">
                <span className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">
                  Session ID
                </span>
                <input
                  type="text"
                  value={matchConfig.session_id}
                  onChange={(e) =>
                    onMatchConfigChange({
                      ...matchConfig,
                      session_id: e.target.value,
                    })
                  }
                  className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-b border-white/5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Annotate Teams
        </h3>
        {renderTeamCard("team_a", "A", selectedIntentA)}
        {renderTeamCard("team_b", "B", selectedIntentB)}

        <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-2">
          <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">
            Team Identity
          </div>
          <label className="block">
            <span className="mb-1 block text-[9px] text-slate-500">Name</span>
            <input
              value={activeTeam.name}
              onChange={(e) =>
                updateTeam(currentTeam === "A" ? "team_a" : "team_b", {
                  name: e.target.value || `Team ${currentTeam}`,
                })
              }
              className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-white/30"
            />
          </label>
        </div>
      </div>

      <div className="p-3 border-b border-white/5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
          Ball Possession
        </h3>
        <p className="text-[9px] text-slate-500 mb-2 leading-snug">
          Pick which team has possession. Leave on Auto to follow the trajectory
          signal.
        </p>
        <div
          className="grid grid-cols-2 gap-1.5 mb-2"
          title="Sets which team is primary in the export. Overrides the trajectory-detected team."
        >
          <button
            type="button"
            onClick={() => onManualPossessionChange("A")}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider transition-all ${
              manualPossession === "A"
                ? "bg-white/10 border-white/30 text-white shadow-[inset_2px_0_0_0_currentColor]"
                : "bg-white/[0.02] border-white/10 text-slate-300 hover:bg-white/10"
            }`}
            style={
              manualPossession === "A"
                ? {
                    color: teamConfig.team_a.jersey_color,
                    borderColor: `${teamConfig.team_a.jersey_color}99`,
                    backgroundColor: `${teamConfig.team_a.jersey_color}14`,
                  }
                : {}
            }
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: teamConfig.team_a.jersey_color }}
            />
            {teamConfig.team_a.name}
          </button>
          <button
            type="button"
            onClick={() => onManualPossessionChange("B")}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider transition-all ${
              manualPossession === "B"
                ? "bg-white/10 border-white/30 text-white shadow-[inset_2px_0_0_0_currentColor]"
                : "bg-white/[0.02] border-white/10 text-slate-300 hover:bg-white/10"
            }`}
            style={
              manualPossession === "B"
                ? {
                    color: teamConfig.team_b.jersey_color,
                    borderColor: `${teamConfig.team_b.jersey_color}99`,
                    backgroundColor: `${teamConfig.team_b.jersey_color}14`,
                  }
                : {}
            }
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: teamConfig.team_b.jersey_color }}
            />
            {teamConfig.team_b.name}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onManualPossessionChange("contested")}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider transition-all ${
              manualPossession === "contested"
                ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                : "bg-white/[0.02] border-white/10 text-slate-400 hover:bg-white/10"
            }`}
          >
            Contested
          </button>
          <button
            type="button"
            onClick={() => onManualPossessionChange(null)}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider transition-all ${
              manualPossession === null
                ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-200"
                : "bg-white/[0.02] border-white/10 text-slate-400 hover:bg-white/10"
            }`}
          >
            <Hand className="w-3 h-3" /> Auto
          </button>
        </div>
        {detectedPossessionTeam && (
          <p className="mt-2 text-[9px] text-slate-500">
            Trajectory suggests{" "}
            <span
              className="font-semibold"
              style={{
                color:
                  detectedPossessionTeam === "A"
                    ? teamConfig.team_a.jersey_color
                    : teamConfig.team_b.jersey_color,
              }}
            >
              {detectedPossessionTeam === "A"
                ? teamConfig.team_a.name
                : teamConfig.team_b.name}
            </span>
            .
          </p>
        )}
      </div>

      <div className="p-3 border-b border-white/5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Game State
        </h3>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="block">
            <span className="mb-1 block text-[9px] text-slate-500">
              Home score
            </span>
            <input
              type="number"
              min={0}
              value={gameState.score_home}
              onChange={(e) =>
                updateGameState({
                  score_home: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-white/30"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[9px] text-slate-500">
              Away score
            </span>
            <input
              type="number"
              min={0}
              value={gameState.score_away}
              onChange={(e) =>
                updateGameState({
                  score_away: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-white/30"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={gameState.set_piece === true}
            onChange={(e) =>
              updateGameState({
                set_piece: e.target.checked,
                set_piece_type: e.target.checked
                  ? gameState.set_piece_type || "corner"
                  : undefined,
              })
            }
            className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500/30"
          />
          <span className="text-[10px] text-slate-400">Set piece</span>
        </label>
        {gameState.set_piece && (
          <select
            value={gameState.set_piece_type || "corner"}
            onChange={(e) =>
              updateGameState({
                set_piece_type: e.target.value as GameState["set_piece_type"],
              })
            }
            className="mb-2 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-white/30"
          >
            <option value="corner">Corner</option>
            <option value="free_kick">Free kick</option>
            <option value="throw_in">Throw in</option>
            <option value="penalty">Penalty</option>
          </select>
        )}
      </div>

      <div className="p-3 border-b border-white/5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-300 mb-3">
          Submit Annotation
        </h3>
        <div className="text-[10px] text-slate-400 mb-2">
          Annotating:{" "}
          <span
            className="font-medium"
            style={{ color: activeTeam.jersey_color }}
          >
            {activeTeam.name}
          </span>
        </div>
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">
              Confidence
            </span>
            <span className="text-[9px] text-slate-300">
              {CONFIDENCE_LABELS[confidence - 1]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => onConfidenceChange(star)}
                className="p-0.5 transition-colors"
              >
                <Star
                  className={`w-4 h-4 ${star <= confidence ? "text-yellow-400 fill-yellow-400" : "text-slate-600"}`}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[9px] text-slate-500 uppercase tracking-wider">
              Certainty
            </span>
            <select
              value={certainty}
              onChange={(e) => onCertaintyChange(e.target.value as Certainty)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-white/30"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[9px] text-slate-500 uppercase tracking-wider">
              Coverage
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={coverageEstimate}
              onChange={(e) =>
                onCoverageEstimateChange(
                  Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                )
              }
              className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-white/30"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isUncertain}
            onChange={(e) => onUncertainChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500/30"
          />
          <Flag className="w-3 h-3 text-slate-400" />
          <span className="text-[10px] text-slate-400">Flag Review</span>
        </label>
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoNext}
            onChange={(e) => onAutoNextChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500/30"
          />
          <span className="text-[10px] text-slate-400">Auto-Next</span>
        </label>
        <div className="flex gap-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onSubmit}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold text-white uppercase tracking-wider transition-colors shadow-lg"
            style={{
              backgroundColor: activeTeam.jersey_color,
              boxShadow: `0 10px 30px ${activeTeam.jersey_color}22`,
            }}
          >
            <Check className="w-3.5 h-3.5" /> Submit (Enter)
          </motion.button>
        </div>
      </div>

      <div className="p-3 border-b border-white/5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Session
        </h3>
        {sessionBreakDue && (
          <button
            type="button"
            onClick={onAcknowledgeBreak}
            className="mb-3 w-full rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/20"
          >
            Resume After Break
          </button>
        )}
        <h4 className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Class Distribution
        </h4>
        {classDistribution.length === 0 ? (
          <p className="text-[10px] text-slate-600">No annotations yet</p>
        ) : (
          <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
            {classDistribution.map(({ label, count, pct, hex }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[9px] text-slate-400 w-20 truncate">
                  {label}
                </span>
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: hex }}
                  />
                </div>
                <span className="text-[9px] text-slate-500 w-4 text-right">
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-b border-white/5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Export
        </h3>
        <div className="flex gap-2 mb-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onExportJSON}
            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 py-2 rounded-lg text-[10px] font-bold text-emerald-300 uppercase tracking-wider transition-colors"
          >
            <FileJson className="w-3.5 h-3.5" /> JSON
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onExportCSV}
            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 py-2 rounded-lg text-[10px] font-bold text-emerald-300 uppercase tracking-wider transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
          </motion.button>
        </div>
        <div className="mt-2 text-xs text-slate-500 italic">
          Causal features computed during model preprocessing.
        </div>
      </div>

      <div className="p-3">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onReset}
          className="w-full flex items-center justify-center gap-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 py-2 rounded-lg text-[10px] font-bold text-rose-400 uppercase tracking-wider transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Reset Session
        </motion.button>
      </div>
    </aside>
  );
}
