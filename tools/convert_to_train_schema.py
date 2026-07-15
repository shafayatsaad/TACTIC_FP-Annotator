#!/usr/bin/env python3
"""
convert_to_train_schema.py

Converts TACTIC-FP annotator-format JSON exports to the minimal training schema.

Paper compliance (§3.1, §3.4, §4.1, §6.3.1):
  1. Quantize all timestamps to 100 ms (10 fps grid)
  2. duration_ms = tensor_shape[0] × 100
  3. end_ms = start_ms + duration_ms
  4. Strip all non-training fields (audit, UI, match metadata, non-primary team)
  5. Flatten to `primary_team` (one intent per segment)
  6. Move `model_split` to match root
  7. Run §6.3.1 validation gates before writing

Usage:
    python tools/convert_to_train_schema.py --input <path> [--output <path>]
    python tools/convert_to_train_schema.py --input-dir <dir> [--output-dir <dir>]

Examples:
    python tools/convert_to_train_schema.py -i annotated_match.json -o match_TRAIN.json
    python tools/convert_to_train_schema.py -i ./exports/ -o ./train_exports/
"""

import os, sys, json, argparse
from pathlib import Path

MODEL_FPS = 10
MAX_MODEL_FRAMES = 150


def quantize_ms(ms: int) -> int:
    """Round a millisecond timestamp to the nearest 100 ms (10 fps grid)."""
    return round(ms / 100) * 100


def compute_padding_mask(actual_frames: int, max_frames: int = MAX_MODEL_FRAMES):
    """Return a list of 1s for actual_frames, then 0s for padding."""
    return [1 if i < actual_frames else 0 for i in range(max_frames)]


def compute_tensor_frames(duration_sec: float, fps: int = MODEL_FPS) -> int:
    """Compute number of tensor frames from duration in seconds."""
    return min(round(duration_sec * fps), MAX_MODEL_FRAMES)


def make_gap_segment(half: int, start_ms: int, end_ms: int, idx: int) -> dict:
    duration_ms = end_ms - start_ms
    tensor_frames = compute_tensor_frames(duration_ms / 1000)
    return {
        "segment_id": f"gap_fill_{half}_{start_ms}_{idx}",
        "start_ms": start_ms,
        "end_ms": end_ms,
        "duration_ms": duration_ms,
        "time_from_kickoff_ms": start_ms,
        "coverage_estimate": 0,
        "exclusion": "ContestedPlay",
        "primary_team": None,
        "reconstruction": {
            "npz_path": "",
            "tensor_shape": [tensor_frames, 23, 4],
            "tensor_fps": MODEL_FPS,
            "padding_mask": compute_padding_mask(tensor_frames),
        },
    }


def make_gap_segments(half: int, start_ms: int, end_ms: int) -> list:
    """Split a gap into valid ContestedPlay chunks no longer than 15s."""
    max_chunk_ms = MAX_MODEL_FRAMES * 100
    segments = []
    cursor = start_ms
    idx = 0

    while end_ms - cursor > max_chunk_ms:
        next_end = cursor + max_chunk_ms
        remainder = end_ms - next_end
        if 0 < remainder < 2000:
            next_end = end_ms - 2000
        segments.append(make_gap_segment(half, cursor, next_end, idx))
        cursor = next_end
        idx += 1

    if end_ms > cursor:
        segments.append(make_gap_segment(half, cursor, end_ms, idx))

    return segments


def validate_train_export(train_data: dict) -> list:
    """§6.3.1 validation gates. Returns list of error strings (empty = pass)."""
    errors = []

    for half in train_data.get("halves", []):
        segs = half.get("segments", [])
        for i, seg in enumerate(segs):
            prefix = f'Half {half["half"]}, segment "{seg.get("segment_id", "?")}"'

            # Gate 1 — Quantization: all timestamps must be multiples of 100
            if seg.get("start_ms", 0) % 100 != 0:
                errors.append(f"{prefix}: start_ms ({seg['start_ms']}) not multiple of 100")
            if seg.get("end_ms", 0) % 100 != 0:
                errors.append(f"{prefix}: end_ms ({seg['end_ms']}) not multiple of 100")
            if seg.get("duration_ms", 0) % 100 != 0:
                errors.append(f"{prefix}: duration_ms ({seg['duration_ms']}) not multiple of 100")

            # Gate 2 — Tensor alignment: duration_ms === tensor_shape[0] × 100
            if not seg.get("exclusion") and not seg.get("primary_team", {}).get("intent_class"):
                errors.append(f"{prefix}: non-excluded segment has no primary intent")

            tensor_frames = seg.get("reconstruction", {}).get("tensor_shape", [0])[0] or 0
            expected_dur = tensor_frames * 100
            if seg.get("duration_ms", 0) != expected_dur:
                errors.append(
                    f"{prefix}: duration_ms ({seg['duration_ms']}) ≠ "
                    f"tensor_shape[0]×100 ({expected_dur})"
                )

            # Gate 2b — end_ms === start_ms + duration_ms
            expected_end = seg["start_ms"] + seg["duration_ms"]
            if seg.get("end_ms", 0) != expected_end:
                errors.append(
                    f"{prefix}: end_ms ({seg['end_ms']}) ≠ "
                    f"start_ms + duration_ms ({expected_end})"
                )

            # Gate 3 — Contiguity: segment[n].end_ms === segment[n+1].start_ms
            if i < len(segs) - 1:
                nxt = segs[i + 1]
                if seg["end_ms"] != nxt["start_ms"]:
                    errors.append(
                        f"{prefix}: end_ms ({seg['end_ms']}) ≠ "
                        f"next start_ms ({nxt['start_ms']}) "
                        f"— gap of {nxt['start_ms'] - seg['end_ms']} ms"
                    )

        # Gate 4 — No orphans: no segment fully contains another
        for i in range(len(segs)):
            for j in range(len(segs)):
                if i == j:
                    continue
                a, b = segs[i], segs[j]
                if (
                    a["start_ms"] <= b["start_ms"]
                    and a["end_ms"] >= b["end_ms"]
                    and (a["start_ms"] < b["start_ms"] or a["end_ms"] > b["end_ms"])
                ):
                    errors.append(
                        f'Half {half["half"]}: segment "{a["segment_id"]}" '
                        f'[{a["start_ms"]}–{a["end_ms"]}] fully contains '
                        f'"{b["segment_id"]}" [{b["start_ms"]}–{b["end_ms"]}]'
                    )
                    break

    return errors


def convert_to_train_schema(input_data: dict) -> dict:
    """
    Convert an annotator-format JSON dict to the minimal training schema.
    """
    train_halves = []

    for half in input_data.get("halves", []):
        segments = list(half.get("segments", []))

        # Sort by start_ms
        segments.sort(key=lambda s: s.get("start_ms", 0))

        train_segments = []

        for seg in segments:
            # Quantize start to 100 ms grid
            start_ms = quantize_ms(seg.get("start_ms", 0))

            # Tensor frames from reconstruction
            tensor_frames = (
                seg.get("reconstruction", {}).get("tensor_shape", [0])[0] or 0
            )

            # Duration derived from tensor shape: tensor_shape[0] × 100 (§6.3.1 Gate #4)
            duration_ms = tensor_frames * 100

            # End derived: start_ms + duration_ms
            end_ms = start_ms + duration_ms

            # Rebuild padding mask
            padding_mask = compute_padding_mask(tensor_frames)

            # Resolve primary team
            # The annotator schema has team_home / team_away blocks.
            # Find the one with is_primary == true.
            primary_team = None
            existing_primary_team = seg.get("primary_team")
            if isinstance(existing_primary_team, dict):
                primary_team = {
                    "label": {
                        "intent_class": existing_primary_team.get("intent_class"),
                        "confidence": existing_primary_team.get("confidence", 0),
                    },
                    "is_primary": existing_primary_team.get("is_primary") is not False,
                    "possession": existing_primary_team.get("possession", False),
                }
            for team_key in ("team_home", "team_away"):
                if primary_team is not None:
                    break
                team = seg.get(team_key)
                if team and team.get("is_primary") is True:
                    primary_team = team
                    break
            # Fallback: if no explicit primary, check `team` block (newer schema)
            if primary_team is None:
                team_block = seg.get("team")
                if team_block and team_block.get("is_primary") is True:
                    primary_team = team_block

            exclusion = seg.get("exclusion")

            # Build minimal segment
            train_seg = {
                "segment_id": seg.get("segment_id", "unknown"),
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_ms": duration_ms,
                "time_from_kickoff_ms": start_ms,
                "coverage_estimate": 0 if exclusion else seg.get("coverage_estimate", 0),
                "exclusion": exclusion or None,
                "reconstruction": {
                    "npz_path": "" if exclusion else seg.get("reconstruction", {}).get("npz_path", ""),
                    "tensor_shape": [tensor_frames, 23, 4],
                    "tensor_fps": MODEL_FPS,
                    "padding_mask": padding_mask,
                },
            }

            # Exclusions: primary_team is null (dataloader skips these)
            # Non-exclusions: include the primary team block
            if exclusion:
                train_seg["primary_team"] = None
            elif primary_team:
                label = primary_team.get("label", {})
                train_seg["primary_team"] = {
                    "intent_class": label.get("intent_class"),
                    "confidence": label.get("confidence", 0),
                    "is_primary": True,
                    "possession": primary_team.get("possession", False),
                }

            train_segments.append(train_seg)

        # Sort final segments
        train_segments.sort(key=lambda s: s["start_ms"])

        # Gate 3 — Ensure contiguity: fill gaps if needed
        # Gaps < 2000ms are merged into the preceding segment.
        # Gaps >= 2000ms get a new exclusion segment (ContestedPlay) inserted.
        filled = []
        for i, seg in enumerate(train_segments):
            filled.append(seg)
            if i < len(train_segments) - 1:
                nxt = train_segments[i + 1]
                gap = nxt["start_ms"] - seg["end_ms"]
                if gap > 0 and gap < 2000:
                    # Merge gap into current segment by extending its end
                    seg["end_ms"] = nxt["start_ms"]
                    seg["duration_ms"] = seg["end_ms"] - seg["start_ms"]
                    # Recompute tensor metadata for the merged segment
                    tensor_frames = compute_tensor_frames(seg["duration_ms"] / 1000)
                    seg["reconstruction"] = {
                        "npz_path": seg["reconstruction"].get("npz_path", ""),
                        "tensor_shape": [tensor_frames, 23, 4],
                        "tensor_fps": MODEL_FPS,
                        "padding_mask": compute_padding_mask(tensor_frames),
                    }
                elif gap >= 2000:
                    filled.extend(
                        make_gap_segments(
                            half.get("half", 1),
                            seg["end_ms"],
                            nxt["start_ms"],
                        )
                    )

        train_halves.append(
            {
                "half": half.get("half", 1),
                "segments": filled,
            }
        )

    # Determine match-level model_split (§6.3 — match-level splitting)
    all_splits = set()
    for half in input_data.get("halves", []):
        for seg in half.get("segments", []):
            if not seg.get("exclusion"):
                split_val = seg.get("model_split", "train")
                all_splits.add(split_val)
    match_split = all_splits.pop() if len(all_splits) == 1 else (all_splits.pop() if all_splits else "train")

    output = {
        "match_id": input_data.get("match_id", "unknown"),
        "model_split": match_split,
        "halves": train_halves,
    }

    return output


def main():
    parser = argparse.ArgumentParser(
        description="Convert TACTIC-FP annotator JSON to minimal training schema"
    )
    parser.add_argument("-i", "--input", help="Input JSON file or directory")
    parser.add_argument("-o", "--output", help="Output JSON file or directory")
    args = parser.parse_args()

    if not args.input:
        parser.print_help()
        sys.exit(1)

    input_path = Path(args.input)
    if input_path.is_file():
        # Single file mode
        print(f"Reading: {input_path}")
        with open(input_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        train_data = convert_to_train_schema(data)

        # Validate
        errors = validate_train_export(train_data)
        if errors:
            print(f"ERROR: §6.3.1 validation failed with {len(errors)} gate failure(s):")
            for e in errors:
                print(f"  ✗ {e}")
            sys.exit(1)
        print(f"✓ Validation passed (0 gate failures)")

        output_path = args.output
        if not output_path:
            stem = input_path.stem
            if "_TRAIN" not in stem.upper():
                stem += "_TRAIN"
            output_path = input_path.with_name(f"{stem}.json")
        else:
            output_path = Path(args.output)

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(train_data, f, indent=2, ensure_ascii=False)

        seg_count = sum(len(h.get("segments", [])) for h in train_data.get("halves", []))
        print(f"✓ Wrote {seg_count} segment(s) to: {output_path}")
        print(f"  model_split: {train_data['model_split']}")

    elif input_path.is_dir():
        # Directory mode — batch process all JSON files
        output_dir = Path(args.output) if args.output else input_path / "train_exports"
        output_dir.mkdir(parents=True, exist_ok=True)

        json_files = sorted(input_path.glob("*.json"))
        if not json_files:
            print(f"No JSON files found in {input_path}")
            sys.exit(0)

        success, failed = 0, 0
        for jf in json_files:
            print(f"Processing: {jf.name} ... ", end="", flush=True)
            try:
                with open(jf, "r", encoding="utf-8") as f:
                    data = json.load(f)
                train_data = convert_to_train_schema(data)
                errors = validate_train_export(train_data)
                if errors:
                    print(f"FAILED ({len(errors)} validation errors)")
                    for e in errors:
                        print(f"    ✗ {e}")
                    failed += 1
                    continue
                stem = jf.stem
                if "_TRAIN" not in stem.upper():
                    stem += "_TRAIN"
                out_path = output_dir / f"{stem}.json"
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(train_data, f, indent=2, ensure_ascii=False)
                seg_count = sum(len(h.get("segments", [])) for h in train_data.get("halves", []))
                print(f"✓ {seg_count} segments, split={train_data['model_split']}")
                success += 1
            except Exception as e:
                print(f"ERROR: {e}")
                failed += 1

        print(f"\nDone: {success} succeeded, {failed} failed — outputs in {output_dir}")
    else:
        print(f"Input not found: {input_path}")
        sys.exit(1)


if __name__ == "__main__":
    main()
