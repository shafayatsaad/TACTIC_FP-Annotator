#!/usr/bin/env python3
"""pipeline_validator.py - Validate TACTIC-FP pipeline setup"""
import os, sys, json

def check_ffmpeg():
    import subprocess
    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0: print(f"[OK] ffmpeg: {result.stdout.split(chr(10))[0][:50]}..."); return True
    except: pass
    print("[FAIL] ffmpeg NOT found!"); return False

def check_directory_structure():
    for d in ["raw_videos", "data/trajectories"]:
        if os.path.exists(d): print(f"[OK] {d}/ exists")
        else: print(f"[WARN] {d}/ missing (creating)"); os.makedirs(d, exist_ok=True)
    return True

def check_clips():
    mp = os.path.join("data", "clip_manifest.json")
    if not os.path.exists(mp):
        vids = [f for f in os.listdir("raw_videos") if f.lower().endswith((".mp4",".mkv",".avi",".mov",".webm"))] if os.path.exists("raw_videos") else []
        if vids: print(f"[OK] {len(vids)} raw video(s) ready"); return True
        else: print("[WARN] No raw videos or manifest"); return False
    with open(mp) as f: m = json.load(f)
    if not m: print("[WARN] Manifest empty"); return True
    if "raw_videos" in m[0].get("path", ""):
        print("[OK] Virtual mode"); missing = sum(1 for c in m[:20] if not os.path.exists(c.get("path","")))
        if missing: print(f"  [FAIL] {missing} videos missing"); return False
        print("  [OK] All videos present"); return True
    else: print("[OK] Physical mode"); return True

def check_manifest():
    mp = os.path.join("data", "clip_manifest.json")
    if not os.path.exists(mp): print("[FAIL] No manifest"); return False
    with open(mp) as f: m = json.load(f)
    print(f"[OK] Manifest: {len(m)} clips"); return True

def validate_segment_npz(npz_path, expected_shape, padding_mask=None):
    """
    Validate that the NPZ file exists, contains the 'trajectory' array,
    has dimensions matching expected_shape, and matches agent dimensions (23, 4).
    If padding_mask is provided, assert that the sum of the padding mask
    matches the actual frame count from the trajectory shape.
    """
    import numpy as np
    if not os.path.exists(npz_path):
        raise FileNotFoundError(f"NPZ file not found at {npz_path}")
    
    data = np.load(npz_path)
    if 'trajectory' not in data:
        raise KeyError(f"Array key 'trajectory' not found in {npz_path}")
        
    traj = data['trajectory']
    shape = list(traj.shape)
    
    # 1. Assert agent dimensions (23, 4)
    if len(shape) != 3 or shape[1] != 23 or shape[2] != 4:
        raise ValueError(f"Invalid trajectory shape {shape}. Expected (F, 23, 4).")
        
    # 2. Assert frame length matches expected shape
    if shape[0] != expected_shape[0]:
        raise ValueError(f"Frame length mismatch: actual {shape[0]}, expected {expected_shape[0]}.")
        
    # 3. Verification of padding mask logic length if provided
    if padding_mask is not None:
        if len(padding_mask) != 150:
            raise ValueError(f"Padding mask length is {len(padding_mask)}, expected 150.")
        if sum(padding_mask) != shape[0]:
            raise ValueError(f"Padding mask sum ({sum(padding_mask)}) does not match trajectory frame length ({shape[0]}).")
            
    return True

def main():
    print("="*60); print("TACTIC-FP Pipeline Validator"); print("="*60)
    checks = [("ffmpeg", check_ffmpeg), ("Directories", check_directory_structure), ("Clips", check_clips), ("Manifest", check_manifest)]
    results = {}
    for name, fn in checks: print(f"\n--- {name} ---"); results[name] = fn()
    print("\n" + "="*60); print("SUMMARY")
    for n, ok in results.items(): print(f"{'[PASS]' if ok else '[FAIL]'} {n}")
    print("\nStart: npm run dev")

if __name__ == "__main__": sys.exit(main())

