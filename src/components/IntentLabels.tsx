"use client";

import { Layers, Check, SkipForward } from "lucide-react";
import {
  TACTIC_INTENTS,
  getIntentLabel,
  type TeamConfig,
} from "@/lib/constants";

interface Props {
  currentTeam: "A" | "B";
  selectedIntentA: string;
  selectedIntentB: string;
  teamConfig: { team_a: TeamConfig; team_b: TeamConfig };
  disabledIntentIds?: string[];
  detectedPossessionTeam?: "A" | "B" | null;
  contestedPossessionSuggested?: boolean;
  hasManualPossessionOverride?: boolean;
  onIntentClick: (id: string) => void;
  onSubmit?: () => void;
  onSkip?: () => void;
  exclusion: "DeadBall" | "ContestedPlay" | null;
  setExclusion: (val: "DeadBall" | "ContestedPlay" | null) => void;
}

export default function IntentLabels({
  currentTeam,
  selectedIntentA,
  selectedIntentB,
  teamConfig,
  disabledIntentIds = [],
  detectedPossessionTeam = null,
  contestedPossessionSuggested = false,
  hasManualPossessionOverride = false,
  onIntentClick,
  onSubmit,
  onSkip,
  exclusion,
  setExclusion,
}: Props) {
  const selectedId = currentTeam === "A" ? selectedIntentA : selectedIntentB;
  const activeTeam =
    currentTeam === "A" ? teamConfig.team_a : teamConfig.team_b;
  const teamAColor = teamConfig.team_a.jersey_color;
  const teamBColor = teamConfig.team_b.jersey_color;

  return (
    <div className="shrink-0 bg-black/40 rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-slate-400" />
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Intent Labels
          </h3>
        </div>
        <span className="text-[9px] text-slate-500">
          Annotating:{" "}
          <span
            className="font-semibold"
            style={{ color: activeTeam.jersey_color }}
          >
            {activeTeam.name}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-6 gap-3">
        {TACTIC_INTENTS.map((group) => {
          const isTacticalGroup = group.group !== "EXCLUSION";
          return (
            <div
              key={group.group}
              className={`flex flex-col gap-1.5 ${isTacticalGroup && exclusion ? "opacity-30 pointer-events-none" : ""}`}
            >
              <span
                className={`text-[9px] font-bold uppercase tracking-widest ${group.color}`}
              >
                {group.group}
              </span>
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const isSelected = selectedId === item.id;
                  const selectedByA = selectedIntentA === item.id;
                  const selectedByB = selectedIntentB === item.id;
                  const isDisabled = disabledIntentIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      disabled={isDisabled}
                      onClick={() => onIntentClick(item.id)}
                      className={`relative flex items-center gap-2 px-2 py-1.5 rounded-md border text-left transition-all ${
                        isDisabled
                          ? "cursor-not-allowed bg-white/[0.01] border-white/[0.03] opacity-40"
                          : isSelected
                            ? "bg-white/[0.08] shadow-[inset_2px_0_0_0_currentColor]"
                            : "bg-white/[0.02] border-white/5 hover:bg-white/10 hover:border-white/20"
                      }`}
                      style={
                        isSelected
                          ? {
                              color: activeTeam.jersey_color,
                              borderColor: `${activeTeam.jersey_color}88`,
                            }
                          : {}
                      }
                      title={`${item.label} (${item.hotkey})`}
                    >
                      <span
                        className={`text-[10px] font-bold font-mono min-w-[14px] text-center ${isSelected ? group.color : "text-slate-500"}`}
                      >
                        {item.hotkey}
                      </span>
                      <span
                        className={`text-[11px] truncate ${isSelected ? "text-white font-medium" : "text-slate-300"}`}
                      >
                        {item.label}
                      </span>
                      {(selectedByA || selectedByB) && (
                        <span className="ml-auto flex items-center gap-0.5">
                          {selectedByA && (
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: teamAColor }}
                              title={`${teamConfig.team_a.name} selected`}
                            />
                          )}
                          {selectedByB && (
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: teamBColor }}
                              title={`${teamConfig.team_b.name} selected`}
                            />
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {exclusion && (
        <div className="mt-3 rounded border border-slate-500 bg-slate-800/50 p-2 text-xs text-slate-300">
          EXCLUSION: <span className="font-semibold text-slate-100">{exclusion}</span>
          <button onClick={() => setExclusion(null)} className="ml-2 text-rose-400 hover:underline">
            Clear (Esc)
          </button>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-4 text-[10px] text-slate-500">
        <span>
          {teamConfig.team_a.name}:{" "}
          <span className="font-medium" style={{ color: teamAColor }}>
            {getIntentLabel(selectedIntentA) || "-"}
          </span>
        </span>
        <span>
          {teamConfig.team_b.name}:{" "}
          <span className="font-medium" style={{ color: teamBColor }}>
            {getIntentLabel(selectedIntentB) || "-"}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          {hasManualPossessionOverride && (
            <span
              className="font-mono uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded"
              title="Possession is set manually for this segment, overriding the trajectory signal."
            >
              override
            </span>
          )}
          <span>
            Trajectory:{" "}
            {contestedPossessionSuggested ? (
              <span className="font-medium text-slate-300">contested</span>
            ) : detectedPossessionTeam ? (
              <span
                className="font-medium"
                style={{
                  color:
                    detectedPossessionTeam === "A" ? teamAColor : teamBColor,
                }}
              >
                {detectedPossessionTeam === "A"
                  ? teamConfig.team_a.name
                  : teamConfig.team_b.name}
              </span>
            ) : (
              <span className="font-medium text-slate-400">manual</span>
            )}
          </span>
        </span>
      </div>

      {/* Submit / Skip buttons for easy access */}
      {(onSubmit || onSkip) && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-3">
          {onSubmit && (
            <button
              onClick={onSubmit}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors"
              title="Submit annotation (Enter)"
            >
              <Check className="w-3.5 h-3.5" />
              Submit
              <kbd className="ml-1 bg-black/30 px-1 py-0.5 rounded text-[9px] font-mono">
                Enter
              </kbd>
            </button>
          )}
          {onSkip && (
            <button
              onClick={onSkip}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-medium transition-colors"
              title="Skip clip (S)"
            >
              <SkipForward className="w-3.5 h-3.5" />
              Skip
              <kbd className="ml-1 bg-black/30 px-1 py-0.5 rounded text-[9px] font-mono">
                S
              </kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
