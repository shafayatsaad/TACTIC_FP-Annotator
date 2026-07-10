#!/usr/bin/env python3
"""
Emergency JSON Repair Script for TACTIC-FP Annotator

Fixes the following issues in exported JSON datasets:
1. Removes 0ms segments (start_ms == end_ms)
2. Sets intent_class: null for all exclusion segments
3. Sets model_split: "excluded" for all exclusion segments
4. Strips fake dag_features from all segments
5. Adds previous_segment / next_segment links
6. Recalculates duration_ms = end_ms - start_ms
7. Recalculates tensor_shape[0] = round(duration_ms / 100 * 10) [fps=10]
8. Regenerates padding_mask to match actual frames

Usage:
    python tools/emergency_json_repair.py <input.json> [output.json]
    
    If output.json is not specified, appends "_REPAIRED" to the input filename.
"""

import json
import sys
import os
from pathlib import Path

MODEL_FPS = 10
MAX_FRAMES = 150


def repair_json(input_path: str, output_path: str | None = None) -> None:
    """Repair a TACTIC-FP exported JSON file."""
    
    if output_path is None:
        stem = Path(input_path).stem
        output_path = str(Path(input_path).parent / f"{stem}_REPAIRED.json")
    
    print(f"Reading: {input_path}")
    with open(input_path, "r") as f:
        data = json.load(f)
    
    # Collect all segments from all halves
    all_segments = []
    for half in data.get("halves", []):
        all_segments.extend(half.get("segments", []))
    
    original_count = len(all_segments)
    print(f"Found {original_count} segments across {len(data.get('halves', []))} half/halves.")
    
    # 1. Remove 0ms segments
    all_segments = [s for s in all_segments if s.get("duration_ms", 0) > 0 and s.get("end_ms", 0) > s.get("start_ms", 0)]
    removed_zero = original_count - len(all_segments)
    if removed_zero > 0:
        print(f"  Removed {removed_zero} zero-duration segment(s).")
    
    # 2. Sort by half, then start_ms
    all_segments.sort(key=lambda s: (s.get("half", 1), s.get("start_ms", 0)))
    
    # 3. Fix labels, splits, and links
    for i, seg in enumerate(all_segments):
        # Remove dag_features if present
        if "dag_features" in seg:
            del seg["dag_features"]
            if i == 0:
                print("  Stripped dag_features from all segments.")
        
        # Add segment linking
        seg["previous_segment"] = all_segments[i - 1].get("segment_id") if i > 0 else None
        seg["next_segment"] = all_segments[i + 1].get("segment_id") if i < len(all_segments) - 1 else None
        
        # Fix exclusion labels and split
        is_exclusion = seg.get("exclusion") is not None and seg.get("exclusion") != ""
        
        if is_exclusion:
            # Fix team_home label
            if "team_home" in seg and "label" in seg["team_home"]:
                seg["team_home"]["label"] = {
                    "intent_class": None,
                    "confidence": None,
                    "certainty": None
                }
            # Fix team_away label
            if "team_away" in seg and "label" in seg["team_away"]:
                seg["team_away"]["label"] = {
                    "intent_class": None,
                    "confidence": None,
                    "certainty": None
                }
            # Fix model_split
            seg["model_split"] = "excluded"
        
        # Recalculate duration and tensor metadata
        start_ms = seg.get("start_ms", 0)
        end_ms = seg.get("end_ms", 0)
        duration_sec = (end_ms - start_ms) / 1000.0
        frames = min(int(round(duration_sec * MODEL_FPS)), MAX_FRAMES)
        seg["duration_ms"] = int(duration_sec * 1000)
        
        # Fix reconstruction metadata
        if "reconstruction" in seg:
            seg["reconstruction"]["tensor_shape"] = [frames, 23, 4]
            seg["reconstruction"]["padding_mask"] = [1] * frames + [0] * (MAX_FRAMES - frames)
    
    # 4. Rebuild halves from fixed segments
    h1_segments = [s for s in all_segments if s.get("half") == 1]
    h2_segments = [s for s in all_segments if s.get("half") == 2]
    
    new_halves = []
    if h1_segments:
        new_halves.append({
            "half": 1,
            "video_source": data.get("halves", [{}])[0].get("video_source", "") if data.get("halves") else "",
            "duration_ms": max(s.get("end_ms", 0) for s in h1_segments) if h1_segments else 2700000,
            "score_at_end": data.get("halves", [{}])[0].get("score_at_end", "0-0") if data.get("halves") else "0-0",
            "segments": h1_segments
        })
    if h2_segments:
        new_halves.append({
            "half": 2,
            "video_source": data.get("halves", [{}])[1].get("video_source", "") if len(data.get("halves", [])) > 1 else "",
            "duration_ms": max(s.get("end_ms", 0) for s in h2_segments) if h2_segments else 2700000,
            "score_at_start": data.get("halves", [{}])[1].get("score_at_start", "0-0") if len(data.get("halves", [])) > 1 else "0-0",
            "score_at_end": data.get("halves", [{}])[1].get("score_at_end", "0-0") if len(data.get("halves", [])) > 1 else "0-0",
            "segments": h2_segments
        })
    
    data["halves"] = new_halves
    
    # Update match_metadata
    if "match_metadata" in data:
        data["match_metadata"]["total_segments"] = len(all_segments)
        data["match_metadata"]["half1_segments"] = len(h1_segments)
        data["match_metadata"]["half2_segments"] = len(h2_segments)
    
    # Write output
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"\nRepair complete:")
    print(f"  Input:  {input_path} ({original_count} segments)")
    print(f"  Output: {output_path} ({len(all_segments)} segments)")
    print(f"  Removed: {removed_zero} zero-duration segments")
    print(f"  Fixed: {len([s for s in all_segments if s.get('exclusion')])} exclusion segments (labels→null, split→excluded)")
    print(f"  Added: previous_segment/next_segment links to all segments")
    print(f"  Stripped: dag_features from all segments")
    print(f"  Recalculated: duration_ms, tensor_shape, padding_mask")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python tools/emergency_json_repair.py <input.json> [output.json]")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    if not os.path.exists(input_path):
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)
    
    repair_json(input_path, output_path)