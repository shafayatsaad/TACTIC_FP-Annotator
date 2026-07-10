#!/usr/bin/env python3
"""pipeline.py - TACTIC-FP Event-Anchored Multi-Video Processing Pipeline

WARNING: This is a PLACEHOLDER trajectory generator for UI testing only.
         It generates synthetic sine-wave player motion, NOT real tracking data.
         
         To produce real trajectories for model training:
         1. Replace generate_mock_trajectory_with_event() with YOLOv11 + Deep-EIoU
         2. Process actual broadcast video files
         3. See README.md for integration instructions
         
         DO NOT use the output of this script for scientific results or model training.
"""
import os, sys, json, argparse, random
from pathlib import Path
import numpy as np

try:
    from generate_manifest import extract_enhanced_features, compute_clip_quality, detect_possession_state, detect_intent_shift_points, propose_segments_from_shifts, determine_half, add_video_metadata
except ImportError:
    print("Error: generate_manifest.py not found."); sys.exit(1)

def generate_mock_trajectory_with_event(T, event_type, fps=25.0):
    # Output shape: [T, 23, 4] where:
    #   channels 0-1: x,y position
    #   channels 2-3: dx,dy velocity
    # Channel 4 (ball height/speed) was unused by the model — removed.
    traj = np.zeros((T, 23, 4))
    t_arr = np.linspace(0, T / fps, T)
    traj[:, 0, 0] = 0.1 + 0.01 * np.sin(t_arr)
    traj[:, 0, 1] = 0.5 + 0.02 * np.cos(t_arr)
    for i in range(1, 11):
        base_x, base_y = 0.15 + (i % 3) * 0.1, 0.15 + (i // 3) * 0.2
        traj[:, i, 0] = base_x + 0.02 * np.sin(t_arr + i)
        traj[:, i, 1] = base_y + 0.03 * np.cos(t_arr + i)
    traj[:, 11, 0] = 0.9 + 0.01 * np.sin(t_arr)
    traj[:, 11, 1] = 0.5 + 0.02 * np.cos(t_arr)
    for i in range(12, 22):
        k = i - 12
        base_x, base_y = 0.55 + (k % 3) * 0.1, 0.15 + (k // 3) * 0.2
        traj[:, i, 0] = base_x + 0.02 * np.sin(t_arr + i)
        traj[:, i, 1] = base_y + 0.03 * np.cos(t_arr + i)
    # Ball behavior
    if event_type == "shot":
        carrier_idx, shoot_start = 5, max(0, T - 25)
        for t in range(shoot_start): traj[t, 22, 0] = traj[t, carrier_idx, 0] + 0.01 * np.sin(2 * t_arr[t]); traj[t, 22, 1] = traj[t, carrier_idx, 1] + 0.01 * np.cos(2 * t_arr[t])
        start_x, start_y = traj[shoot_start, 22, 0], traj[shoot_start, 22, 1]
        for t in range(shoot_start, T):
            alpha = (t - shoot_start) / (T - shoot_start)
            traj[t, 22, 0] = start_x + alpha * (0.98 - start_x); traj[t, 22, 1] = start_y + alpha * (0.5 - start_y)
    elif event_type == "turnover":
        switch_frame = max(0, T - 40)
        for t in range(switch_frame): traj[t, 22, 0] = traj[t, 5, 0] + 0.01 * np.sin(t_arr[t]); traj[t, 22, 1] = traj[t, 5, 1] + 0.01 * np.cos(t_arr[t])
        start_x, start_y = traj[switch_frame, 22, 0], traj[switch_frame, 22, 1]
        for t in range(switch_frame, T):
            alpha = (t - switch_frame) / (T - switch_frame)
            traj[t, 22, 0] = start_x + alpha * (traj[t, 15, 0] - start_x); traj[t, 22, 1] = start_y + alpha * (traj[t, 15, 1] - start_y)
    elif event_type == "set_piece":
        kick_frame = max(0, T - 50)
        for t in range(kick_frame): traj[t, 22, 0] = 0.98; traj[t, 22, 1] = 0.02
        for t in range(kick_frame, T):
            alpha = (t - kick_frame) / (T - kick_frame)
            traj[t, 22, 0] = 0.98 - alpha * 0.25; traj[t, 22, 1] = 0.02 + alpha * 0.38
    elif event_type == "gk_distribution":
        kick_frame = max(0, T - 60)
        for t in range(kick_frame): traj[t, 22, 0] = traj[t, 0, 0]; traj[t, 22, 1] = traj[t, 0, 1]
        for t in range(kick_frame, T):
            alpha = (t - kick_frame) / (T - kick_frame)
            traj[t, 22, 0] = 0.08 + alpha * 0.5; traj[t, 22, 1] = 0.5 + alpha * 0.1
    else:
        for t in range(T): traj[t, 22, 0] = traj[t, 5, 0] + 0.01 * np.sin(2 * t_arr[t]); traj[t, 22, 1] = traj[t, 5, 1] + 0.01 * np.cos(2 * t_arr[t])
    traj[1:, :, 2:4] = (traj[1:, :, :2] - traj[:-1, :, :2]) * fps
    traj[0, :, 2:4] = traj[1, :, 2:4]
    return traj

def process_pipeline():
    parser = argparse.ArgumentParser(description="TACTIC-FP Event-Anchored Pipeline (PLACEHOLDER - uses mock sine-wave trajectories)")
    parser.add_argument("--input-dir", default="raw_videos")
    parser.add_argument("--clip-duration", type=int, default=30, choices=[10, 18, 30])
    parser.add_argument("--annotation-window", type=int, default=6)
    parser.add_argument("--step-duration", type=int, default=7)
    parser.add_argument("--no-trajectories", action="store_true")
    args = parser.parse_args()
    input_dir = Path(args.input_dir)
    if not input_dir.exists(): input_dir.mkdir(parents=True, exist_ok=True)
    video_extensions = (".mp4", ".mkv", ".avi", ".mov", ".webm")
    videos = sorted([f for f in input_dir.iterdir() if f.is_file() and f.suffix.lower() in video_extensions])
    if not videos: print(f"No video files found in \'{args.input_dir}\'."); return 1
    print(f"Found {len(videos)} raw video(s) to process.")
    Path("data/trajectories").mkdir(parents=True, exist_ok=True)
    manifest_clips = []
    event_templates = [{"type": "shot", "description": "Shot on goal"}, {"type": "turnover", "description": "Possession turnover"}, {"type": "set_piece", "description": "Set piece entry"}, {"type": "gk_distribution", "description": "GK distribution"}]
    for video_path in videos:
        match_id = video_path.stem
        print(f"\nProcessing Match: {match_id}")
        video_meta = add_video_metadata(str(video_path))
        fps, duration = video_meta["fps"], video_meta["duration_seconds"]
        print(f"Video {video_path.name}: {duration/60:.1f} min, fps={fps:.1f}")
        match_traj_dir = Path("data/trajectories") / match_id
        if not args.no_trajectories: match_traj_dir.mkdir(parents=True, exist_ok=True)
        clip_dur, ann_win, step_dur = args.clip_duration, args.annotation_window, args.step_duration
        pre_context = (clip_dur - ann_win) / 2
        start, event_count = 0, 0
        while start + clip_dur <= duration:
            event_count += 1; end = start + clip_dur
            event_info = random.choice(event_templates)
            event_type, event_desc = event_info["type"], event_info["description"]
            traj_name = f"{match_id}_{int(start):04d}_{int(end):04d}.npz"
            traj_rel_path = f"data/trajectories/{match_id}/{traj_name}"
            if not args.no_trajectories:
                T = int((end - start) * fps)
                traj = generate_mock_trajectory_with_event(T, event_type, fps=fps)
                # Save exact frame range as .npz — tensor_shape[0] == T
                np.savez(match_traj_dir / traj_name, trajectory=traj)
                features = extract_enhanced_features(traj)
                quality_gate = compute_clip_quality(traj)
                possession_state = detect_possession_state(traj)
            else:
                features = {"ball_x": 0.5, "ball_y": 0.5, "ball_speed": 0.0, "team_spread": 0.1, "team_a_depth": 0.1, "team_b_depth": 0.1, "team_depth": 0.1, "press_intensity": 1.0, "pass_sequence_length": 0, "ball_height": 0.0}
                quality_gate = {"quality_score": 1.0, "quality_issues": [], "tracking_coverage": {"team_a_avg": 11.0, "team_b_avg": 11.0, "ball_frames": 250, "total_frames": 250}}
                possession_state = {"type": "CONTESTED", "team": None, "confidence": 1.0, "method": "fallback"}
            if not args.no_trajectories:
                shift_points = detect_intent_shift_points(traj, fps=fps)
                segment_windows = propose_segments_from_shifts(shift_points, start, end, fps=fps)
            else:
                ann_start, ann_end = start + pre_context, start + pre_context + ann_win
                segment_windows = [{"start": start, "end": end, "annotation_start": ann_start, "annotation_end": ann_end, "annotation_window": ann_win, "segment_proposal": {"reason": "fallback_fixed_window", "shift_frame": int(pre_context * fps), "confidence": 0.4, "approved": False}}]
            for seg_idx, seg in enumerate(segment_windows):
                half_info = determine_half(seg["annotation_start"], match_duration=5400)
                tensor_shape = list(traj.shape) if not args.no_trajectories else [150, 23, 4]
                tensor_fps = 10.0  # model operating fps (not source video fps)
                manifest_clips.append({
                    "id": f"{match_id}_{int(seg['annotation_start']):04d}_seg{seg_idx:02d}", "match_id": match_id, "path": f"raw_videos/{video_path.name}",
                    "context_path": f"raw_videos/{video_path.name}", "context_start": max(0, seg["start"] - 6), "context_end": min(int(duration), seg["end"] + 6),
                    "trajectory_path": traj_rel_path if not args.no_trajectories else "", "start": seg["start"], "end": seg["end"],
                    "annotation_start": seg["annotation_start"], "annotation_end": seg["annotation_end"], "annotation_window": seg["annotation_window"],
                    "half": half_info["half"], "game_clock": half_info["game_clock"],
                    "quality_score": quality_gate.get("quality_score", 1.0), "quality_issues": quality_gate.get("quality_issues", []),
                    "tracking_coverage": quality_gate.get("tracking_coverage", {}), "possession_state": possession_state,
                    "team_perspective": {"team_a_color": "white", "team_b_color": "red", "team_a_attacking_direction": "right", "recommended_annotate_team": "A"},
                    "resolution": video_meta, "features": features,
                    "anchor_event": {"type": event_type, "timestamp": seg["annotation_start"], "description": f"{event_desc} near match time {seg['annotation_start']}s"},
                    "following_event": "unknown",
                    "segment_proposal": seg["segment_proposal"],
                    # Reconstruction metadata — emitted alongside NPZ so JSON export
                    # can reference the exact tensor shape without re-opening the file.
                    "reconstruction": {
                        "npz_path": traj_rel_path if not args.no_trajectories else "",
                        "tensor_shape": tensor_shape,
                        "tensor_fps": tensor_fps,
                        "quality_pass": quality_gate.get("quality_score", 1.0) > 0.5,
                        "tracked_players": 22,
                    },
                })
            if segment_windows:
                last_end = max(seg["annotation_end"] for seg in segment_windows)
                start = max(start + 2.0, last_end + random.uniform(0.75, 2.5))
            else:
                start += step_dur
        print(f"Finished {match_id}: {len([c for c in manifest_clips if c['match_id'] == match_id])} segments.")
    output_file = os.path.join("data", "clip_manifest.json")
    with open(output_file, "w") as f: json.dump(manifest_clips, f, indent=2)
    print(f"\nSuccess: {len(manifest_clips)} segments at {output_file}")
    return 0

if __name__ == "__main__": sys.exit(process_pipeline())