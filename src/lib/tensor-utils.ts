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
  suffix?: string,
): string {
  const safeMatch = String(matchId || "match")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeHalf = Number.isFinite(Number(half))
    ? Math.max(1, Math.trunc(Number(half)))
    : 1;
  const startDecisecond = Math.max(0, Math.round(Number(startSec || 0) * 10));
  const base = `${safeMatch || "match"}_h${safeHalf}_${startDecisecond
    .toString()
    .padStart(5, "0")}`;
  const safeSuffix = suffix
    ?.trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safeSuffix ? `${base}_${safeSuffix}` : base;
}
