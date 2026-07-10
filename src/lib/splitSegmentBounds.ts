/**
 * splitSegmentBounds.ts
 *
 * Utility for splitting long segments into contiguous chunks that respect
 * the MIN_SEGMENT_DURATION and MAX_SEGMENT_DURATION bounds.
 *
 * Used by the annotator to auto-split segments > 15s at submit time.
 */

import { MAX_SEGMENT_DURATION, MIN_SEGMENT_DURATION } from "@/lib/constants";

const MAX_MS = MAX_SEGMENT_DURATION * 1000; // 15000
const MIN_MS = MIN_SEGMENT_DURATION * 1000; // 2000

export interface SegmentBound {
  start: number; // ms
  end: number; // ms
}

/**
 * Splits a time range [startMs, endMs] into contiguous chunks where each
 * chunk is between MIN_MS and MAX_MS in duration.
 *
 * Algorithm:
 * - If total <= MAX_MS, return as single chunk
 * - If total > MAX_MS, split into MAX_MS-sized chunks
 * - If a remainder is < MIN_MS, absorb it into the previous chunk
 * - If a remainder is between MIN_MS and MAX_MS, keep as separate chunk
 *
 * @throws Error if the total duration is < MIN_MS
 */
export function splitSegmentBounds(
  startMs: number,
  endMs: number,
): SegmentBound[] {
  const total = endMs - startMs;

  if (total < MIN_MS) {
    throw new Error(`Segment too short: ${total}ms < ${MIN_MS}ms minimum`);
  }

  if (total <= MAX_MS) {
    return [{ start: startMs, end: endMs }];
  }

  const chunks: SegmentBound[] = [];
  let currentStart = startMs;

  while (currentStart < endMs) {
    const remaining = endMs - currentStart;

    if (remaining <= MAX_MS && remaining >= MIN_MS) {
      // Fits perfectly as final chunk
      chunks.push({ start: currentStart, end: endMs });
      break;
    }

    if (remaining < MIN_MS) {
      // Too short — extend previous chunk to absorb
      if (chunks.length === 0) {
        throw new Error(
          `Segment too short: ${remaining}ms < ${MIN_MS}ms minimum`,
        );
      }
      chunks[chunks.length - 1].end = endMs;
      break;
    }

    if (remaining <= MAX_MS + MIN_MS) {
      // Split so remainder is exactly MIN_MS
      const firstChunk = remaining - MIN_MS;
      chunks.push({
        start: currentStart,
        end: currentStart + firstChunk,
      });
      chunks.push({
        start: currentStart + firstChunk,
        end: endMs,
      });
      break;
    }

    // Standard MAX_MS chunk
    chunks.push({
      start: currentStart,
      end: currentStart + MAX_MS,
    });
    currentStart += MAX_MS;
  }

  // Validate all chunks
  for (const chunk of chunks) {
    const dur = chunk.end - chunk.start;
    if (dur < MIN_MS || dur > MAX_MS) {
      throw new Error(
        `Invalid chunk duration: ${dur}ms (chunk ${chunk.start}-${chunk.end})`,
      );
    }
  }

  return chunks;
}

/**
 * Formats chunk boundaries into a human-readable summary.
 */
export function formatChunks(chunks: SegmentBound[]): string {
  return chunks
    .map(
      (c, i) =>
        `Chunk ${i + 1}: ${(c.start / 1000).toFixed(1)}s - ${(c.end / 1000).toFixed(1)}s (${((c.end - c.start) / 1000).toFixed(1)}s)`,
    )
    .join("\n");
}
