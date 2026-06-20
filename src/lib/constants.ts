"use client";

export const TACTIC_INTENTS = [
  {
    group: "BUILDUP",
    color: "text-teal-400",
    hex: "#2dd4bf",
    border: "border-teal-500",
    items: [
      { id: "1", label: "BuildUp_Short", hotkey: "1" },
      { id: "2", label: "BuildUp_Long", hotkey: "2" },
      { id: "3", label: "PossCirculation", hotkey: "Q" },
    ],
  },
  {
    group: "ATTACK",
    color: "text-indigo-400",
    hex: "#818cf8",
    border: "border-indigo-500",
    items: [
      { id: "4", label: "CounterAttack", hotkey: "3" },
      { id: "5", label: "DirectAttack", hotkey: "W" },
    ],
  },
  {
    group: "PRESS",
    color: "text-rose-400",
    hex: "#fb7185",
    border: "border-rose-500",
    items: [
      { id: "6", label: "HighPress", hotkey: "4" },
      { id: "7", label: "MidBlockPress", hotkey: "5" },
      { id: "8", label: "LowBlock", hotkey: "6" },
    ],
  },
  {
    group: "TRANSITION",
    color: "text-purple-400",
    hex: "#c084fc",
    border: "border-purple-500",
    items: [
      { id: "9", label: "AttackingTrans", hotkey: "7" },
      { id: "10", label: "DefensiveTrans", hotkey: "8" },
    ],
  },
  {
    group: "SETPIECE",
    color: "text-pink-400",
    hex: "#f472b6",
    border: "border-pink-500",
    items: [
      { id: "11", label: "SetPieceAttack", hotkey: "9" },
      { id: "12", label: "SetPieceDefend", hotkey: "0" },
    ],
  },
  {
    group: "EXCLUSION",
    color: "text-slate-400",
    hex: "#94a3b8",
    border: "border-slate-500",
    items: [
      { id: "13", label: "DeadBall", hotkey: "R" },
      { id: "14", label: "ContestedPlay", hotkey: "T" },
    ],
  },
] as const;

type IntentItem = { id: string; label: string; hotkey: string };

export const HOTKEY_MAP: Record<string, string> = {};
TACTIC_INTENTS.forEach((g) =>
  g.items.forEach((i) => {
    HOTKEY_MAP[i.hotkey.toLowerCase()] = i.id;
  }),
);

export const ALL_ITEMS: IntentItem[] = TACTIC_INTENTS.flatMap((g) => [
  ...g.items,
]);

export function getIntentLabel(id: string): string {
  return ALL_ITEMS.find((i) => i.id === id)?.label || "";
}
export function getIntentId(label: string): string {
  return ALL_ITEMS.find((i) => i.label === label)?.id || "";
}
export function getIntentGroupHex(label: string): string {
  for (const g of TACTIC_INTENTS) {
    if (g.items.some((i) => i.label === label)) return g.hex;
  }
  return "#94a3b8";
}

export const ATTACK_INTENTS = [
  "BuildUp_Short",
  "BuildUp_Long",
  "CounterAttack",
  "DirectAttack",
  "PossCirculation",
  "SetPieceAttack",
  "AttackingTrans",
];
export const DEFENSE_INTENTS = [
  "HighPress",
  "MidBlockPress",
  "LowBlock",
  "SetPieceDefend",
  "DefensiveTrans",
];
export const EXCLUSION_INTENTS = ["DeadBall", "ContestedPlay"] as const;
export const SET_PIECE_INTENTS = ["SetPieceAttack", "SetPieceDefend"];

export function isExclusionIntent(label: string | null): boolean {
  if (!label) return false;
  return EXCLUSION_INTENTS.includes(label as any);
}

export type ModelSplit = "train" | "val" | "test" | "excluded";
export function isAttackIntent(label: string): boolean {
  return ATTACK_INTENTS.includes(label);
}
export function isDefenseIntent(label: string): boolean {
  return DEFENSE_INTENTS.includes(label);
}
export function isSetPieceIntent(label: string): boolean {
  return SET_PIECE_INTENTS.includes(label);
}

export const CERTAINTY_MAP: Record<number, string> = {
  1: "very_low",
  2: "low",
  3: "medium",
  4: "high",
  5: "very_high",
};
export const CONFIDENCE_LABELS = [
  "Guess",
  "Uncertain",
  "Moderate",
  "Confident",
  "Certain",
];
export const PHASE_KEYS = ["BuildUp", "Press", "Block", "Transition"] as const;

export type PhaseKey = (typeof PHASE_KEYS)[number];
export type PhaseMixture = Record<PhaseKey, number>;
export type Certainty = "low" | "medium" | "high";

export const DEFAULT_PHASE_MIXTURE: PhaseMixture = {
  BuildUp: 25,
  Press: 25,
  Block: 25,
  Transition: 25,
};

export function HALF_LABEL(h: number): string {
  return h === 1 ? "1st" : "2nd";
}

// ─── Match plan ───
// Maximum segment duration in seconds. No single intent segment should
// exceed this. Segments longer than 15s are auto-split on save.
export const MAX_SEGMENT_DURATION = 15;

export type AnnotatorState =
  | "unseen"
  | "accepted"
  | "modified"
  | "rejected"
  | "manual";

export interface AlgorithmProposal {
  start: number;
  end: number;
  confidence: number;
  reason: string;
}

export interface Clip {
  clip_id: string;
  match_id: string;
  path: string;
  start: number;
  end: number;
  annotation_start: number;
  annotation_end: number;
  annotation_window: number;
  half: number;
  game_clock?: string;
  window_idx?: number;
  match_name?: string;
  competition?: string;
  season?: string;
  trajectory_path?: string;
  anchor_event?: {
    type: string;
    team?: string;
    timestamp?: number;
    description?: string;
  };
  following_event?: string;
  segment_proposal?: {
    reason: string;
    shift_frame: number;
    confidence: number;
    approved?: boolean;
    rejected?: boolean;
    split_frames?: number[];
  };
  possession_state?: {
    type: string;
    team: string | null;
    confidence: number;
    method: string;
  };
  team_perspective?: {
    team_a_color: string;
    team_b_color: string;
    team_a_attacking_direction: string;
    recommended_annotate_team: string;
  };
  resolution?: {
    width: number;
    height: number;
    tier: string;
    fps: number;
    total_frames: number;
    duration_seconds: number;
  };
  features?: Record<string, number>;
  quality_score?: number;
  quality_issues?: string[];
  tracking_coverage?: {
    team_a_avg?: number;
    team_b_avg?: number;
    ball_frames?: number;
    total_frames?: number;
  };
  algorithm_proposal?: AlgorithmProposal;
  annotator_state?: AnnotatorState;
  is_locked?: boolean;
  reconstruction?: {
    npz_path: string;
    tensor_fps?: number;
    quality_pass?: boolean;
    tracked_players?: number;
  };
}

export interface TeamConfig {
  id: "A" | "B";
  name: string;
  jersey_color: string;
  is_home: boolean;
}

export interface GameState {
  half: "1st" | "2nd" | "ET1" | "ET2";
  match_clock_sec: number;
  score_home: number;
  score_away: number;
  set_piece?: boolean;
  set_piece_type?: "corner" | "free_kick" | "throw_in" | "penalty";
}

export function normalizeClip(raw: Partial<Clip> & Record<string, any>): Clip {
  const start = Number(raw.start ?? raw.start_sec ?? raw.seek_start_sec ?? 0);
  const end = Number(raw.end ?? raw.end_sec ?? raw.seek_end_sec ?? start + 18);
  const annotationStart = Number(
    raw.annotation_start ?? raw.label_start_sec ?? start + 4,
  );
  const annotationEnd = Number(
    raw.annotation_end ?? raw.label_end_sec ?? annotationStart + 10,
  );

  return {
    clip_id: String(
      raw.clip_id ?? raw.id ?? `${raw.match_id ?? "match"}_${start}`,
    ),
    match_id: String(raw.match_id ?? "unknown_match"),
    path: String(
      raw.path ?? raw.video_path ?? raw.video_source?.video_path ?? "",
    ),
    start,
    end,
    annotation_start: annotationStart,
    annotation_end: annotationEnd,
    annotation_window: Number(
      raw.annotation_window ?? annotationEnd - annotationStart,
    ),
    half: Number(raw.half ?? 1),
    game_clock: raw.game_clock,
    window_idx: raw.window_idx,
    match_name: raw.match_name,
    competition: raw.competition,
    season: raw.season,
    trajectory_path: raw.trajectory_path,
    anchor_event: raw.anchor_event,
    following_event: raw.following_event,
    segment_proposal: raw.segment_proposal,
    possession_state: raw.possession_state,
    team_perspective: raw.team_perspective,
    resolution: raw.resolution,
    features: raw.features,
    quality_score: raw.quality_score,
    quality_issues: raw.quality_issues,
    tracking_coverage: raw.tracking_coverage,
    algorithm_proposal: raw.algorithm_proposal,
    annotator_state: raw.annotator_state,
    is_locked: raw.is_locked,
  };
}

export function makeUniqueClipIds(clips: Clip[]): Clip[] {
  const totals = new Map<string, number>();
  clips.forEach((clip) =>
    totals.set(clip.clip_id, (totals.get(clip.clip_id) || 0) + 1),
  );

  const used = new Set<string>();
  return clips.map((clip) => {
    if ((totals.get(clip.clip_id) || 0) === 1 && !used.has(clip.clip_id)) {
      used.add(clip.clip_id);
      return clip;
    }

    const stem = clip.clip_id.replace(/_h\d+$/i, "");
    const windowPart = String(
      clip.window_idx ?? Math.round(clip.start),
    ).padStart(4, "0");
    const pathPart = clip.path
      ? clip.path
          .replace(/\.[^.]+$/, "")
          .split(/[\\/]/)
          .pop()
          ?.replace(/[^a-zA-Z0-9]+/g, "_")
      : "";
    const candidates = [
      `${stem}_h${clip.half}_${windowPart}`,
      pathPart ? `${stem}_${pathPart}_${windowPart}` : "",
      `${stem}_h${clip.half}_${windowPart}_${used.size}`,
    ].filter(Boolean);

    const uniqueId =
      candidates.find((candidate) => !used.has(candidate)) ||
      `${stem}_${used.size}`;
    used.add(uniqueId);
    return { ...clip, clip_id: uniqueId };
  });
}

export function generateNpzPath(matchId: string, clipId: string): string {
  // Sanitize for filesystem safety
  const safeMatch = matchId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeClip = clipId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `data/trajectories/${safeMatch}/${safeClip}.npz`;
}

export function generateClipId(
  matchId: string,
  half: number,
  startSec: number,
  suffix?: string
): string {
  const base = `${matchId}_h${half}_${Math.floor(startSec * 10)
    .toString()
    .padStart(5, "0")}`;
  return suffix ? `${base}_${suffix}` : base;
}

export interface Annotation {
  schema_version: string;
  dataset: string;
  clip_id: string;
  match_id: string;
  match_name: string;
  half: string;
  window_idx: number;
  game_state?: GameState;
  video_source: {
    video_path: string;
    seek_start_sec: number;
    label_start_sec: number;
    label_end_sec: number;
    seek_end_sec: number;
    fps: number;
    tensor_fps?: number;
    source_frame_count?: number;
    tensor_frame_count?: number;
    frame_count?: number;
  };
  segment_metadata?: {
    start_sec: number;
    end_sec: number;
    duration_sec: number;
    tensor_frames: number;
    preceding_event?: string;
    following_event?: string;
    coverage_estimate: number;
    is_mixed_phase: boolean;
  };
  reconstruction: {
    npz_path: string;
    tensor_shape?: number[] | undefined;
    tensor_fps?: number | undefined;
    quality_pass: boolean;
    tracked_players?: number;
    padding_mask?: boolean[] | undefined;
    tracking_confidence_mean?: number;
  };

  team_a: {
    team_id: string;
    team_name?: string;
    jersey_color?: string;
    is_home: boolean;
    is_primary: boolean;
    formation_estimate?: string;
    players_visible?: number;
    label: {
      intent_class: string | null;
      confidence: number;
      certainty: Certainty | string;
      phase_mixture?: PhaseMixture;
    };
    possession: boolean;
  };
  team_b: {
    team_id: string;
    team_name?: string;
    jersey_color?: string;
    is_home: boolean;
    is_primary: boolean;
    formation_estimate?: string;
    players_visible?: number;
    label: {
      intent_class: string | null;
      confidence: number;
      certainty: Certainty | string;
      phase_mixture?: PhaseMixture;
    };
    possession: boolean;
  };
  team_config?: { team_a: TeamConfig; team_b: TeamConfig };
  exclusion: string | null;
  annotation_meta: {
    annotator_id: string;
    session_id: string;
    annotation_timestamp: string;
    annotation_duration_sec: number;
    tool_version: string;
    re_annotation_count?: number;
  };
  dag_features?: {
    formation_compactness?: number;
    pressing_speed?: number;
    pitch_control_share?: number;
    xg_estimate?: number;
    phase_mixture?: number[];
  };
  agreement: {
    annotated_at: string;
    flagged_review: boolean;
    skipped: boolean;
  };
  model_split: { assigned_split: string };
}
