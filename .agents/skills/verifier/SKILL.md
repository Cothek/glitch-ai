---
type: Skill
title: LLM-as-a-Verifier
description: Continuous scoring methodology for LLM output verification — granularity scaling, repeated evaluation, criteria decomposition, Probabilistic Pivot Tournament (PPT), and Value-Order Correlation (VOC) for progress monitoring. Based on arXiv:2607.05391v1.
tags: [verification, evaluation, llm-as-judge, quality-gate, dev-loop]
timestamp: 2026-07-15T00:00:00Z
---

# LLM-as-a-Verifier Skill
*Continuous scoring methodology for LLM output verification — granularity scaling, repeated evaluation, criteria decomposition, Probabilistic Pivot Tournament (PPT), and Value-Order Correlation (VOC) for progress monitoring. Based on arXiv:2607.05391v1.*

## Core Philosophy

Traditional LLM-as-a-Judge uses discrete ratings (1-5, pass/fail). This skill replaces discrete ratings with **continuous scores in [0, 1]** and adds three scaling axes that compound:

1. **Granularity (G)** — Score resolution: G=1 (binary) to G=20 (0.05 steps)
2. **Repeated Evaluation (K)** — Average K independent scores per sample
3. **Criteria Decomposition (C)** — Decompose into C sub-criteria, ensemble

**Key insight**: These three axes are independent and compound. G=20, K=16, C=3 gives ~78.5% accuracy on Terminal-Bench V2 vs ~73% baseline.

## Continuous Scoring Protocol

### Granularity Scaling (G)

Instead of discrete bins, ask the verifier to output a continuous score:

```
"Score this output on a continuous scale from 0.0 to 1.0, where:
  0.0 = completely incorrect / fails entirely
  0.5 = partially correct, significant issues
  1.0 = fully correct, production-ready
Output only the numeric score."
```

**Granularity levels:**
- G=1: Binary (0 or 1)
- G=5: 0.0, 0.25, 0.5, 0.75, 1.0
- G=10: 0.1 steps
- G=20: 0.05 steps (recommended default)

### Repeated Evaluation (K)

Run the same evaluation K times independently and average:

```
R_K(x, c) = (1/K) * Σ_k R^(k)(x, c)
```

Where R^(k) is the k-th independent evaluation of sample x on criterion c.

**Variance reduction:**
- Variance shrinks as O(1/K)
- K=4: ~50% variance reduction
- K=16: ~75% variance reduction
- Free-tier models benefit more (higher base variance)

### Criteria Decomposition (C)

Decompose the evaluation into C independent sub-criteria:

```
Final_Score(x) = (1/C) * Σ_c R_K(x, c)
```

**Example criteria for code review:**
1. Correctness — Does it solve the problem?
2. Security — Any vulnerabilities?
3. Readability — Clear, maintainable code?
4. Architecture — Fits the system design?
5. Performance — Efficient algorithms?

**Example criteria for UI review:**
1. Visual hierarchy — Clear information priority?
2. Interaction clarity — Obvious affordances?
3. Accessibility — WCAG AA compliance?
4. Responsiveness — Works at all breakpoints?
5. Polish — Micro-interactions, edge cases?

### Ensemble Formula

```
Score(x) = (1/C) * Σ_c [ (1/K) * Σ_k R^(k)(x, c) ]
```

**Recommended defaults:** G=20, K=4, C=3-5

## Probabilistic Pivot Tournament (PPT)

When comparing N candidate outputs, full round-robin is O(N²). PPT reduces to O(Nk) where k << N.

### Algorithm

1. **Select k pivots** from N candidates (k = min(8, ceil(sqrt(N))))
2. **Ring pass**: Each pivot compares against all N candidates (including other pivots)
3. **Pivot-pivot**: All k pivots compare against each other (k(k-1)/2 pairs)
4. **Score**: wins[i] / counts[i] for each candidate
5. **Select**: argmax of normalized score

### Total Comparisons

```
Total = k*N + k(k-1)/2
```

### Ring Pass Bias Cancellation

Positional bias (first/second position advantage) is canceled by the ring structure:

```
Pivot A vs Candidate B (A first)
Pivot B vs Candidate A (B first)
```

Each candidate appears in both positions against pivots, canceling systematic bias.

### PPT Budget Guide

| N (candidates) | k (pivots) | Total pairs | vs Round-Robin |
|---------------|------------|-------------|----------------|
| 3 | 2 | 5 | 3 (same, small N) |
| 5 | 3 | 14 | 10 (close at small N) |
| 10 | 4 | 46 | 45 (similar) |
| 20 | 5 | 130 | 190 (1.5x savings) |
| 50 | 8 | 634 | 1,225 (2x savings) |
| 100 | 10 | 1,405 | 4,950 (3.5x savings) |

For N < 10, full round-robin is fine. For N >= 10, PPT saves meaningful budget.

## Value-Order Correlation (VOC)

Track how verifier scores change across sequential steps as a proxy for task progress.

### Definition

```
VOC = Spearman_rank_correlation(
    argsort(scores_at_steps),
    step_indices
)
```

- **VOC → 1.0**: Score increases monotonically with steps — making progress
- **VOC → 0.0**: Score uncorrelated with steps — stalled or drifting
- **VOC < 0**: Score decreasing — regressing

### Usage

**Progress monitoring**: During a multi-step task (dev-loop iterations, code generation), score each prefix/intermediate state. Track VOC across states.

**Early warning**: If VOC drops below 0.5 after initial ramp-up, the agent is likely stuck. Intervene.

**Qualitative interpretation:**
- Successful trajectories: VOC ≈ 0.85 (near-monotonic progress)
- Failed trajectories: VOC ≈ 0.77 (weaker, inconsistent progress)
- Gap: ~0.08 Spearman points between success and failure

### Application to Dev-Loop

Track verifier score at each loop iteration. If scores plateau or decline for 2+ consecutive iterations, escalate or change approach.

## Bradley-Terry Preference Conversion

Convert continuous scores into pairwise preferences:

```
P(A ≻ B | task) = 1 / (1 + exp(-(R(A) - R(B))))
```

Where R(A) and R(B) are the continuous verifier scores (0-1 normalized).

- P > 0.5: A is preferred over B
- P = 0.5: Indistinguishable (rare with continuous scores)
- P < 0.5: B is preferred over A

This soft preference enables soft accumulation of wins (not just binary win/loss), preserving signal from close comparisons.

## Integration with Other Skills

### With code-review skill
- Replace discrete axis ratings with continuous scores (0.0-1.0)
- Use K=3 repeated evaluation per axis
- Ensemble C=5 axes into final quality score
- Use PPT when comparing multiple candidate implementations
- Use ring pass to cancel positional bias in pairwise comparison

### With dev-loop skill
- Generate N candidate implementations in parallel
- Use PPT to select best candidate before proceeding to review
- Track VOC across loop iterations as early-warning signal
- If VOC plateaus for 2+ iterations, escalate

### With testing skill
- Score test quality on continuous scale (coverage, edge cases, clarity)
- Decompose into sub-criteria: coverage depth, boundary testing, error handling, readability

## Calibration Notes

- Continuous scores are relative, not absolute. A score of 0.7 doesn't mean "70% correct" — it means "above average in this batch."
- Always normalize scores to [0, 1] for cross-task comparison.
- When comparing across different tasks, use preference probabilities (Bradley-Terry), not raw scores.
- Repeated evaluation helps most when the verifier model has high variance (free-tier models benefit more than frontier models).

## Scaling Properties (from paper)

| Axis | Baseline | With scaling | Gain |
|------|----------|-------------|------|
| Granularity G=1→20 | 73.1% | 77.5% | +4.4% |
| Repeated eval K=1→16 | 74.7% | 77.4% | +2.7% |
| Criteria C=1→3 | 75-76% | 78.3% | +2-3% |
| All combined | — | ~78.5% | +5.4% |

These are measured on Terminal-Bench V2 coding benchmarks. Gains compound across all three axes.

## Level History
- **Lv.1** — Base: Continuous scoring methodology, repeated evaluation, criteria decomposition.
- **Lv.2** — PPT: Probabilistic Pivot Tournament for multi-candidate selection with ring pass.
- **Lv.3** — VOC: Value-Order Correlation for progress monitoring and early warning.