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
 * Splits [startMs, endMs] forward on the timeline.
 *
 * Normal case:
 * - Emit 15s chunks from the segment start.
 * - Keep the final remainder when it is at least 2s.
 *
 * If the final remainder would be shorter than 2s, borrow time from the
 * previous chunk so the final chunk is valid. Example: 16s -> 14s + 2s.
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
  let cursor = startMs;

  while (endMs - cursor > MAX_MS) {
    chunks.push({ start: cursor, end: cursor + MAX_MS });
    cursor += MAX_MS;
  }

  const remainder = endMs - cursor;
  if (remainder > 0) {
    if (remainder < MIN_MS) {
      if (chunks.length === 0) {
        throw new Error(
          `Segment too short: ${remainder}ms < ${MIN_MS}ms minimum`,
        );
      }

      const previous = chunks[chunks.length - 1];
      const borrowMs = MIN_MS - remainder;
      if (previous.end - previous.start - borrowMs < MIN_MS) {
        throw new Error(
          `Cannot split ${total}ms into valid ${MIN_MS}-${MAX_MS}ms chunks`,
        );
      }

      previous.end -= borrowMs;
      cursor = previous.end;
    }

    chunks.push({ start: cursor, end: endMs });
  }

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
