"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Star,
  Flag,
  Trash2,
  Tag,
  Settings,
  BarChart2,
  Hand,
  CircleDot,
  FileJson,
  FileSpreadsheet,
  Lock,
  Unlock,
  ArrowRight,
  ChevronDown,
  Sliders,
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
  onUpdateSegmentTimes?: (
    start: number,
    end: number,
    editedEdge?: "start" | "end" | "both",
  ) => void;
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
  detectedPossessionTeam,
  manualPossession,
  onManualPossessionChange,
  isUncertain,
  onUncertainChange,
  autoNext,
  onAutoNextChange,
  annotationsCount,
  totalClips,
  classDistribution,
  onSubmit,
  onExportJSON,
  onExportCSV,
  onReset,
  matchConfig,
  onMatchConfigChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<"annotate" | "setup" | "session">(
    "annotate",
  );
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [showMatchDetails, setShowMatchDetails] = useState(false);
  const [localStart, setLocalStart] = useState("");
  const [localEnd, setLocalEnd] = useState("");
  const [showQualityMeta, setShowQualityMeta] = useState(true);

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
      onUpdateSegmentTimes(val, currentClip.annotation_end, "start");
    } else {
      setLocalStart(currentClip.annotation_start.toFixed(1));
    }
  };

  const handleEndBlur = () => {
    if (!currentClip || !onUpdateSegmentTimes) return;
    const val = parseFloat(localEnd);
    if (Number.isFinite(val)) {
      onUpdateSegmentTimes(currentClip.annotation_start, val, "end");
    } else {
      setLocalEnd(currentClip.annotation_end.toFixed(1));
    }
  };

  const handleNudgeStart = (delta: number) => {
    if (!currentClip || !onUpdateSegmentTimes) return;
    const newStart = Math.max(0, currentClip.annotation_start + delta);
    onUpdateSegmentTimes(newStart, currentClip.annotation_end, "start");
  };

  const handleNudgeEnd = (delta: number) => {
    if (!currentClip || !onUpdateSegmentTimes) return;
    const newEnd = currentClip.annotation_end + delta;
    onUpdateSegmentTimes(currentClip.annotation_start, newEnd, "end");
  };

  const handleApplySetup = () => {
    setIsSetupComplete(true);
    setActiveTab("annotate");
  };

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
        className="w-full p-2 rounded-lg transition-all text-left glass-btn"
        style={{
          borderColor: isActive
            ? `${team.jersey_color}99`
            : "rgba(255,255,255,0.08)",
          boxShadow: isActive
            ? `inset 2px 0 0 0 ${team.jersey_color}, 0 2px 12px ${team.jersey_color}15`
            : undefined,
          backgroundColor: isActive ? `${team.jersey_color}14` : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
              style={{ backgroundColor: team.jersey_color }}
            />
            <div className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-white">
                {team.name}
              </span>
              <span className="text-[8px] text-slate-500">
                {team.is_home ? "HOME" : "AWAY"} - Team {teamLetter}
              </span>
            </div>
          </div>
          {isActive && (
            <span
              className="rounded px-1 py-0.5 text-[8px] font-bold"
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
            className="mt-0.5 truncate text-[9px] font-medium flex items-center gap-1"
            style={{ color: team.jersey_color }}
          >
            <CircleDot className="w-2 h-2 shrink-0" />
            {getIntentLabel(selectedIntent)}
          </div>
        )}
      </button>
    );
  };

  /* ─── Tab button helper ─── */
  const renderTabBtn = (
    tab: "annotate" | "setup" | "session",
    icon: React.ReactNode,
    label: string,
  ) => (
    <button
      type="button"
      onClick={() => setActiveTab(tab)}
      className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-all border-b-2 ${
        activeTab === tab
          ? "text-white"
          : "text-slate-400 hover:text-slate-200 border-transparent bg-transparent"
      }`}
      style={{
        borderBottomColor:
          activeTab === tab ? activeTeam.jersey_color : "transparent",
        backgroundColor:
          activeTab === tab
            ? `${activeTeam.jersey_color}08`
            : "transparent",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <aside className="w-72 bg-[#0e1117]/80 border-l border-white/10 flex flex-col shrink-0 overflow-hidden" style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      {/* Sidebar Tabs */}
      <div className="flex border-b border-white/10 bg-black/20 shrink-0">
        {renderTabBtn("annotate", <Tag className="w-3 h-3" />, "Annotate")}
        {renderTabBtn("setup", <Settings className="w-3 h-3" />, "Setup")}
        {renderTabBtn("session", <BarChart2 className="w-3 h-3" />, "Session")}
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
        {activeTab === "annotate" && (
          <>
            {/* ① Setup status banner */}
            {!isSetupComplete && (
              <button
                type="button"
                onClick={() => setActiveTab("setup")}
                className="w-full flex items-center justify-between gap-1.5 rounded-lg glass-btn-amber px-2.5 py-1.5 text-[9px] font-semibold text-amber-300 hover:text-amber-200 cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3 h-3" />
                  <span>Setup required before submitting</span>
                </div>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}

            {/* ② Team Selection — quick-switch */}
            <div className="glass-card p-2 space-y-1.5">
              <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                Annotating Team
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {renderTeamCard("team_a", "A", selectedIntentA)}
                {renderTeamCard("team_b", "B", selectedIntentB)}
              </div>
            </div>

            {/* ③ Segment Timing */}
            <div className="glass-card p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                  Segment Timing
                </h3>
                {currentClip && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider ${
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
                <div className="space-y-1.5">
                  <div className="text-[9px] text-slate-400 font-mono truncate">
                    ID: <span className="text-white font-bold">{currentClip.clip_id}</span>
                  </div>

                  {/* Start Time Row */}
                  <div className="flex items-center gap-1 bg-black/30 p-1 rounded-md border border-white/5">
                    <span className="text-[8.5px] font-bold text-indigo-300 w-10 shrink-0 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                      START
                    </span>
                    <button
                      type="button"
                      onClick={() => handleNudgeStart(-0.5)}
                      title="Start -0.5s (Key: ,)"
                      className="px-1.5 py-0.5 rounded glass-btn text-[8.5px] font-mono text-slate-300 hover:text-white flex items-center gap-0.5 shrink-0 hover:border-indigo-500/40"
                    >
                      <kbd className="px-1 rounded bg-indigo-500/30 text-indigo-200 font-bold">,</kbd>
                      <span>-0.5</span>
                    </button>
                    <input
                      type="text"
                      value={localStart}
                      onChange={(e) => setLocalStart(e.target.value)}
                      onBlur={handleStartBlur}
                      onKeyDown={(e) => e.key === "Enter" && handleStartBlur()}
                      className="w-full text-center rounded border border-white/10 bg-black/60 px-1 py-0.5 text-[10.5px] text-white font-mono font-bold outline-none focus:border-indigo-500/60"
                    />
                    <button
                      type="button"
                      onClick={() => handleNudgeStart(0.5)}
                      title="Start +0.5s (Key: .)"
                      className="px-1.5 py-0.5 rounded glass-btn text-[8.5px] font-mono text-slate-300 hover:text-white flex items-center gap-0.5 shrink-0 hover:border-indigo-500/40"
                    >
                      <span>+0.5</span>
                      <kbd className="px-1 rounded bg-indigo-500/30 text-indigo-200 font-bold">.</kbd>
                    </button>
                  </div>

                  {/* End Time Row */}
                  <div className="flex items-center gap-1 bg-black/30 p-1 rounded-md border border-white/5">
                    <span className="text-[8.5px] font-bold text-cyan-300 w-10 shrink-0 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                      END
                    </span>
                    <button
                      type="button"
                      onClick={() => handleNudgeEnd(-0.5)}
                      title="End -0.5s (Key: Shift + ,)"
                      className="px-1.5 py-0.5 rounded glass-btn text-[8.5px] font-mono text-slate-300 hover:text-white flex items-center gap-0.5 shrink-0 hover:border-cyan-500/40"
                    >
                      <kbd className="px-1 rounded bg-cyan-500/30 text-cyan-200 font-bold text-[7.5px]">⇧,</kbd>
                      <span>-0.5</span>
                    </button>
                    <input
                      type="text"
                      value={localEnd}
                      onChange={(e) => setLocalEnd(e.target.value)}
                      onBlur={handleEndBlur}
                      onKeyDown={(e) => e.key === "Enter" && handleEndBlur()}
                      className="w-full text-center rounded border border-white/10 bg-black/60 px-1 py-0.5 text-[10.5px] text-white font-mono font-bold outline-none focus:border-cyan-500/60"
                    />
                    <button
                      type="button"
                      onClick={() => handleNudgeEnd(0.5)}
                      title="End +0.5s (Key: Shift + .)"
                      className="px-1.5 py-0.5 rounded glass-btn text-[8.5px] font-mono text-slate-300 hover:text-white flex items-center gap-0.5 shrink-0 hover:border-cyan-500/40"
                    >
                      <span>+0.5</span>
                      <kbd className="px-1 rounded bg-cyan-500/30 text-cyan-200 font-bold text-[7.5px]">⇧.</kbd>
                    </button>
                  </div>

                  {/* Compact Duration / Frames row */}
                  {(() => {
                    const durationSec =
                      (currentClip.annotation_end ?? currentClip.end) -
                      (currentClip.annotation_start ?? currentClip.start);
                    const computedFrames = computeTensorFrames(durationSec);
                    const isOverMax = computedFrames > MAX_MODEL_FRAMES;
                    return (
                      <div className="flex items-center justify-between text-[8.5px] text-slate-400 bg-black/20 px-2 py-0.5 rounded font-mono">
                        <div className="flex items-center gap-1">
                          <span>Dur:</span>
                          <span className="text-white font-bold">{durationSec.toFixed(2)}s</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span>Frames:</span>
                          <span className="text-white font-bold">{computedFrames} @ 10fps</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="text-center py-2 glass-card">
                  <span className="text-[9px] text-slate-500">
                    No active segment
                  </span>
                </div>
              )}
            </div>

            {/* ④ Submit Button — Prominent Primary Action */}
            <div className="glass-card p-2.5 space-y-2 border-indigo-500/30 bg-gradient-to-b from-white/[0.04] to-black/30">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-200 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Submit Annotation
                </h3>
                <span className="text-[9.5px] text-slate-400 font-medium">
                  Team:{" "}
                  <span
                    className="font-bold px-1.5 py-0.5 rounded bg-black/40 border border-white/10"
                    style={{ color: activeTeam.jersey_color }}
                  >
                    {activeTeam.name}
                  </span>
                </span>
              </div>
              <motion.button
                whileHover={isSetupComplete ? { scale: 1.02, y: -1 } : undefined}
                whileTap={isSetupComplete ? { scale: 0.98 } : undefined}
                onClick={isSetupComplete ? onSubmit : undefined}
                disabled={!isSetupComplete}
                className={`w-full flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-all duration-200 ${
                  isSetupComplete
                    ? "text-white cursor-pointer shadow-lg"
                    : "text-slate-500 cursor-not-allowed opacity-50 bg-slate-900 border border-white/5"
                }`}
                style={
                  isSetupComplete
                    ? {
                        backgroundColor: activeTeam.jersey_color,
                        boxShadow: `0 0 25px ${activeTeam.jersey_color}50, 0 4px 12px rgba(0,0,0,0.4)`,
                        border: `1px solid rgba(255,255,255,0.4)`,
                      }
                    : undefined
                }
              >
                {isSetupComplete ? (
                  <>
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>Submit Annotation</span>
                    <kbd className="ml-1 bg-black/40 border border-white/20 px-1.5 py-0.5 rounded text-[9px] font-mono text-white/90">
                      Enter ↵
                    </kbd>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" /> Setup First
                  </>
                )}
              </motion.button>
            </div>

            {/* ⑤ Quality Metadata — collapsible accordion */}
            <div className="glass-card overflow-hidden">
              <button
                type="button"
                onClick={() => setShowQualityMeta(!showQualityMeta)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-left outline-none hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-3 h-3 text-slate-400" />
                  <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                    Quality Metadata
                  </h3>
                </div>
                <motion.div
                  animate={{ rotate: showQualityMeta ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-3 h-3 text-slate-500" />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {showQualityMeta && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="px-2 pb-2 space-y-2 border-t border-white/5 pt-2">
                      {/* Confidence stars */}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[8px] text-slate-400 uppercase tracking-wider">
                            Confidence
                          </span>
                          <span className="text-[8px] text-slate-300 font-mono">
                            {CONFIDENCE_LABELS[confidence - 1]}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => onConfidenceChange(star)}
                              className="p-0.5 transition-all hover:scale-125 rounded-md hover:bg-white/[0.06]"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${star <= confidence ? "text-yellow-400 fill-yellow-400 drop-shadow-[0_0_4px_rgba(250,204,21,0.4)]" : "text-slate-600"}`}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Certainty + Coverage */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="block">
                          <span className="mb-0.5 block text-[8px] text-slate-500 uppercase tracking-wider">
                            Certainty
                          </span>
                          <select
                            value={certainty}
                            onChange={(e) =>
                              onCertaintyChange(e.target.value as Certainty)
                            }
                            className="w-full rounded-md border border-white/10 bg-[#0c0e12] px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50"
                          >
                            <option value="low" className="bg-[#0c0e12] text-slate-100">
                              Low
                            </option>
                            <option value="medium" className="bg-[#0c0e12] text-slate-100">
                              Medium
                            </option>
                            <option value="high" className="bg-[#0c0e12] text-slate-100">
                              High
                            </option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-0.5 block text-[8px] text-slate-500 uppercase tracking-wider">
                            Coverage %
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
                            className="w-full rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50 font-mono"
                          />
                        </label>
                      </div>
                      {/* Flag + Auto toggles */}
                      <div className="flex items-center gap-3 pt-0.5">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none glass-btn rounded-md px-2 py-1">
                          <input
                            type="checkbox"
                            checked={isUncertain}
                            onChange={(e) => onUncertainChange(e.target.checked)}
                            className="w-3 h-3 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500/30 accent-indigo-500"
                          />
                          <Flag className="w-2.5 h-2.5 text-slate-400" />
                          <span className="text-[9px] text-slate-400">Flag</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer select-none glass-btn rounded-md px-2 py-1">
                          <input
                            type="checkbox"
                            checked={autoNext}
                            onChange={(e) => onAutoNextChange(e.target.checked)}
                            className="w-3 h-3 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500/30 accent-indigo-500"
                          />
                          <span className="text-[9px] text-slate-400">Auto</span>
                        </label>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}

        {activeTab === "setup" && (
          <>
            {/* Ball Possession */}
            <div className="glass-card p-2 space-y-2">
              <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                Ball Possession
              </h3>
              <p className="text-[8px] text-slate-500 leading-snug">
                Select which team holds possession in the current phase.
              </p>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => onManualPossessionChange("A")}
                  className="flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wider transition-all glass-btn"
                  style={
                    manualPossession === "A"
                      ? {
                          color: teamConfig.team_a.jersey_color,
                          borderColor: `${teamConfig.team_a.jersey_color}99`,
                          backgroundColor: `${teamConfig.team_a.jersey_color}14`,
                          boxShadow: `0 2px 12px ${teamConfig.team_a.jersey_color}20`,
                        }
                      : {}
                  }
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: teamConfig.team_a.jersey_color }}
                  />
                  {teamConfig.team_a.name}
                </button>
                <button
                  type="button"
                  onClick={() => onManualPossessionChange("B")}
                  className="flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wider transition-all glass-btn"
                  style={
                    manualPossession === "B"
                      ? {
                          color: teamConfig.team_b.jersey_color,
                          borderColor: `${teamConfig.team_b.jersey_color}99`,
                          backgroundColor: `${teamConfig.team_b.jersey_color}14`,
                          boxShadow: `0 2px 12px ${teamConfig.team_b.jersey_color}20`,
                        }
                      : {}
                  }
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: teamConfig.team_b.jersey_color }}
                  />
                  {teamConfig.team_b.name}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => onManualPossessionChange("contested")}
                  className={`flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wider transition-all ${
                    manualPossession === "contested"
                      ? "glass-btn-amber text-amber-200"
                      : "glass-btn text-slate-400"
                  }`}
                >
                  Contested
                </button>
                <button
                  type="button"
                  onClick={() => onManualPossessionChange(null)}
                  className={`flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wider transition-all ${
                    manualPossession === null
                      ? "glass-btn-indigo text-indigo-200"
                      : "glass-btn text-slate-400"
                  }`}
                >
                  <Hand className="w-2.5 h-2.5" /> Auto
                </button>
              </div>
              {detectedPossessionTeam && (
                <p className="text-[8px] text-slate-500">
                  Trajectory:{" "}
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
                </p>
              )}
            </div>

            {/* Game State Scores */}
            <div className="glass-card p-2 space-y-1.5">
              <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                Scoreline
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="block">
                  <span className="mb-0.5 block text-[8px] text-slate-500">
                    Home
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
                    className="w-full rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-white/20 font-mono"
                  />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[8px] text-slate-500">
                    Away
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
                    className="w-full rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-white/20 font-mono"
                  />
                </label>
              </div>
            </div>

            {/* Teams Settings */}
            <div className="glass-card p-2 space-y-2">
              <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                Teams Config
              </h3>
              {renderTeamCard("team_a", "A", selectedIntentA)}
              {renderTeamCard("team_b", "B", selectedIntentB)}

              <div className="space-y-1.5 glass-card p-1.5">
                <div className="text-[8px] font-semibold uppercase tracking-widest text-slate-500">
                  Edit Identity ({currentTeam})
                </div>
                <label className="block">
                  <input
                    value={activeTeam.name}
                    onChange={(e) =>
                      updateTeam(currentTeam === "A" ? "team_a" : "team_b", {
                        name: e.target.value || `Team ${currentTeam}`,
                      })
                    }
                    className="w-full rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-[10px] text-slate-100 outline-none focus:border-white/20"
                  />
                </label>
              </div>
            </div>

            {/* Match Details Accordion */}
            <div className="glass-card p-2">
              <button
                type="button"
                onClick={() => setShowMatchDetails(!showMatchDetails)}
                className="w-full flex items-center justify-between text-left outline-none"
              >
                <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                  Match Details
                </h3>
                <motion.div
                  animate={{ rotate: showMatchDetails ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-3 h-3 text-slate-500" />
                </motion.div>
              </button>
              {showMatchDetails && (
                <div className="space-y-1.5 mt-2 pt-1.5 border-t border-white/5">
                  <label className="block">
                    <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
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
                      className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block">
                      <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                        Home
                      </span>
                      <input
                        type="text"
                        value={matchConfig.home_team}
                        onChange={(e) => {
                          const val = e.target.value;
                          onMatchConfigChange({
                            ...matchConfig,
                            home_team: val,
                          });
                          onTeamConfigChange({
                            ...teamConfig,
                            team_a: { ...teamConfig.team_a, name: val },
                          });
                        }}
                        className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                        Away
                      </span>
                      <input
                        type="text"
                        value={matchConfig.away_team}
                        onChange={(e) => {
                          const val = e.target.value;
                          onMatchConfigChange({
                            ...matchConfig,
                            away_team: val,
                          });
                          onTeamConfigChange({
                            ...teamConfig,
                            team_b: { ...teamConfig.team_b, name: val },
                          });
                        }}
                        className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block">
                      <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
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
                        className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
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
                        className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block">
                      <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                        Date
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
                        className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                        Score
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
                        className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-100 outline-none focus:border-indigo-500/50"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Apply Setup Button */}
            <motion.button
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleApplySetup}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all text-white cursor-pointer"
              style={{
                backgroundColor: activeTeam.jersey_color,
                boxShadow: `0 4px 20px ${activeTeam.jersey_color}30, 0 0 40px ${activeTeam.jersey_color}10`,
                border: `1px solid ${activeTeam.jersey_color}60`,
                backdropFilter: "blur(8px)",
              }}
            >
              <Unlock className="w-3 h-3" /> Apply Setup & Annotate
            </motion.button>
          </>
        )}

        {activeTab === "session" && (
          <>
            {/* Session Stats */}
            <div className="glass-card p-2 space-y-2">
              <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                Session Progress
              </h3>
              <h4 className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">
                Class Distribution
              </h4>
              {classDistribution.length === 0 ? (
                <p className="text-[9px] text-slate-500 italic py-1">
                  No annotations yet
                </p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                  {classDistribution.map(({ label, count, pct, hex }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <span className="text-[8px] text-slate-400 w-16 truncate">
                        {label}
                      </span>
                      <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%`, backgroundColor: hex }}
                        />
                      </div>
                      <span className="text-[8px] text-slate-500 w-3 text-right font-mono">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Export */}
            <div className="glass-card p-2 space-y-2">
              <h3 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                Export Session
              </h3>
              <div className="flex gap-1.5">
                <motion.button
                  whileHover={{ scale: 1.03, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onExportJSON}
                  className="flex-1 flex items-center justify-center gap-1 glass-btn-emerald py-1.5 rounded-lg text-[9px] font-bold text-emerald-400 uppercase tracking-wider cursor-pointer"
                >
                  <FileJson className="w-3 h-3" /> JSON
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onExportCSV}
                  className="flex-1 flex items-center justify-center gap-1 glass-btn-emerald py-1.5 rounded-lg text-[9px] font-bold text-emerald-400 uppercase tracking-wider cursor-pointer"
                >
                  <FileSpreadsheet className="w-3 h-3" /> CSV
                </motion.button>
              </div>
              <p className="text-[8px] text-slate-500 leading-snug italic pt-0.5 border-t border-white/5">
                Causal features computed during preprocessing.
              </p>
            </div>

            {/* Danger Zone */}
            <div className="glass-card p-2 space-y-1.5" style={{ borderColor: "rgba(244,63,94,0.15)" }}>
              <h3 className="text-[9px] font-semibold uppercase tracking-widest text-rose-400">
                Danger Zone
              </h3>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onReset}
                className="w-full flex items-center justify-center gap-1 glass-btn-rose py-1.5 rounded-lg text-[9px] font-bold text-rose-400 uppercase tracking-wider cursor-pointer"
              >
                <Trash2 className="w-2.5 h-2.5" /> Reset Session
              </motion.button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
