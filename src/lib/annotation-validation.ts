import fs from "fs";
import path from "path";
import { MAX_MODEL_FRAMES, MODEL_FPS } from "./tensor-utils";

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
  severity: IssueSeverity;
  suggestion?: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface AnnotationValidationOptions {
  cwd?: string;
  requireNpz?: boolean;
  requireContiguous?: boolean;
  requireReviewConfirmation?: boolean;
}

const MIN_SEGMENT_SEC = 2;
const MAX_SEGMENT_SEC = 15;
const TIME_EPS = 1e-6;
const VALID_INTENTS = new Set([
  "BuildUp_Short",
  "BuildUp_Long",
  "PossCirculation",
  "CounterAttack",
  "DirectAttack",
  "HighPress",
  "MidBlockPress",
  "LowBlock",
  "AttackingTrans",
  "DefensiveTrans",
  "SetPieceAttack",
  "SetPieceDefend",
]);
const ATTACK_INTENTS = new Set([
  "BuildUp_Short",
  "BuildUp_Long",
  "PossCirculation",
  "CounterAttack",
  "DirectAttack",
  "AttackingTrans",
  "SetPieceAttack",
]);
const DEFENSE_INTENTS = new Set([
  "HighPress",
  "MidBlockPress",
  "LowBlock",
  "DefensiveTrans",
  "SetPieceDefend",
]);
const SET_PIECE_INTENTS = new Set(["SetPieceAttack", "SetPieceDefend"]);
const EXCLUSIONS = new Set(["DeadBall", "ContestedPlay"]);
const CERTAINTIES = new Set(["low", "medium", "high"]);
const SPLITS = new Set(["train", "val", "test", "excluded"]);

function issue(
  severity: IssueSeverity,
  code: string,
  message: string,
  path?: string,
  suggestion?: string,
): ValidationIssue {
  return { severity, code, message, path, suggestion };
}

function asFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readLabel(team: any): string | null {
  const label = team?.label?.intent_class;
  return typeof label === "string" && label.length > 0 ? label : null;
}

function npzExists(npzPath: string, cwd: string): boolean {
  const candidates = [
    path.resolve(cwd, npzPath),
    path.resolve(cwd, "public", npzPath),
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function validateTeamLabel(
  ann: any,
  teamKey: "team_a" | "team_b",
  prefix: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
) {
  const team = ann?.[teamKey];
  const label = readLabel(team);
  const confidence = team?.label?.confidence;
  const certainty = team?.label?.certainty;

  if (label && !VALID_INTENTS.has(label)) {
    errors.push(
      issue(
        "error",
        "invalid_intent",
        `${prefix}: ${teamKey} intent "${label}" is not in the taxonomy`,
        `${teamKey}.label.intent_class`,
      ),
    );
  }

  if (!ann.exclusion) {
    const confidenceNum = asFiniteNumber(confidence);
    if (confidenceNum === null || confidenceNum < 1 || confidenceNum > 5) {
      errors.push(
        issue(
          "error",
          "invalid_confidence",
          `${prefix}: ${teamKey} confidence must be an integer from 1 to 5`,
          `${teamKey}.label.confidence`,
        ),
      );
    } else if (confidenceNum <= 2 || ann?.agreement?.flagged_review) {
      warnings.push(
        issue(
          "warning",
          "review_required",
          `${prefix}: low confidence or uncertainty requires reviewer confirmation`,
          `${teamKey}.label.confidence`,
          "Send this segment to review before training export.",
        ),
      );
    }

    if (typeof certainty !== "string" || !CERTAINTIES.has(certainty)) {
      errors.push(
        issue(
          "error",
          "invalid_certainty",
          `${prefix}: ${teamKey} certainty must be low, medium, or high`,
          `${teamKey}.label.certainty`,
        ),
      );
    }
  }
}

function segmentTimes(ann: any) {
  const start = asFiniteNumber(
    ann?.segment_metadata?.start_sec ?? ann?.video_source?.label_start_sec,
  );
  const end = asFiniteNumber(
    ann?.segment_metadata?.end_sec ?? ann?.video_source?.label_end_sec,
  );
  const duration = asFiniteNumber(ann?.segment_metadata?.duration_sec);
  return {
    start,
    end,
    duration: duration ?? (start !== null && end !== null ? end - start : null),
  };
}

function validateOneAnnotation(
  ann: any,
  index: number,
  options: Required<AnnotationValidationOptions>,
  seenIds: Set<string>,
  seenNpz: Map<string, string>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
) {
  const id = typeof ann?.clip_id === "string" ? ann.clip_id : "";
  const prefix = id || `annotation[${index}]`;

  if (!id) {
    errors.push(
      issue("error", "missing_clip_id", `annotation[${index}]: clip_id is required`, "clip_id"),
    );
  } else if (seenIds.has(id)) {
    errors.push(
      issue("error", "duplicate_clip_id", `${prefix}: duplicate clip_id`, "clip_id"),
    );
  } else {
    seenIds.add(id);
  }

  if (typeof ann?.match_id !== "string" || ann.match_id.length === 0) {
    errors.push(
      issue("error", "missing_match_id", `${prefix}: match_id is required`, "match_id"),
    );
  }

  const { start, end, duration } = segmentTimes(ann);
  if (start === null || end === null || duration === null) {
    errors.push(
      issue("error", "invalid_timing", `${prefix}: segment timing must be finite numbers`),
    );
  } else {
    if (start < 0) {
      errors.push(issue("error", "negative_start", `${prefix}: start_sec cannot be negative`));
    }
    if (end <= start) {
      errors.push(issue("error", "non_positive_duration", `${prefix}: end_sec must be after start_sec`));
    }
    const derivedDuration = end - start;
    if (Math.abs(derivedDuration - duration) > 0.01) {
      errors.push(
        issue(
          "error",
          "duration_mismatch",
          `${prefix}: duration_sec (${duration}) does not match end-start (${derivedDuration})`,
          "segment_metadata.duration_sec",
          "Recompute duration from the accepted start/end timestamps.",
        ),
      );
    }
    if (derivedDuration + TIME_EPS < MIN_SEGMENT_SEC) {
      errors.push(issue("error", "segment_too_short", `${prefix}: segment is shorter than ${MIN_SEGMENT_SEC}s`));
    }
    if (derivedDuration - MAX_SEGMENT_SEC > TIME_EPS) {
      errors.push(
        issue(
          "error",
          "segment_too_long",
          `${prefix}: segment exceeds ${MAX_SEGMENT_SEC}s`,
          "segment_metadata.duration_sec",
          "Split this segment before saving or exporting.",
        ),
      );
    }

    const tensorFrames = asFiniteNumber(
      ann?.segment_metadata?.tensor_frames ?? ann?.video_source?.tensor_frame_count,
    );
    const expectedFrames = Math.round(derivedDuration * MODEL_FPS);
    if (tensorFrames === null || tensorFrames < MIN_SEGMENT_SEC * MODEL_FPS || tensorFrames > MAX_MODEL_FRAMES) {
      errors.push(
        issue("error", "invalid_tensor_frames", `${prefix}: tensor frame count is invalid`, "segment_metadata.tensor_frames"),
      );
    } else if (Math.abs(tensorFrames - Math.min(expectedFrames, MAX_MODEL_FRAMES)) > 1) {
      errors.push(
        issue(
          "error",
          "tensor_frame_mismatch",
          `${prefix}: tensor frames (${tensorFrames}) do not match ${MODEL_FPS}fps duration (${expectedFrames})`,
          "segment_metadata.tensor_frames",
        ),
      );
    }
  }

  const exclusion = ann?.exclusion;
  const hasExclusion = typeof exclusion === "string" && exclusion.length > 0;
  if (hasExclusion && !EXCLUSIONS.has(exclusion)) {
    errors.push(issue("error", "invalid_exclusion", `${prefix}: invalid exclusion "${exclusion}"`, "exclusion"));
  }

  const teamAIntent = readLabel(ann?.team_a);
  const teamBIntent = readLabel(ann?.team_b);
  const teamAPossession = ann?.team_a?.possession === true;
  const teamBPossession = ann?.team_b?.possession === true;
  const primaryCount = [ann?.team_a, ann?.team_b].filter((team) => team?.is_primary === true).length;

  if (hasExclusion) {
    if (teamAIntent !== null || teamBIntent !== null) {
      errors.push(
        issue(
          "error",
          "exclusion_has_tactical_label",
          `${prefix}: exclusions must not carry tactical team labels`,
          "exclusion",
          "Clear team intent/confidence fields when exclusion is set.",
        ),
      );
    }
    if (ann?.model_split?.assigned_split !== "excluded") {
      errors.push(issue("error", "invalid_exclusion_split", `${prefix}: exclusion split must be excluded`, "model_split.assigned_split"));
    }
  } else {
    validateTeamLabel(ann, "team_a", prefix, errors, warnings);
    validateTeamLabel(ann, "team_b", prefix, errors, warnings);

    if (!teamAIntent || !teamBIntent) {
      errors.push(issue("error", "missing_team_intent", `${prefix}: both teams need tactical intents before persistence`));
    }
    if (primaryCount !== 1) {
      errors.push(issue("error", "invalid_primary_team", `${prefix}: exactly one primary team is required`));
    }
    if (teamAPossession === teamBPossession) {
      errors.push(issue("error", "invalid_possession", `${prefix}: exactly one team must have possession for tactical labels`));
    }
    if ((teamAPossession && teamBIntent && ATTACK_INTENTS.has(teamBIntent)) || (teamBPossession && teamAIntent && ATTACK_INTENTS.has(teamAIntent))) {
      errors.push(issue("error", "possession_intent_conflict", `${prefix}: non-possessing team cannot have an attacking intent`));
    }
    if ((teamAPossession && teamAIntent && DEFENSE_INTENTS.has(teamAIntent)) || (teamBPossession && teamBIntent && DEFENSE_INTENTS.has(teamBIntent))) {
      errors.push(issue("error", "possession_intent_conflict", `${prefix}: possessing team cannot have a defensive intent`));
    }
    if ((teamAIntent === "CounterAttack" || teamBIntent === "CounterAttack") && ann?.game_state?.set_piece) {
      errors.push(issue("error", "counterattack_setpiece_conflict", `${prefix}: CounterAttack cannot be combined with set-piece mode`));
    }
    if ((teamAIntent && SET_PIECE_INTENTS.has(teamAIntent)) || (teamBIntent && SET_PIECE_INTENTS.has(teamBIntent))) {
      if (ann?.game_state?.set_piece !== true) {
        errors.push(issue("error", "setpiece_state_missing", `${prefix}: set-piece intent requires set_piece=true`));
      }
    }

    const coverage = asFiniteNumber(ann?.segment_metadata?.coverage_estimate);
    if (coverage === null || coverage < 0 || coverage > 1) {
      errors.push(issue("error", "invalid_coverage", `${prefix}: coverage_estimate must be between 0 and 1`));
    } else if (coverage < 0.8) {
      errors.push(issue("error", "coverage_too_low", `${prefix}: coverage_estimate is below 0.80`));
    } else if (coverage < 0.85) {
      warnings.push(issue("warning", "coverage_near_threshold", `${prefix}: coverage is near the rejection threshold`));
    }

    const split = ann?.model_split?.assigned_split ?? "train";
    if (!SPLITS.has(split) || split === "excluded") {
      errors.push(issue("error", "invalid_model_split", `${prefix}: non-excluded split must be train, val, or test`));
    }

    const npzPath = ann?.reconstruction?.npz_path;
    if (typeof npzPath !== "string" || npzPath.length === 0) {
      errors.push(issue("error", "missing_npz_path", `${prefix}: non-excluded segment needs an npz_path`));
    } else {
      if (seenNpz.has(npzPath)) {
        errors.push(
          issue("error", "duplicate_npz_path", `${prefix}: duplicate npz_path already used by ${seenNpz.get(npzPath)}`),
        );
      } else {
        seenNpz.set(npzPath, prefix);
      }
      if (options.requireNpz && !npzExists(npzPath, options.cwd)) {
        errors.push(
          issue(
            "error",
            "missing_npz_file",
            `${prefix}: NPZ file does not exist: ${npzPath}`,
            "reconstruction.npz_path",
            "Run the tracking/trajectory pipeline before training export.",
          ),
        );
      }
    }
  }
}

function validateContiguity(annotations: any[], errors: ValidationIssue[]) {
  const sorted = [...annotations].sort((a, b) => {
    const halfA = String(a?.half ?? "");
    const halfB = String(b?.half ?? "");
    if (halfA !== halfB) return halfA.localeCompare(halfB);
    return (segmentTimes(a).start ?? 0) - (segmentTimes(b).start ?? 0);
  });

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (String(current?.half ?? "") !== String(next?.half ?? "")) continue;
    const currentTimes = segmentTimes(current);
    const nextTimes = segmentTimes(next);
    if (currentTimes.end === null || nextTimes.start === null) continue;
    const deltaMs = Math.round((nextTimes.start - currentTimes.end) * 1000);
    if (deltaMs !== 0) {
      errors.push(
        issue(
          "error",
          deltaMs > 0 ? "timeline_gap" : "timeline_overlap",
          `${current?.clip_id ?? "segment"} -> ${next?.clip_id ?? "segment"} has ${deltaMs > 0 ? "gap" : "overlap"} of ${Math.abs(deltaMs)}ms`,
          "annotations",
          "Repair segment boundaries in the annotator before export.",
        ),
      );
    }
  }
}

export function validateAnnotationSession(
  annotations: any[],
  options: AnnotationValidationOptions = {},
): ValidationReport {
  const requiredOptions: Required<AnnotationValidationOptions> = {
    cwd: options.cwd ?? process.cwd(),
    requireNpz: options.requireNpz ?? false,
    requireContiguous: options.requireContiguous ?? false,
    requireReviewConfirmation: options.requireReviewConfirmation ?? false,
  };
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!Array.isArray(annotations)) {
    errors.push(issue("error", "invalid_annotations", "annotations must be an array", "annotations"));
    return { ok: false, errors, warnings };
  }
  if (annotations.length === 0) {
    errors.push(issue("error", "empty_annotations", "No annotations to validate", "annotations"));
    return { ok: false, errors, warnings };
  }

  const seenIds = new Set<string>();
  const seenNpz = new Map<string, string>();
  annotations.forEach((ann, index) =>
    validateOneAnnotation(ann, index, requiredOptions, seenIds, seenNpz, errors, warnings),
  );

  if (requiredOptions.requireContiguous) validateContiguity(annotations, errors);
  if (requiredOptions.requireReviewConfirmation) {
    for (const warning of warnings) {
      if (warning.code === "review_required") {
        errors.push(
          issue(
            "error",
            "review_required",
            warning.message,
            warning.path,
            "Resolve or explicitly adjudicate the warning before training export.",
          ),
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function flattenIssues(report: ValidationReport): string[] {
  return [...report.errors, ...report.warnings].map((entry) =>
    entry.suggestion ? `${entry.message} Suggestion: ${entry.suggestion}` : entry.message,
  );
}
