"use client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { sanitizeMatchId } from "./tensor-utils";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatSec(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const t = Math.floor((seconds * 10) % 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${t}`;
}

export function formatMatchClock(half: number, seconds: number): string {
  const halfLabel = half === 1 ? "H1" : "H2";
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${halfLabel} ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatSecWithHalf(half: number, seconds: number): string {
  const halfLabel = half === 1 ? "H1" : half === 2 ? "H2" : `H${half}`;
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const t = Math.floor((seconds * 10) % 10);
  return `${halfLabel} ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
}

export function normalizeClip(raw: any) {
  const start = raw.start ?? 0;
  const end = raw.end ?? 18;
  const clipDur = end - start;
  const annWin = raw.annotation_window ?? 10;
  const preCtx = (clipDur - annWin) / 2;
  return {
    clip_id: raw.clip_id || raw.id || `clip_${raw.start}_${raw.end}`,
    match_id: sanitizeMatchId(raw.match_id || raw.match_name || "match_001"),
    path: raw.path || "",
    start,
    end,
    annotation_start: raw.annotation_start ?? start + preCtx,
    annotation_end: raw.annotation_end ?? start + preCtx + annWin,
    annotation_window: annWin,
    half: raw.half ?? 1,
    game_clock: raw.game_clock,
    window_idx: raw.window_idx,
    match_name: raw.match_name,
    competition: raw.competition,
    season: raw.season,
    trajectory_path: raw.trajectory_path,
    anchor_event: raw.anchor_event,
    possession_state: raw.possession_state,
    team_perspective: raw.team_perspective,
    resolution: raw.resolution,
    features: raw.features,
  };
}
