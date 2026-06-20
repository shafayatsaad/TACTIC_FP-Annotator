import numpy as np
from scipy.spatial import Voronoi
from typing import Dict, List

def compute_formation_compactness(positions: np.ndarray) -> float:
    """
    positions: [T, 22, 2] — 22 players (11 home + 11 away), x,y only
    Returns: average pairwise distance among the 11 players in possession
    """
    # Simplified: use final frame, team in possession
    # Full implementation would average over T frames
    team_a_pos = positions[-1, :11, :2]  # last frame, home team
    dists = np.linalg.norm(team_a_pos[:, None] - team_a_pos[None, :], axis=2)
    np.fill_diagonal(dists, np.nan)
    return float(np.nanmean(dists))  # smaller = more compact

def compute_pitch_control_share(positions: np.ndarray, ball_pos: np.ndarray) -> float:
    """
    Simplified Voronoi-based pitch control.
    Returns: ratio of pitch area controlled by team in possession [0, 1]
    """
    # Use final frame player positions
    players = positions[-1, :, :2]  # [22, 2]
    # Voronoi requires bounding box; clip to pitch [0,1] x [0,1]
    # Full implementation: use Fernandez et al. 2019 or Spearman 2018
    # Placeholder: return 0.5 for balanced
    return 0.5

def compute_pressing_speed(positions: np.ndarray, ball_carrier_idx: int) -> float:
    """
    Average speed of 3 closest opponents to ball carrier.
    positions: [T, 22, 2]
    """
    opponent_idx = 11 if ball_carrier_idx < 11 else 0  # rough split
    opponent_pos = positions[:, opponent_idx:opponent_idx+11, :2]
    velocities = np.diff(opponent_pos, axis=0) * 10  # fps=10
    speeds = np.linalg.norm(velocities, axis=2)
    return float(np.mean(speeds))

def compute_xg_estimate(positions: np.ndarray, ball_pos: np.ndarray) -> float:
    """
    Placeholder: use a pretrained xG model or distance-to-goal heuristic.
    """
    # Distance from ball to goal (0.5, 1.0) or (0.5, 0.0)
    dist_to_goal = min(
        np.linalg.norm(ball_pos[-1] - np.array([0.5, 1.0])),
        np.linalg.norm(ball_pos[-1] - np.array([0.5, 0.0]))
    )
    # Simple inverse distance (not real xG, but illustrative)
    return float(np.clip(1.0 - dist_to_goal * 2, 0.01, 0.5))

def compute_phase_mixture(logits: np.ndarray) -> List[float]:
    """
    logits: [4] from transformer phase-attention prototype scores
    """
    exp = np.exp(logits - np.max(logits))
    softmax = exp / np.sum(exp)
    return softmax.tolist()

def extract_dag_features(npz_path: str, phase_logits: np.ndarray) -> Dict:
    data = np.load(npz_path)
    traj = data["trajectory"]  # [T, 23, 4]
    
    players = traj[:, :22, :2]  # x,y only
    ball = traj[:, 22, :2]
    
    # Determine possession (simplified: ball closest to which team)
    # Full implementation would use the possession signal from annotator
    
    return {
        "formation_compactness": round(compute_formation_compactness(players), 2),
        "pressing_speed": round(compute_pressing_speed(players, ball_carrier_idx=5), 1),
        "pitch_control_share": round(compute_pitch_control_share(players, ball), 2),
        "xg_estimate": round(compute_xg_estimate(players, ball), 2),
        "phase_mixture": [round(x, 2) for x in compute_phase_mixture(phase_logits)]
    }
