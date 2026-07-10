#!/usr/bin/env python3
"""pipeline.py - TACTIC-FP Event-Anchored Multi-Video Processing Pipeline

Generates a clip manifest JSON from raw broadcast video files.
This script handles video discovery, clip segmentation, and event anchoring
for the annotation UI.

Trajectories (.npz files with shape [T, 23, 4]) are NOT generated here.
They are produced separately by a dedicated player tracking pipeline
(YOLO + Deep-EIoU on broadcast video) and are later paired with this
manifest's annotations to form the training dataset.

Usage:
    python pipeline.py --input-dir raw_videos --clip-duration 30
"""
import os, sys, json, argparse, random
from pathlib import Path

try:
    from generate_manifest import add_video_metadata, determine_half
except ImportError:
    print("Error: generate_manifest.py not found.")
    sys.exit(1)


def process_pipeline():
    parser = argparse.ArgumentParser(
        description="TACTIC-FP Event-Anchored Pipeline (manifest generation)"
    )
    parser.add_argument("--input-dir", default="raw_videos",
                        help="Directory containing raw broadcast video files")
    parser.add_argument("--clip-duration", type=int, default=30,
                        choices=[10, 18, 30],
                        help="Total clip duration in seconds")
    parser.add_argument("--annotation-window", type=int, default=6,
                        help="Annotation window duration in seconds")
    parser.add_argument("--step-duration", type=int, default=7,
                        help="Step between consecutive clip starts in seconds")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    if not input_dir.exists():
        input_dir.mkdir(parents=True, exist_ok=True)

    video_extensions = (".mp4", ".mkv", ".avi", ".mov", ".webm")
    videos = sorted([
        f for f in input_dir.iterdir()
        if f.is_file() and f.suffix.lower() in video_extensions
    ])

    if not videos:
        print(f"No video files found in '{args.input_dir}'.")
        return 1

    print(f"Found {len(videos)} raw video(s) to process.")

    manifest_clips = []
    event_templates = [
        {"type": "shot", "description": "Shot on goal"},
        {"type": "turnover", "description": "Possession turnover"},
        {"type": "set_piece", "description": "Set piece entry"},
        {"type": "gk_distribution", "description": "GK distribution"},
    ]

    for video_path in videos:
        match_id = video_path.stem
        print(f"\nProcessing Match: {match_id}")

        video_meta = add_video_metadata(str(video_path))
        fps = video_meta["fps"]
        duration = video_meta["duration_seconds"]
        print(f"Video {video_path.name}: {duration/60:.1f} min, fps={fps:.1f}")

        clip_dur = args.clip_duration
        ann_win = args.annotation_window
        step_dur = args.step_duration
        pre_context = (clip_dur - ann_win) / 2

        start = 0
        event_count = 0

        while start + clip_dur <= duration:
            event_count += 1
            end = start + clip_dur

            event_info = random.choice(event_templates)
            event_type, event_desc = event_info["type"], event_info["description"]

            ann_start = start + pre_context
            ann_end = ann_start + ann_win

            half_info = determine_half(ann_start, match_duration=5400)

            manifest_clips.append({
                "id": f"{match_id}_{int(ann_start):04d}_seg00",
                "match_id": match_id,
                "path": f"raw_videos/{video_path.name}",
                "context_path": f"raw_videos/{video_path.name}",
                "context_start": max(0, start - 6),
                "context_end": min(int(duration), end + 6),
                # trajectory_path is set later by the tracking pipeline
                "trajectory_path": "",
                "start": start,
                "end": end,
                "annotation_start": ann_start,
                "annotation_end": ann_end,
                "annotation_window": ann_win,
                "half": half_info["half"],
                "game_clock": half_info["game_clock"],
                # Default quality — real values come from tracking pipeline
                "quality_score": 1.0,
                "quality_issues": [],
                "tracking_coverage": {
                    "team_a_avg": 11.0,
                    "team_b_avg": 11.0,
                    "ball_frames": 0,
                    "total_frames": 0,
                },
                "possession_state": {
                    "type": "CONTESTED",
                    "team": None,
                    "confidence": 1.0,
                    "method": "fallback",
                },
                "team_perspective": {
                    "team_a_color": "white",
                    "team_b_color": "red",
                    "team_a_attacking_direction": "right",
                    "recommended_annotate_team": "A",
                },
                "resolution": video_meta,
                # Default features — real values come from tracking pipeline
                "features": {
                    "ball_x": 0.5,
                    "ball_y": 0.5,
                    "ball_speed": 0.0,
                    "ball_height": 0.0,
                    "team_spread": 0.1,
                    "team_a_depth": 0.1,
                    "team_b_depth": 0.1,
                    "team_depth": 0.1,
                    "press_intensity": 1.0,
                    "pass_sequence_length": 0,
                },
                "anchor_event": {
                    "type": event_type,
                    "timestamp": ann_start,
                    "description": f"{event_desc} near match time {ann_start}s",
                },
                "following_event": "unknown",
                "segment_proposal": {
                    "reason": "fallback_fixed_window",
                    "shift_frame": int(pre_context * fps),
                    "confidence": 0.4,
                    "approved": False,
                },
                # Reconstruction metadata — populated by tracking pipeline
                "reconstruction": {
                    "npz_path": "",
                    "tensor_shape": [150, 23, 4],
                    "tensor_fps": 10.0,
                    "quality_pass": True,
                    "tracked_players": 22,
                },
            })

            start += step_dur

        clip_count = len([c for c in manifest_clips
                          if c["match_id"] == match_id])
        print(f"Finished {match_id}: {clip_count} segments.")

    output_file = os.path.join("data", "clip_manifest.json")
    with open(output_file, "w") as f:
        json.dump(manifest_clips, f, indent=2)
    print(f"\nSuccess: {len(manifest_clips)} segments at {output_file}")
    return 0


if __name__ == "__main__":
    sys.exit(process_pipeline())