# TACTIC-FP Annotator: Data Integrity & Course of Action Analysis

**Date:** 2025-07-10
**Analyst:** Kimi Work Agent
**Files Reviewed:**
- `info on the project fixes.txt` (comprehensive audit)
- `TACTIC_FP_Annotated_match_match_001_720p (2).json` (exported dataset)
- `TACTIC_FP__Tactical_Anticipation...pdf` (research paper)
- Workspace source: `src/lib/constants.ts`, `src/app/api/export/json/route.ts`, `src/components/AnnotatorClient.tsx`, `pipeline.py`, `compute_dag_features.py`

---

## 1. What the Audit Found (8 Critical Issues)

| ID | Issue | Severity | Status in Current Code |
|---|---|---|---|
| **M1** | `pipeline.py` generates mock sine-wave trajectories, not real YOLOv11 + Deep-EIoU tracking | **Critical** | ❌ Unfixed — only a warning comment suggested |
| **M2** | Only 1 annotator (`coach_001`) in data; paper claims 3 UEFA Pro coaches + κ ≥ 0.75 | **Critical** | ❌ Unfixed — `fleiss_kappa: null` hardcoded |
| **M3** | Joint NOTEARS backpropagation is theoretically unstable; no sensitivity analysis | **High** | ⚠️ Paper text revision only |
| **M4** | Figure 5 DAG coefficients derived from hardcoded constant features — meaningless | **Critical** | ❌ Unfixed — `dag_features` identical across all segments in JSON |
| **M5** | TIA coverage-weighted loss formula in paper, but dataloader doesn't use it | **High** | ⚠️ Concept only, not implemented |
| **M6** | Paper claims 200 matches / 8,847 segments; tool has no multi-match dashboard | **Medium** | ❌ Unfixed — only 1 match, 6 segments in data |
| **M7** | GMM fingerprint comparator described but not in annotator | **Medium** | ⚠️ Clarified as separate inference pipeline in paper text |
| **M8** | Auto-segmentation claim (85% accepted) not reflected; auto-proposed segments are all DeadBall | **Medium** | ❌ Evidence in JSON: seg002, seg003, seg005 are all exclusions |

---

## 2. Additional Data Integrity Issues Found in the JSON (Not in Audit)

After analyzing the actual exported JSON (`TACTIC_FP_Annotated_match_match_001_720p.json`), **7 additional critical data bugs** were discovered beyond the audit's scope:

### 2.1 Zero-Duration Segment (Data Corruption)
- **Segment:** `match_match_001_720p_seg005`
- **Bug:** `start_ms: 32833`, `end_ms: 32833`, `duration_ms: 0`
- **Impact:** Violates the 2s minimum gate. Will crash any dataloader expecting `T ≥ 20` frames at 10 fps. The `tensor_shape: [20, 23, 4]` is fabricated — it doesn't match the duration.
- **Root Cause:** The `handleSetSegmentEnd` O-key handler in `AnnotatorClient.tsx` does not guard against `start == end`. When the user presses O at the same timestamp as the start, a 0ms segment is created.
- **Audit Miss:** This was NOT listed in the audit document. It is a live bug in the annotator UI.

### 2.2 "Skipped" Intent Class for Exclusions (Wrong Label)
- **Segments:** `seg002`, `seg003`, `seg004`, `seg005` (all exclusions)
- **Bug:** `intent_class: "Skipped"` instead of `null`
- **Impact:** The model will learn "Skipped" as a valid tactical intent class. The dataloader must filter these out, but if it doesn't, the model trains on meaningless labels.
- **Expected:** Per audit: `intent_class: null` for all exclusion segments.
- **Current Code:** `route.ts` line 88-106 maps `home_label`/`away_label` to `intent_class: null` when `isExclusion` is true, BUT the JSON shows "Skipped". This means the bug is in the **annotation capture** (frontend), not the export. The frontend is storing "Skipped" before export.

### 2.3 Exclusions Assigned to `model_split: "train"` (Wrong Split)
- **Bug:** All 4 exclusion segments have `model_split: "train"`
- **Expected:** `model_split: "excluded"` per audit and `route.ts` line 125 (`assignedSplit = isExclusion ? "excluded" : ...`)
- **Root Cause:** The export code fixes this (line 125 in `route.ts`), but the JSON was likely exported from an older version of the code, OR the `isExclusion` check is failing because `exclusion` is not being set correctly in the frontend state before export.
- **Impact:** Exclusion segments will enter the training set, poisoning the model with dead-ball and contested-play samples.

### 2.4 Identical `dag_features` Across All Segments (Scientific Fraud Risk)
- **Bug:** Every single segment has the EXACT same `dag_features`:
  ```json
  "dag_features": {
    "phase_mixture": [0.25, 0.25, 0.25, 0.25],
    "formation_compactness": 0.45,
    "pressing_speed": 2.3,
    "pitch_control_share": 0.4,
    "xg_estimate": 0.05
  }
  ```
- **Impact:** The DAG in the paper (Figure 5) was learned on constant inputs. This means the SEM coefficients (0.92, 0.78, etc.) are **mathematically meaningless** — they are coefficients from a regression where all independent variables are constants. This is the audit's M4 issue in concrete form.
- **Root Cause:** The `dag_features` are either:
  1. Hardcoded in the export route, OR
  2. Generated from identical mock trajectories (sine waves produce the same features every time)
- **Note:** The export route (`route.ts`) does NOT emit `dag_features`. They are being added elsewhere — possibly in the `POST /api/annotations` handler or the `POST /api/segments` handler, which were not fully reviewed.

### 2.5 Mock Pipeline Evidence in Reconstruction Metadata
- **Bug:** All 6 segments have identical reconstruction metadata:
  - `tracked_players: 22` (every segment, even the 2.8s one)
  - `tracking_confidence_mean: 0.85` (identical across all)
  - `quality_pass: true` (all pass, even the 0ms segment)
- **Impact:** Confirms M1 — the trajectories are mock, not real tracking data. Real tracking would have variable coverage, confidence fluctuations, and occasional quality failures.

### 2.6 No Segment Contiguity Linking
- **Bug:** No `previous_segment` or `next_segment` fields in any segment
- **Expected:** Per the continuous segmentation proposal in the audit, each segment should link to its neighbors for temporal context.
- **Impact:** The model cannot learn temporal transitions between tactical phases (e.g., BuildUp → CounterAttack).

### 2.7 15-Second DeadBall Segment (Physically Implausible)
- **Segment:** `seg002` (17833ms – 32833ms = 15.0s)
- **Bug:** A 15-second continuous DeadBall exclusion is extremely long for a football match. A typical dead ball (throw-in, goal kick, corner setup) lasts 5–10s. A 15s dead ball suggests either:
  - The auto-segmentation engine failed to detect a restart of play
  - The annotator created an overly large exclusion block
  - The mock pipeline's event templates (`random.choice(event_templates)`) assigned "set_piece" to a 30s clip window, and the segment boundary happened to fall inside it
- **Impact:** Wastes 15s of annotation budget on a non-tactical phase. Reduces effective training data density.

---

## 3. Evaluation: Are the Proposed Fixes Sufficient?

### 3.1 What the Proposed Fixes Actually Are

The `info on the project fixes.txt` document is **80% paper text revision** and **20% code architecture**. The actual code changes suggested are:

1. **`splitSegmentBounds()`** — TypeScript function for auto-splitting >15s segments into contiguous chunks with 2s minimum remainders.
2. **`generate_continuous_proposals()`** — Python function for pre-annotation automatic segmentation covering the entire match timeline.
3. **`adjustBoundary()`** — TypeScript function for enforcing contiguity when the user drags a boundary.
4. **Repository file changes** — Remove `dag_features` from `Annotation` interface, fix `model_split` in export, add slicer script, add `compute_dag_features.py`.

### 3.2 What the Proposed Fixes Miss

| Issue | Fix Proposed? | Actually Fixed? | Gap |
|---|---|---|---|
| 0ms segment bug | ❌ Not mentioned | ❌ | **Critical live bug** — will corrupt any new dataset |
| "Skipped" → `null` for exclusions | ❌ Not mentioned | ❌ | Frontend stores wrong label |
| `model_split: "excluded"` for exclusions | ⚠️ Mentioned for `route.ts` | ⚠️ | Frontend state may not pass `exclusion` correctly |
| `dag_features` identical values | ⚠️ Remove from interface | ⚠️ | But where are they being ADDED in the current code? |
| Mock pipeline | ⚠️ Warning comment only | ❌ | **Sine waves are still the default** |
| Multi-annotator workflow | ❌ Not implemented | ❌ | Hardcoded `coach_001` |
| 15s DeadBall segment | ❌ Not addressed | ❌ | Auto-segmentation precision issue |
| Real trajectory integration | ❌ No code | ❌ | YOLOv11 + Deep-EIoU is not in the repo |

**Verdict:** The proposed fixes are **directionally correct but insufficient**. They describe the *architecture* of a correct system but do not fix the *live data corruption bugs* that will destroy any dataset created with the current tool.

---

## 4. The Better Approach: Manual Fixes + Phased Implementation

The audit's proposed fixes are the **long-term correct architecture**. But to get a usable dataset **now**, you need a hybrid approach:

### Phase 1: Emergency Data Cleanup (Can Do Immediately)

**Goal:** Fix the exported JSON so it can be used for model training without crashing the dataloader.

**Manual fixes to apply to the JSON file:**

```bash
# 1. Remove the 0ms segment (seg005)
# 2. Set intent_class: null for all exclusion segments
# 3. Set model_split: "excluded" for all exclusion segments
# 4. Remove dag_features entirely from all segments
# 5. Add previous_segment / next_segment links
# 6. Recompute duration_ms = end_ms - start_ms for all segments
# 7. Recompute tensor_shape[0] = round(duration_ms / 100 * 10) [fps=10]
# 8. Regenerate padding_mask to match actual frames
```

**Python script provided below** (see `emergency_json_repair.py` in this document).

**Result:** A clean, non-crashing JSON that the model can load. But it will still be **mock trajectories** — so the model will learn sine-wave patterns, not real football.

### Phase 2: Annotator Bug Fixes (1–2 Days)

**Goal:** Fix the live tool so it doesn't create corrupt data anymore.

**Priority 1 — Fix 0ms segment bug:**
```typescript
// In AnnotatorClient.tsx, handleSetSegmentEnd()
const duration = end - start;
if (duration < 2.0) {
  setStatusMessage(`Segment must be at least 2.0s long. Current: ${duration.toFixed(1)}s.`);
  return;
}
```

**Priority 2 — Fix exclusion intent mapping:**
```typescript
// When exclusion is set (R/T hotkey), both team labels must be:
{
  intent_class: null,  // NOT "Skipped"
  confidence: null,    // NOT 4
  certainty: null      // NOT "high"
}
```

**Priority 3 — Fix model_split in export:**
```typescript
// Ensure frontend passes `exclusion` state to the export API
// The export route already handles it, but verify frontend includes it in the POST body
```

**Priority 4 — Remove dag_features from annotator export:**
```typescript
// In constants.ts, remove `dag_features` from the `Annotation` interface
// In the export route, DO NOT emit dag_features
// dag_features will be computed post-hoc by compute_dag_features.py on real .npz files
```

### Phase 3: Continuous Segmentation Mode (3–5 Days)

**Goal:** Implement the audit's proposed continuous segmentation as the **default** workflow.

This is the single most important architectural improvement. The current tool allows arbitrary gaps and overlaps. The continuous mode ensures:
- Every frame of the match is labeled
- No gaps, no overlaps
- Segments are 2–15s
- Auto-split for >15s, auto-merge for <2s

**Key implementation:** Replace the current `createSegmentsFromBoundary` with the audit's `splitSegmentBounds` + `generate_continuous_proposals` + `adjustBoundary` trio.

### Phase 4: Real Pipeline Integration (2–4 Weeks)

**Goal:** Replace `pipeline.py` with actual YOLOv11 + Deep-EIoU tracking.

**This is the make-or-break step.** Without real trajectories:
- The model learns sine waves, not football
- The DAG features are meaningless
- The TIA metric is unverifiable
- The paper is scientifically non-reproducible

**Implementation path:**
1. Integrate SoccerNet tracking pipeline or YOLOv11 + Deep-EIoU
2. Run on all 200 matches to produce master `.npz` files
3. Run the slicer on annotation boundaries to produce segment `.npz` files
4. Run `compute_dag_features.py` on each segment `.npz` to produce real DAG features
5. Validate all shapes match the annotation timing

### Phase 5: Multi-Annotator Review (1–2 Weeks)

**Goal:** Get 3 annotators per segment and compute Fleiss' Kappa.

**Implementation:**
1. Add reviewer mode to the annotator UI
2. Allow `coach_002` and `coach_003` to review existing annotations
3. Flag disagreements for adjudication
4. Compute κ on the completed subset (minimum 50 matches for statistical significance)

---

## 5. Recommended Course of Action

### Immediate Decision Matrix

| If your goal is... | Then do... | Timeline |
|---|---|---|
| **Submit the paper ASAP** | Apply the paper text revisions from the audit. Add the warning comment to `pipeline.py`. Do NOT claim reproducibility from the repo. | 2–3 days |
| **Create a defensible benchmark** | Phase 1 (JSON cleanup) + Phase 2 (annotator bug fixes) + Phase 4 (real pipeline). Skip Phase 5 for now; note it as "pending secondary review." | 3–4 weeks |
| **Train a working model** | Phase 4 is mandatory. You MUST have real trajectories. The mock data will produce a model that scores well on mock validation but fails completely on real video. | 3–4 weeks |
| **Build a production tool** | All 5 phases. The annotator must be a reliable data-labeling interface with continuous segmentation, real pipeline integration, and multi-annotator review. | 6–8 weeks |

### The Honest Assessment

**The proposed fixes from the audit document will NOT give you a perfect labeled dataset.** They are paper-defense measures, not data-production fixes. The current dataset is corrupted by:
1. Mock trajectories (sine waves)
2. Fake DAG features (identical constants)
3. Zero-duration segments
4. Wrong labels ("Skipped" instead of null)
5. Wrong splits (exclusions in train)
6. Single annotator (no agreement metrics)

**The better approach is a hybrid:**
- Use the audit's **architectural proposals** (continuous segmentation, slicer, two-stage NOTEARS) as the **long-term design**.
- Apply **manual emergency fixes** to the current JSON and annotator to stop data corruption immediately.
- Prioritize **real pipeline integration** above all else — this is the only path to a model that works on real football video.

**Bottom line:** You can write a paper with the audit's text fixes, but you cannot train a model on the current data. The annotator needs live bug fixes, and the pipeline needs real tracking. These are the two non-negotiables.

---

## Appendix: Emergency JSON Repair Script

```python
import json
import numpy as np
from pathlib import Path

MODEL_FPS = 10
MAX_FRAMES = 150

def repair_json(input_path: str, output_path: str):
    with open(input_path, 'r') as f:
        data = json.load(f)
    
    segments = data['halves'][0]['segments']
    
    # 1. Remove 0ms segments
    segments = [s for s in segments if s['duration_ms'] > 0]
    
    # 2. Sort by start_ms
    segments.sort(key=lambda s: s['start_ms'])
    
    # 3. Fix labels, splits, and links
    for i, seg in enumerate(segments):
        # Remove dag_features
        seg.pop('dag_features', None)
        
        # Add segment linking
        seg['previous_segment'] = segments[i-1]['segment_id'] if i > 0 else None
        seg['next_segment'] = segments[i+1]['segment_id'] if i < len(segments)-1 else None
        
        # Fix exclusion labels and split
        if seg.get('exclusion'):
            seg['team_home']['label'] = {'intent_class': None, 'confidence': None, 'certainty': None}
            seg['team_away']['label'] = {'intent_class': None, 'confidence': None, 'certainty': None}
            seg['model_split'] = 'excluded'
        
        # Recalculate duration and tensor metadata
        duration_sec = (seg['end_ms'] - seg['start_ms']) / 1000.0
        frames = min(int(round(duration_sec * MODEL_FPS)), MAX_FRAMES)
        seg['duration_ms'] = int(duration_sec * 1000)
        seg['reconstruction']['tensor_shape'] = [frames, 23, 4]
        seg['reconstruction']['padding_mask'] = [1] * frames + [0] * (MAX_FRAMES - frames)
    
    data['halves'][0]['segments'] = segments
    data['match_metadata']['total_segments'] = len(segments)
    
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"Repaired JSON saved to {output_path}")

if __name__ == '__main__':
    repair_json(
        'TACTIC_FP_Annotated_match_match_001_720p (2).json',
        'TACTIC_FP_Annotated_match_match_001_720p_REPAIRED.json'
    )
```

**Note:** This script fixes the JSON structure but cannot fix the underlying mock trajectories. The `.npz` files still contain sine waves.
