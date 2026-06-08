#!/usr/bin/env python3
"""generate_manifest.py - Helper functions for TACTIC-FP pipeline"""
import cv2
import numpy as np
from pathlib import Path

def add_video_metadata(video_path: str):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened(): return {"width": 1280, "height": 720, "fps": 25.0, "total_frames": 25000, "duration_seconds": 1000.0, "tier": "hd"}
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
    duration = total_frames / fps if fps > 0 else 0
    cap.release()
    tier = "fhd" if height >= 1080 else "hd" if height >= 720 else "sd"
    return {"width": width, "height": height, "fps": round(fps, 1), "total_frames": total_frames, "duration_seconds": round(duration, 1), "tier": tier}

def extract_enhanced_features(trajectory: np.ndarray):
    T = trajectory.shape[0]
    ball_x = float(np.mean(trajectory[:, 22, 0])); ball_y = float(np.mean(trajectory[:, 22, 1]))
    ball_speed = float(np.mean(np.sqrt(trajectory[:, 22, 2]**2 + trajectory[:, 22, 3]**2)))
    # ball_height removed — model uses 4-channel input (x, y, dx, dy) only
    ball_height = 0.0
    team_a_x, team_a_y = trajectory[:, 0:11, 0], trajectory[:, 0:11, 1]
    team_b_x, team_b_y = trajectory[:, 11:22, 0], trajectory[:, 11:22, 1]
    team_spread = float(np.mean([np.std(team_a_x), np.std(team_a_y), np.std(team_b_x), np.std(team_b_y)]))
    team_a_depth = float(np.mean(team_a_x)); team_b_depth = float(np.mean(team_b_x))
    team_depth = abs(team_a_depth - team_b_depth)
    press_intensity = 1.0 / (1.0 + team_depth)
    ball_vx, ball_vy = trajectory[1:, 22, 2], trajectory[1:, 22, 3]
    vel_changes = np.sum(np.sqrt(ball_vx[1:]**2 + ball_vy[1:]**2) - np.sqrt(ball_vx[:-1]**2 + ball_vy[:-1]**2) > 0.01)
    return {
        "ball_x": round(ball_x, 4), "ball_y": round(ball_y, 4), "ball_speed": round(ball_speed, 4),
        "ball_height": round(ball_height, 4), "team_spread": round(team_spread, 4),
        "team_a_depth": round(team_a_depth, 4), "team_b_depth": round(team_b_depth, 4),
        "team_depth": round(team_depth, 4), "press_intensity": round(press_intensity, 4),
        "pass_sequence_length": int(vel_changes),
    }

def compute_clip_quality(trajectory: np.ndarray):
    T, N, F = trajectory.shape
    team_a_frames = np.sum(~np.all(trajectory[:, 0:11, :2] == 0, axis=(1, 2)))
    team_b_frames = np.sum(~np.all(trajectory[:, 11:22, :2] == 0, axis=(1, 2)))
    ball_frames = np.sum(~np.all(trajectory[:, 22, :2] == 0, axis=1))
    team_a_avg = team_a_frames / T * 11 if T > 0 else 0
    team_b_avg = team_b_frames / T * 11 if T > 0 else 0
    quality_score = min(1.0, (team_a_avg + team_b_avg) / 22.0)
    issues = []
    if team_a_avg < 8: issues.append(f"Team A tracking low: {team_a_avg:.1f}/11")
    if team_b_avg < 8: issues.append(f"Team B tracking low: {team_b_avg:.1f}/11")
    if ball_frames < T * 0.5: issues.append(f"Ball tracking low: {ball_frames}/{T}")
    return {"quality_score": round(quality_score, 4), "quality_issues": issues, "tracking_coverage": {"team_a_avg": round(team_a_avg, 2), "team_b_avg": round(team_b_avg, 2), "ball_frames": int(ball_frames), "total_frames": T}}

def detect_possession_state(trajectory: np.ndarray):
    ball_pos = trajectory[:, 22, :2]
    team_a_dist = np.mean(np.linalg.norm(trajectory[:, 0:11, :2] - ball_pos[:, None, :], axis=2))
    team_b_dist = np.mean(np.linalg.norm(trajectory[:, 11:22, :2] - ball_pos[:, None, :], axis=2))
    if team_a_dist < team_b_dist * 0.8: return {"type": "POSSESSION", "team": "A", "confidence": 0.8, "method": "proximity"}
    elif team_b_dist < team_a_dist * 0.8: return {"type": "POSSESSION", "team": "B", "confidence": 0.8, "method": "proximity"}
    else: return {"type": "CONTESTED", "team": None, "confidence": 0.5, "method": "proximity"}

def detect_intent_shift_points(trajectory: np.ndarray, fps: float = 25.0):
    """Find likely tactical intent shifts from trajectory-only heuristics."""
    T = trajectory.shape[0]
    if T < int(fps * 2): return []
    ball_pos = trajectory[:, 22, :2]
    team_a_dist = np.min(np.linalg.norm(trajectory[:, 0:11, :2] - ball_pos[:, None, :], axis=2), axis=1)
    team_b_dist = np.min(np.linalg.norm(trajectory[:, 11:22, :2] - ball_pos[:, None, :], axis=2), axis=1)
    possession = np.where(team_a_dist < team_b_dist * 0.92, 1, np.where(team_b_dist < team_a_dist * 0.92, -1, 0))
    ball_speed = np.linalg.norm(trajectory[:, 22, 2:4], axis=1)
    team_a_compact = np.std(trajectory[:, 0:11, 0], axis=1) + np.std(trajectory[:, 0:11, 1], axis=1)
    team_b_compact = np.std(trajectory[:, 11:22, 0], axis=1) + np.std(trajectory[:, 11:22, 1], axis=1)
    compactness = (team_a_compact + team_b_compact) / 2.0
    window = max(5, int(fps))
    shifts = []
    for frame in range(window, T - window, max(1, int(fps / 2))):
        before_pos = np.sign(np.sum(possession[frame - window:frame]))
        after_pos = np.sign(np.sum(possession[frame:frame + window]))
        if before_pos != 0 and after_pos != 0 and before_pos != after_pos:
            shifts.append({"frame": frame, "reason": "possession_change", "confidence": 0.9})
            continue
        compact_delta = abs(float(np.mean(compactness[frame:frame + window]) - np.mean(compactness[frame - window:frame])))
        if compact_delta > 0.025:
            shifts.append({"frame": frame, "reason": "formation_compactness_shift", "confidence": 0.65})
    deduped = []
    for shift in shifts:
      if not deduped or shift["frame"] - deduped[-1]["frame"] > int(fps * 2):
          deduped.append(shift)
      elif shift["confidence"] > deduped[-1]["confidence"]:
          deduped[-1] = shift
    return deduped

def propose_segments_from_shifts(shift_points, clip_start: float, clip_end: float, fps: float = 25.0):
    if not shift_points:
        mid = (clip_start + clip_end) / 2.0
        shift_points = [{"frame": int((mid - clip_start) * fps), "reason": "steady_state", "confidence": 0.5}]
    segments = []
    for idx, shift in enumerate(shift_points):
        anchor = clip_start + shift["frame"] / fps
        reason = shift["reason"]
        if reason == "possession_change":
            pre, post = 2.8, 3.8
        elif reason == "velocity_variance_spike":
            pre, post = 1.6, 3.2
        elif reason == "formation_compactness_shift":
            pre, post = 3.0, 4.8
        else:
            pre, post = 2.5, 3.5
        start = max(clip_start, anchor - pre)
        end = min(clip_end, anchor + post)
        if end - start < 2.0:
            end = min(clip_end, start + 2.0)
        if end - start > 15.0:
            end = start + 15.0
        if end - start >= 2.0:
            segments.append({
                "start": round(start, 3), "end": round(end, 3),
                "annotation_start": round(start, 3), "annotation_end": round(end, 3),
                "annotation_window": round(end - start, 3),
                "segment_proposal": {"reason": reason, "shift_frame": int(shift["frame"]), "confidence": round(float(shift.get("confidence", 0.5)), 3), "approved": False},
            })
    return segments

def determine_half(timestamp: float, match_duration: float = 5400):
    half_duration = match_duration / 2
    if timestamp < half_duration: half = 1; clock_seconds = timestamp
    else: half = 2; clock_seconds = timestamp - half_duration
    minutes, seconds = int(clock_seconds // 60), int(clock_seconds % 60)
    return {"half": half, "game_clock": f"{minutes:02d}:{seconds:02d}"}
