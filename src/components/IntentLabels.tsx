"use client";

import { motion } from "framer-motion";
import { Layers, Check } from "lucide-react";
import {
  TACTIC_INTENTS,
  getIntentLabel,
  type TeamConfig,
  type GameState,
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
  exclusion: "DeadBall" | "ContestedPlay" | null;
  setExclusion: (val: "DeadBall" | "ContestedPlay" | null) => void;
  gameState: GameState;
  onGameStateChange: (state: GameState) => void;
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
  exclusion,
  setExclusion,
  gameState,
  onGameStateChange,
}: Props) {
  const selectedId = currentTeam === "A" ? selectedIntentA : selectedIntentB;
  const activeTeam =
    currentTeam === "A" ? teamConfig.team_a : teamConfig.team_b;
  const teamAColor = teamConfig.team_a.jersey_color;
  const teamBColor = teamConfig.team_b.jersey_color;

  return (
    <div className="shrink-0 rounded-xl p-4 glass-card">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
            <Layers className="w-3 h-3 text-indigo-400" />
          </div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-300">
            Intent Labels Deck
          </h3>
        </div>
        <span className="text-[9px] text-slate-400 glass-btn px-2 py-0.5 rounded-md">
          Annotating:{" "}
          <span
            className="font-bold"
            style={{ color: activeTeam.jersey_color }}
          >
            {activeTeam.name} ({currentTeam})
          </span>
        </span>
      </div>

      {/* Grid of Intent Groups */}
      <div className="grid grid-cols-6 gap-3">
        {TACTIC_INTENTS.map((group) => {
          const isTacticalGroup = group.group !== "EXCLUSION";
          return (
            <div
              key={group.group}
              className={`flex flex-col gap-2 ${isTacticalGroup && exclusion ? "opacity-30 pointer-events-none" : ""}`}
            >
              {/* Group Header Badge */}
              <div className="flex items-center gap-1.5 px-1 py-0.5 border-b border-white/10 pb-1">
                <span
                  className="w-1.5 h-1.5 rounded-full shadow-[0_0_6px_currentColor]"
                  style={{ backgroundColor: group.hex }}
                />
                <span
                  className="text-[9px] font-extrabold uppercase tracking-wider"
                  style={{ color: group.hex }}
                >
                  {group.group}
                </span>
              </div>

              {/* Group Buttons */}
              <div className="flex flex-col gap-1.5">
                {group.items.map((item) => {
                  const isSelected = selectedId === item.id;
                  const selectedByA = selectedIntentA === item.id;
                  const selectedByB = selectedIntentB === item.id;
                  const isDisabled = disabledIntentIds.includes(item.id);

                  return (
                    <motion.button
                      key={item.id}
                      disabled={isDisabled}
                      whileHover={!isDisabled ? { scale: 1.03, y: -1 } : undefined}
                      whileTap={!isDisabled ? { scale: 0.97 } : undefined}
                      onClick={() => onIntentClick(item.id)}
                      className={`relative flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition-all duration-200 cursor-pointer group ${
                        isDisabled
                          ? "cursor-not-allowed opacity-30 bg-white/[0.01] border border-white/5"
                          : isSelected
                            ? "bg-slate-900/95 border shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
                            : "bg-[#131722]/90 hover:bg-[#1c2232]/90 border border-white/10 hover:border-white/25 shadow-sm"
                      }`}
                      style={
                        isSelected
                          ? {
                              borderColor: activeTeam.jersey_color,
                              background: `linear-gradient(135deg, ${activeTeam.jersey_color}30 0%, rgba(15,23,42,0.95) 100%)`,
                              boxShadow: `0 0 20px ${activeTeam.jersey_color}35, 0 4px 12px rgba(0,0,0,0.4), inset 3px 0 0 0 ${activeTeam.jersey_color}`,
                            }
                          : {}
                      }
                      title={`${item.label} (${item.hotkey})`}
                    >
                      {/* Category Color Dot/Bar Indicator */}
                      <span
                        className="w-1 h-3 rounded-full shrink-0 shadow-[0_0_6px_currentColor]"
                        style={{ backgroundColor: group.hex }}
                      />

                      {/* Hotkey Badge Pill */}
                      <span
                        className={`text-[10px] font-extrabold font-mono px-1.5 py-0.5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? "bg-white/20 text-white shadow-sm"
                            : "bg-white/10 group-hover:bg-white/20 text-slate-200 border border-white/15"
                        }`}
                        style={
                          isSelected
                            ? { backgroundColor: `${activeTeam.jersey_color}60`, color: "#fff" }
                            : {}
                        }
                      >
                        {item.hotkey}
                      </span>

                      {/* Intent Label Text */}
                      <span
                        className={`text-[11px] truncate tracking-tight ${
                          isSelected
                            ? "text-white font-bold"
                            : "text-slate-200 group-hover:text-white font-medium"
                        }`}
                      >
                        {item.label}
                      </span>

                      {/* Selected indicators by Team A / B */}
                      {(selectedByA || selectedByB) && (
                        <span className="ml-auto flex items-center gap-1 shrink-0">
                          {selectedByA && (
                            <span
                              className="h-2 w-2 rounded-full ring-2 ring-black/60 shadow-[0_0_8px_currentColor]"
                              style={{ backgroundColor: teamAColor }}
                              title={`${teamConfig.team_a.name} selected`}
                            />
                          )}
                          {selectedByB && (
                            <span
                              className="h-2 w-2 rounded-full ring-2 ring-black/60 shadow-[0_0_8px_currentColor]"
                              style={{ backgroundColor: teamBColor }}
                              title={`${teamConfig.team_b.name} selected`}
                            />
                          )}
                        </span>
                      )}
                    </motion.button>
                  );
                })}

                {/* Set Piece expander */}
                {group.group === "SETPIECE" && (
                  <div
                    className={`mt-2 p-2.5 rounded-xl transition-all duration-300 ${
                      gameState.set_piece
                        ? "glass-card border-pink-500/40 shadow-[0_0_20px_rgba(244,63,94,0.15)]"
                        : "glass-btn"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                        Set Piece Mode
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onGameStateChange({
                            ...gameState,
                            set_piece: !gameState.set_piece,
                            set_piece_type: !gameState.set_piece
                              ? gameState.set_piece_type || "corner"
                              : undefined,
                          })
                        }
                        className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                          gameState.set_piece
                            ? "bg-pink-500 text-white shadow-[0_2px_8px_rgba(244,63,94,0.5)]"
                            : "glass-btn text-slate-300"
                        }`}
                      >
                        {gameState.set_piece ? "Active" : "Off"}
                      </button>
                    </div>

                    {gameState.set_piece && (
                      <div className="grid grid-cols-2 gap-1 mt-1.5">
                        {(
                          [
                            { value: "corner", label: "Corner" },
                            { value: "free_kick", label: "Free Kick" },
                            { value: "throw_in", label: "Throw In" },
                            { value: "penalty", label: "Penalty" },
                          ] as const
                        ).map((opt) => {
                          const isSel = gameState.set_piece_type === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() =>
                                onGameStateChange({
                                  ...gameState,
                                  set_piece_type: opt.value,
                                })
                              }
                              className={`py-1 rounded text-[9px] font-semibold transition-all border cursor-pointer ${
                                isSel
                                  ? "glass-btn-rose text-pink-200 border-pink-400"
                                  : "glass-btn text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {exclusion && (
        <div className="mt-3 rounded-lg border border-amber-500/30 glass-btn-amber p-2 text-xs text-amber-200 flex items-center justify-between">
          <div>
            EXCLUSION ACTIVE:{" "}
            <span className="font-bold text-white">{exclusion}</span>
          </div>
          <button
            onClick={() => setExclusion(null)}
            className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-bold hover:bg-rose-500/30 cursor-pointer"
          >
            Clear (Esc)
          </button>
        </div>
      )}

      {/* Summary Footer */}
      <div className="mt-3.5 pt-3 border-t border-white/10 flex items-center gap-4 text-[10px] text-slate-400">
        <span>
          {teamConfig.team_a.name}:{" "}
          <span className="font-semibold" style={{ color: teamAColor }}>
            {getIntentLabel(selectedIntentA) || "None"}
          </span>
        </span>
        <span>
          {teamConfig.team_b.name}:{" "}
          <span className="font-semibold" style={{ color: teamBColor }}>
            {getIntentLabel(selectedIntentB) || "None"}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          {hasManualPossessionOverride && (
            <span
              className="font-mono uppercase tracking-wider text-amber-300 glass-btn-amber px-1.5 py-0.5 rounded"
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

      {/* Submit button */}
      {onSubmit && (
        <div
          className="mt-3 pt-3 border-t border-white/10 flex items-center gap-3 sticky bottom-0"
          style={{
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            background: "rgba(10, 12, 16, 0.6)",
          }}
        >
          <motion.button
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={onSubmit}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-white transition-all cursor-pointer"
            style={{
              backgroundColor: activeTeam.jersey_color,
              boxShadow: `0 4px 20px ${activeTeam.jersey_color}35, 0 0 35px ${activeTeam.jersey_color}15`,
              border: `1px solid ${activeTeam.jersey_color}70`,
            }}
            title="Submit annotation (Enter)"
          >
            <Check className="w-3.5 h-3.5" />
            Submit Annotation ({currentTeam})
            <kbd className="ml-1.5 bg-black/40 px-1.5 py-0.5 rounded text-[9px] font-mono text-white/90">
              Enter
            </kbd>
          </motion.button>
        </div>
      )}
    </div>
  );
}
