# TACTIC-FP Comprehensive Gap Analysis & Fix Assessment

## Executive Summary

After examining the **full JSON dataset**, **the 16-page paper (PDF)**, and **all source code files** (`pipeline.py`, `generate_manifest.py`, `compute_dag_features.py`, `AnnotatorClient.tsx`, `constants.ts`, `export/json/route.ts`, and `README.md`), I can confirm **all 8 critical gaps are real and verifiable**. 

More importantly: **the proposed paper and annotator fixes are necessary but insufficient to produce a model-ready dataset.** The root problem is not merely annotation workflow bugs — it is that the **entire model training pipeline, inference engine, and real trajectory extraction are missing from the repository**. The annotator is a UI shell around mock data. Fixing the paper text and segment-splitting logic makes the claims honest, but it does not create the training infrastructure needed to achieve the reported 47.2% TIA@5.

---

## 1. Verified Findings from the Actual Data

### 1.1 JSON Dataset Analysis (match_match_001_720p)

| Property | Paper Claim | Actual JSON | Verdict |
|----------|-------------|-------------|---------|
| Annotators | 3 UEFA Pro + 1 reviewer | `coach_001` only | ❌ M2 |
| Fleiss' κ | ≥ 0.75 | `null` | ❌ M2 |
| Multi-annotator review | Completed | `completed: false`, pending `coach_002`, `coach_003` | ❌ M2 |
| Total segments | 8,847 (200 matches) | 6 segments (1 match, 37.5s) | ❌ M6 |
| Valid intent segments | N/A | 2 out of 6 (33%) | ❌ M8 |
| Exclusion segments | Should be filtered out | 4 out of 6 (67%), all `DeadBall` | ❌ M8 |
| Zero-duration segment | Impossible with 2s minimum | `seg005`: 0ms (start=end=32833) | ❌ Data integrity |
| Duplicate NPZ paths | Should be unique | `seg002.npz` used by `seg002` AND `seg005` | ❌ Data integrity |
| Model split for exclusions | Should be `"excluded"` | All 4 exclusions have `"train"` | ❌ Bug in export |
| Coverage estimate | Should vary per segment | All 6 segments: exactly `0.95` | ❌ Hardcoded |
| Tracking confidence | Should vary per segment | All 6 segments: exactly `0.85` | ❌ Hardcoded |
| DAG features | Should be trajectory-derived | `formation_compactness=0.45`, `pressing_speed=2.3`, `xg=0.05` across 5/6 segments | ❌ M4 |
| `phase_mixture` | Should reflect actual phase | Only 3 unique combinations across 6 segments; 4 segments identical `[0.25,0.25,0.25,0.25]` | ❌ M4 |
| Contiguity | Should cover full match without gaps | Segments are contiguous but only cover 37.5s | ⚠️ Scale issue |
| Non-excluded coverage | Should be >80% of match | 17.8s / 37.5s = 47.5% | ❌ M8 |

### 1.2 Code-Level Verification

#### `pipeline.py` (M1 — Mock Trajectories)
**Confirmed critical.** Lines 12–63 generate `np.sin()` / `np.cos()` circular motion for all 22 players plus ball. The function is literally named `generate_mock_trajectory_with_event`. The README (line 93) presents it as the official pipeline: "`pipeline.py` generates contiguous clip windows from `raw_videos/`, writes `data/clip_manifest.json` + `.npz` trajectory files." There is **no prominent warning** that this is placeholder data. The `--no-trajectories` flag even skips `.npz` generation entirely, emitting empty strings.

#### `compute_dag_features.py` (M4 — Hardcoded DAG Features)
**Confirmed critical.** This file is a **stub**, not a real feature extractor:
- `compute_pitch_control_share()` returns `0.5` (line 27: literal `return 0.5` with comment "Placeholder")
- `compute_xg_estimate()` uses inverse distance heuristic, not a calibrated model (line 45–50)
- `compute_pressing_speed()` uses `ball_carrier_idx=5` hardcoded, not actual ball proximity
- `compute_formation_compactness()` uses only the **final frame** (`positions[-1]`), not averaged over T frames
- The file is **never called by the annotator**. The JSON's `dag_features` are written directly by the export route, not computed from trajectories.

#### `AnnotatorClient.tsx` (M2, M5, M6, M8 — Multiple Issues)
**Confirmed multiple issues:**
- **Line 2202**: `annotator_id: "coach_001"` is **hardcoded** in the `saveAnnotation` function. No multi-annotator support exists.
- **Line 2203**: `session_id` is auto-generated from today's date. No session management for multiple reviewers.
- **Lines 2278–2294**: `exportJSON` function hardcodes `fleiss_kappa: null` and `pending_reviewers: ["coach_002", "coach_003"]`. The IAA is never computed.
- **Lines 3767–3858**: `toModelSamples()` function converts annotations to model samples but **does NOT compute `coverage_estimate × confidence` sample weights**. M5 is confirmed — the dataloader formula is missing.
- **Lines 2428–2436**: `annotation_meta` timestamps are generated at submit time, but `annotation_duration_sec` is computed as `(Date.now() - annotationStartTimeRef.current) / 1000`, which resets on every clip change. The `re_annotation_count` is always 0.
- **Lines 1907–1920**: `handleDeleteSegment` has a **contiguity bug**: it resets `currentStart = 0` for rechaining, which assumes the match always starts at 0. If the first segment doesn't start at 0 (e.g., due to exclusion), all subsequent segments shift incorrectly.
- **Lines 1247–1250**: When loading a video directly, the app defaults to `home: "Chelsea"`, `away: "Burnley"` regardless of the actual filename.

#### `src/app/api/export/json/route.ts` (Model Split Bug)
**Line 125**: `const assignedSplit = isExclusion ? "excluded" : (ann.model_split?.assigned_split || "train");` — this logic appears correct in the export route. However, the **actual JSON output** shows `model_split: "train"` for all 4 exclusion segments. This suggests the frontend's `saveAnnotation` is sending the wrong `model_split` value, or the annotation object's `model_split` field is not being updated when `exclusion` is set. Looking at `AnnotatorClient.tsx` line 2215: `model_split: { assigned_split: effectiveExclusion ? "excluded" : modelSplit }` — this is correct at submit time. But the `exportJSON` function (line 2843) reconstructs `model_split` from `ann.model_split?.assigned_split`. If the annotation was saved before the exclusion toggle, it would be wrong. The actual JSON shows `exclusion: "DeadBall"` with `model_split: "train"`, confirming the export logic has a bug where it doesn't re-evaluate exclusion status at export time.

#### `generate_manifest.py` (Shift Detection — Partially Functional)
The `detect_intent_shift_points()` function (lines 63–92) uses possession change and compactness delta heuristics. This is actually a reasonable starting point, but `propose_segments_from_shifts()` (lines 94–123) has a **fundamental flaw**: it creates segments around shift points with fixed pre/post windows (`pre=2.8s, post=3.8s` for possession changes). These proposals are **not contiguous** — there are gaps between them, and they overlap with the clip boundaries. The paper's "continuous tactical segmentation" concept is not implemented.

---

## 2. Assessment of Proposed Fixes

### 2.1 Paper Revision Guide — VERDICT: Correct and Necessary ✅

All the paper text fixes are **factually correct** and **ethically required**. They transform the paper from one with potential scientific-integrity issues into an honest description of a work-in-progress system. The two most critical fixes are:

1. **Option A (Two-stage NOTEARS)** — This is the **only viable path**. Joint backpropagation of NOTEARS with a transformer is theoretically unstable without a carefully tuned augmented Lagrangian. The paper's current claim of "learned jointly with the transformer via backpropagation" (Section 4.2) is unsupported by the code. Switching to two-stage (transformer → latent extraction → NOTEARS) is conservative, reproducible, and defensible.

2. **Figure 5 caption fix** — The edge weights must be described as "estimated from trajectory-derived features" or "on synthetic validation data." The current caption claims validation on "synthetic data" for SHD/TPR/FDR but implies expert agreement on the learned DAG from real data. The 84.7% expert edge agreement refers to synthetic ground-truth edges, which is a critical distinction reviewers will catch.

3. **Limitations addition** — Adding "Annotation Scale" and "Mock Pipeline" limitations is **essential**. Without these, the paper is making claims it cannot substantiate.

### 2.2 Annotator Code Fixes — VERDICT: Partially Correct, Insufficient ⚠️

The `splitSegmentBounds()` function and continuous segmentation proposal are **conceptually correct** for a benchmark dataset. However, they do not solve the deeper problems:

| Proposed Fix | Will It Work? | Gap |
|-------------|---------------|-----|
| `splitSegmentBounds()` in `AnnotatorClient.tsx` | ✅ Yes, for segment splitting | Only fixes the 15s cap UI behavior |
| `generate_continuous_proposals()` Python function | ⚠️ Conceptually correct, but depends on `detect_intent_shift_points()` | The shift detection is too crude (possession change + compactness delta) for 85% precision. Real tactical shifts require ball velocity, pass detection, and event data. |
| Review mode with contiguity enforcement | ✅ Yes, but requires significant new UI | The current `handleDeleteSegment` rechain logic is buggy; fixing it requires rewriting the boundary adjustment to use actual previous segment end times, not `currentStart = 0`. |
| Auto-segmentation 85% acceptance | ❌ No, not achievable with current heuristics | The current `propose_segments_from_shifts()` uses fixed 2.8s/3.8s windows around possession changes. This will produce many false positives and missed shifts. The uploaded data shows 67% exclusion rate for auto-proposed segments. |

### 2.3 The Missing Pieces (Not Addressed by Proposed Fixes)

The following are **absent from the repository entirely** and are not covered by any proposed fix:

| Missing Component | Why It Matters | Can Paper Claim It? |
|-------------------|--------------|----------------------|
| **Real YOLOv11 + Deep-EIoU pipeline** | The paper claims "avoids proprietary tracking sensors" and uses "broadcast video only." Without real tracking, the entire input representation is fake. | No. The paper must clarify this is a **planned** integration or use SoccerNet tracking data. |
| **Tri-axial transformer model code** | The paper describes 8 layers, 25M parameters, rotating attention axes. No model training code exists in the repo. | The paper can describe the architecture, but cannot claim 47.2% TIA@5 without implementation. |
| **NOTEARS implementation with SEM** | The paper describes joint/two-stage DAG learning. No NOTEARS code exists. `compute_dag_features.py` is a stub. | The paper can describe the planned approach, but cannot claim SHD=1.2, TPR=0.92 without implementation. |
| **GMM fingerprint comparator** | The paper claims CD-AUC 0.834. No GMM, Wasserstein-2, or deviation detection code exists. | The paper can describe this as a planned inference module, but cannot claim the metric. |
| **Training dataloader with coverage-weighted loss** | `toModelSamples()` in `AnnotatorClient.tsx` does not compute `w_i = coverage_i × confidence_i`. | The paper can describe the formula, but cannot claim 47.2% TIA@5 if the loss function is unimplemented. |
| **Multi-annotator review infrastructure** | Only 1 annotator hardcoded. No review mode, no κ computation. | The paper must scale back claims to single-annotator data with planned multi-annotator validation. |
| **Real xG model calibration** | `compute_xg_estimate()` uses `1 - distance_to_goal`, not a calibrated StatsBomb model. | The paper can describe a heuristic, but cannot claim calibrated xG without real model. |
| **Real pitch control (Voronoi)** | `compute_pitch_control_share()` returns `0.5`. | The paper must cite Fernandez et al. 2019 but acknowledge unimplemented. |
| **Real 200-match dataset** | Only 1 match, 37.5 seconds annotated. | The paper must reduce claims to pilot dataset size with planned expansion. |

---

## 3. The Core Question: Will These Fixes Give a Perfect Dataset?

### Answer: **No.**

The proposed fixes will **not** produce a perfect labelled dataset because the problem is not primarily in the annotation UI — it is in the **missing data pipeline and model infrastructure**. Here's the dependency chain:

```
Perfect Dataset Requires:
├── Real broadcast video (not mock sine waves)
├── Real YOLOv11 + Deep-EIoU tracking (not np.sin circles)
├── Real trajectory features (formation compactness, pressing speed, xG, pitch control)
├── Real multi-annotator labels with κ ≥ 0.75
├── Real coverage estimates (not hardcoded 0.95)
├── Real confidence scores (not all 4/5)
├── Contiguous 90-minute segmentation with no gaps
└── Sliced .npz files with correct [T_seg, 23, 4] shapes

Current State:
├── Mock sine-wave trajectories
├── Stub feature extractors returning constants
├── Single annotator, hardcoded values
├── 37.5 seconds of data, 67% exclusions
├── Zero-duration segment, duplicate NPZ paths
└── No model training code, no inference engine, no GMM comparator
```

**The annotator UI is actually quite good.** The keyboard shortcuts, possession-aware blocking, validation gates, and export schema are well-designed. The UI is not the bottleneck. The bottleneck is that **there is no real data to annotate, no real model to train, and no real evaluation to run.**

---

## 4. Better Approach: What Should Actually Be Done

### Phase 1: Honest Paper Revision (Immediate — 1–2 weeks)

**Goal:** Publish a technically sound paper that describes the system architecture and pilot results without overstating what exists.

**Critical changes:**
1. **Retitle the paper contribution** from "TACTIC-FP achieves 47.2% TIA@5" to "TACTIC-FP: A Framework for Tactical Intent Annotation and Causal Modeling from Broadcast Video" — frame it as a **system design and benchmark proposal**.
2. **Remove all metrics that cannot be reproduced** from the current repository: TIA@5 numbers, CD-AUC 0.834, SHD=1.2, expert agreement 84.7%. Replace with **pilot qualitative results** or **synthetic validation only**.
3. **Section 8.3 Limitations** must be expanded to include:
   - "The current open-source release includes a placeholder trajectory generator for UI testing. Real broadcast video tracking is under development via YOLOv11 + Deep-EIoU integration."
   - "The reported metrics are based on synthetic trajectory validation and architecture ablation studies, not full-match broadcast video."
   - "TACTIC-Bench currently contains a pilot dataset of [X] matches with single-annotator labels. Multi-annotator review and Fleiss' κ computation are planned for the v2 release."
4. **Table 1** must be split: "Pilot Dataset (Current)" vs. "Target Dataset (Planned)."
5. **Section 4.2** must adopt **Option A (Two-stage NOTEARS)** explicitly. Remove the joint backpropagation claim.
6. **Figure 5 caption** must state: "Learned DAG structure on synthetic validation data (1,000 matches with known causal structure). Edge weights are SEM coefficients from synthetic trajectory features. Expert validation conducted on synthetic ground-truth edges only."

### Phase 2: Build Real Data Pipeline (Weeks 3–8)

**Goal:** Replace mock data with real tracking from broadcast video.

**Steps:**
1. **Integrate SoccerNet tracking pipeline** (YOLOv11 + Deep-EIoU + PnLCalib + OSNet). This is existing open-source code. Use the SoccerNet 2025 challenge pipeline as the starting point.
2. **Run on 50–100 matches** from SoccerNet or public broadcast archives (e.g., Bundesliga open data, Premier League historical clips, J-League open data).
3. **Implement real trajectory slicer**: Given full-match `.npz` `[T_total, 23, 4]`, crop to `[T_seg, 23, 4]` based on annotation boundaries, with correct padding mask `[150]`.
4. **Implement real DAG feature computation**:
   - Formation compactness: average pairwise distance over all T frames, not just final frame
   - Pressing speed: average velocity of 3 closest opponents to ball carrier, computed from actual trajectories
   - Pitch control: implement Voronoi tessellation per Fernandez et al. 2019
   - xG: calibrate a simple model from StatsBomb Open Data or use a pre-trained model
   - Phase mixture: use transformer phase-attention logits (requires transformer model first)
5. **Implement coverage estimation**: Count non-zero player positions per frame, compute fraction of visible frames per team, average over segment.

### Phase 3: Multi-Annotator Data Collection (Weeks 6–12, parallel with Phase 2)

**Goal:** Collect 3-annotator data on at least 50 matches for IAA computation.

**Steps:**
1. **Recruit 3 UEFA Pro coaches** (or equivalent: sports science PhDs, professional analysts). Document their credentials.
2. **Annotate 50 matches** with the continuous segmentation protocol: each annotator independently labels all segments, then a 4th reviewer resolves conflicts.
3. **Compute Fleiss' κ** per intent class and overall. Report κ per class in the paper (some classes like BuildUp_Short vs PossCirculation will have lower κ — this is normal and should be reported honestly).
4. **Train/val/test split** at the **match level**, not segment level. All segments from the same match go to the same split. This prevents data leakage.
5. **Exclusion handling**: DeadBall and ContestedPlay segments go to a separate `excluded` directory, never enter train/val/test.

### Phase 4: Model Implementation & Training (Weeks 8–16)

**Goal:** Implement the actual tri-axial transformer, NOTEARS SCM, and GMM comparator.

**Steps:**
1. **Implement tri-axial transformer** in PyTorch:
   - Temporal attention: FlashAttention-2 with padding mask
   - Agent attention: GATv2 over player graph (22 players + ball)
   - Phase attention: 4 learnable prototypes with softmax mixture
   - 8 layers, d=256, 8 heads, FFN=1024, ~25M parameters
2. **Implement training dataloader** with coverage-weighted loss:
   ```python
   w_i = coverage_i * (confidence_i / 5.0)  # map 1-5 to 0.2-1.0
   loss = sum(w_i * CE(pred_i, label_i)) / sum(w_i)
   ```
3. **Implement two-stage NOTEARS**:
   - Stage 1: Train transformer for intent classification (cross-entropy)
   - Stage 2: Extract latents z, compute 6 DAG features, run NOTEARS to get adjacency matrix A
   - Stage 3: Fine-tune SEM parameters with fixed A skeleton
4. **Implement GMM fingerprint comparator**:
   - Fit K=8 GMMs per team on historical intent latents
   - Compute Wasserstein-2 distance between live 5-segment GMM and reference
   - Tune threshold τ for 90% precision on validation set
5. **Train on 3-stage protocol** as described in the paper (SoccerNet pre-train → J-League phase → TACTIC-Bench fine-tune)

### Phase 5: Evaluation & Ablation (Weeks 14–18)

**Goal:** Produce reproducible metrics that can be reported in the paper.

**Steps:**
1. **TIA@δ evaluation**: Compute on held-out test matches (15% of 200 = 30 matches). Report mean ± std across 5 random seeds.
2. **CD-AUC evaluation**: Collect a validation set of matches with known tactical deviations (e.g., coach interviews, half-time tactical changes). Compute ROC curve for deviation detection.
3. **DAG validation**: Run on synthetic data with known causal structure (1,000 matches). Report SHD, TPR, FDR. Also report expert edge agreement on the synthetic DAG.
4. **Cross-dataset generalization**: Train on TACTIC-Bench (Premier League), evaluate on J-League tracking data mapped to broadcast equivalent.
5. **Edge deployment**: Measure inference latency on RTX 3060 and Jetson Nano. Report clips/second with real video decoding + tracking + encoding + GMM comparison.

---

## 5. Honest Re-assessment of Paper Claims

| Paper Claim | Current Status | Honest Revision |
|-------------|----------------|---------------|
| "47.2% TIA@5" | Unimplemented | "Pilot architecture achieves [X]% on synthetic validation; full evaluation planned" |
| "0.834 CD-AUC" | Unimplemented | "GMM comparator designed for Wasserstein-2 thresholding; validation planned" |
| "200 matches, 8,847 segments" | 1 match, 6 segments, 37.5s | "Pilot dataset: 1 match, 6 segments; target: 200 matches" |
| "3 UEFA Pro coaches + 1 reviewer, κ ≥ 0.75" | 1 annotator, κ = null | "Single-annotator pilot; multi-annotator review planned for v2" |
| "85% auto-segmentation accepted" | 67% exclusion rate | "Auto-segmentation under development; current pilot uses manual boundary review" |
| "Real-time inference 1.9 clips/s on RTX 3060" | No inference code | "Architecture designed for FlashAttention-2 and INT8 quantization; deployment benchmarking planned" |
| "Edge deployment on Jetson Nano" | No edge code | "Planned for v2 with TensorRT INT8 conversion" |
| "Joint NOTEARS backpropagation" | Theoretically unstable | "Two-stage procedure: transformer → latent extraction → NOTEARS structure learning" |

---

## 6. Immediate Action Items (Priority Order)

### P0 — Do Not Submit Paper Without These
- [ ] Rewrite Abstract and Introduction to frame as **system design and benchmark proposal**, not achieved results
- [ ] Add "Pilot Dataset" vs. "Target Dataset" tables
- [ ] Add limitations section acknowledging mock pipeline, single annotator, and unimplemented model
- [ ] Switch Section 4.2 to **two-stage NOTEARS** (Option A)
- [ ] Fix Figure 5 caption to specify synthetic validation only
- [ ] Remove all metrics that cannot be reproduced from current code

### P1 — Repository Fixes (Before Any Reviewer Runs It)
- [ ] Add **PROMINENT WARNING** at top of `pipeline.py`: "PLACEHOLDER: This generates mock sine-wave trajectories for UI testing only. Replace with real YOLOv11 + Deep-EIoU output for production."
- [ ] Fix `export/json/route.ts` model_split bug: exclusion segments must export as `"excluded"`
- [ ] Fix `handleDeleteSegment` rechain bug: use actual segment start times, not `currentStart = 0`
- [ ] Remove hardcoded `annotator_id: "coach_001"` — make it configurable via UI or env var
- [ ] Remove hardcoded `coverage_estimate: 0.95` and `tracking_confidence_mean: 0.85` — compute from actual trajectories or allow manual input
- [ ] Remove `dag_features` from JSON export entirely (they are not computed from trajectories)
- [ ] Add zero-duration segment rejection to `validateBeforeSubmit`
- [ ] Add duplicate NPZ path detection to `validateBeforeSubmit`

### P2 — Annotator Improvements (Good for Demo, Not Critical for Paper)
- [ ] Implement `splitSegmentBounds()` logic in `handleSetSegmentEnd` for proper 15s auto-split with minimum remainder handling
- [ ] Add continuous segmentation review mode (timeline view showing all segments)
- [ ] Add "previous_segment" / "next_segment" links in export JSON
- [ ] Implement `generate_continuous_proposals()` on the backend using real shift detection
- [ ] Add multi-match dashboard (aggregate stats across matches)

### P3 — Model Implementation (Post-Paper, Pre-Release)
- [ ] Implement tri-axial transformer in PyTorch
- [ ] Implement two-stage NOTEARS training pipeline
- [ ] Implement GMM fingerprint comparator
- [ ] Implement real tracking integration (SoccerNet pipeline)
- [ ] Implement real DAG feature computation from trajectories
- [ ] Implement coverage-weighted dataloader
- [ ] Train and evaluate on full 200-match dataset
- [ ] Release v2 paper with real metrics

---

## 7. Conclusion

The proposed fixes to the paper text are **essential and correct** — they transform an overstated manuscript into an honest description of a promising but incomplete system. The proposed fixes to the annotator code are **useful but cosmetic** — they improve the UI without addressing the fundamental absence of real data, real tracking, real model training, and real evaluation.

**The honest path forward is:**
1. **Publish the paper as a system design and benchmark proposal** with pilot-scale results and clear limitations.
2. **Label the current repository as v0.1 (alpha)** with prominent warnings about mock data.
3. **Build the real data pipeline and model implementation** in parallel.
4. **Release v2** with real metrics, real dataset, and real model code — then update the paper with achieved results.

Attempting to submit the current paper with its current claims, even with the annotator UI fixes, would be **high-risk for rejection** due to reproducibility concerns. Reviewers will run the code, see `np.sin()` circles, and immediately question the integrity of the entire benchmark. The paper revision guide is the right first step, but it must be followed by genuine implementation before any metrics can be claimed.

---

*Analysis conducted on: `pipeline.py`, `generate_manifest.py`, `compute_dag_features.py`, `src/components/AnnotatorClient.tsx`, `src/lib/constants.ts`, `src/app/api/export/json/route.ts`, `README.md`, and the exported JSON `TACTIC_FP_Annotated_match_match_001_720p.json`.*
