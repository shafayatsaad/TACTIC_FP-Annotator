// Pure computation utilities shared between client and server.
// NO "use client" directive — this file is safe for server-side imports.

export const MODEL_FPS = 10;
export const MAX_MODEL_FRAMES = 150;

export function computeTensorFrames(
  durationSec: number,
  fps: number = MODEL_FPS,
): number {
  return Math.round(durationSec * fps);
}

export function computePaddingMask(
  actualFrames: number,
  maxFrames: number = MAX_MODEL_FRAMES,
): number[] {
  return Array.from({ length: maxFrames }, (_, i) =>
    i < actualFrames ? 1 : 0,
  );
}

export function computeTensorShape(
  durationSec: number,
  fps: number = MODEL_FPS,
): [number, number, number] {
  const frames = computeTensorFrames(durationSec, fps);
  return [frames, 23, 4];
}

export function sanitizeMatchId(input?: string | null): string {
  if (!input) return "match_001";
  
  // 1. Extract base filename if a full path was passed
  let stem = input.split(/[/\\]/).pop() || input;
  
  // 2. Strip standard file extensions
  stem = stem.replace(/\.[a-zA-Z0-9]+$/g, "");
  
  // 3. Strip quality, resolution, conversion, and half tags iteratively
  const tagRegex = /_(720p|1080p|480p|4k|fhd|hd|sd|converted|raw|h264|h265|avc|fp10|h1|h2|1st|2nd)$/i;
  while (tagRegex.test(stem)) {
    stem = stem.replace(tagRegex, "");
  }

  // 4. Sanitize remaining characters
  let clean = stem
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!clean || clean.toLowerCase() === "manual" || clean.toLowerCase() === "unknown") {
    return "match_001";
  }

  // 5. Ensure match_ prefix for clean model training identifier formatting
  if (!/^match[_-]/i.test(clean)) {
    return `match_${clean}`;
  }

  return clean;
}

export function generateNpzPath(matchId: string, clipId: string): string {
  const safeMatch = sanitizeMatchId(matchId);
  const safeClip = clipId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `data/trajectories/${safeMatch}/${safeClip}.npz`;
}

export function generateClipId(
  matchId: string,
  half: number,
  startSec: number,
  suffix?: string,
): string {
  const safeMatch = sanitizeMatchId(matchId);
  const safeHalf = Number.isFinite(Number(half))
    ? Math.max(1, Math.trunc(Number(half)))
    : 1;
  const startDecisecond = Math.max(0, Math.round(Number(startSec || 0) * 10));
  const base = `${safeMatch}_h${safeHalf}_${startDecisecond
    .toString()
    .padStart(5, "0")}`;
  const safeSuffix = suffix
    ?.trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safeSuffix ? `${base}_${safeSuffix}` : base;
}
