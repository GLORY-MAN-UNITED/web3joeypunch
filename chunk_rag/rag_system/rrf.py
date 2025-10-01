"""
rrf.py
------

Reciprocal Rank Fusion (RRF) is a simple yet effective method for
combining ranked lists from multiple retrieval systems.  It assigns
each document a score based on the reciprocal of its rank (plus a
constant) in each list and sums these scores across lists.  The
document with the highest total score is ranked first in the fused
list.

This module implements a reference RRF algorithm with sensible
defaults.  It operates on lists of document identifiers and produces a
single ranked list of identifiers.  You can pass optional per‑method
weights to emphasise one retrieval system over another.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Sequence, Tuple


def reciprocal_rank_fusion(
    runs: Sequence[Sequence[str]],
    k: int = 60,
    weights: Optional[Sequence[float]] = None,
) -> List[Tuple[str, float]]:
    """Fuse multiple ranked lists using Reciprocal Rank Fusion (RRF).

    Parameters
    ----------
    runs : sequence of sequences
        Each element of ``runs`` is a ranked list of document IDs
        returned by one retrieval method.  The first element in a
        list is considered the top document.
    k : int, optional
        The RRF constant.  Larger values reduce the influence of
        lower ranks.  Defaults to 60 as suggested in the literature.
    weights : sequence of floats, optional
        Optional weights to multiply each system's contribution.  Must
        be the same length as ``runs``.  If omitted, all systems are
        weighted equally.

    Returns
    -------
    list of (str, float)
        A list of tuples containing the document ID and its RRF score,
        sorted in descending order of score.

    Notes
    -----
    RRF is robust to noisy lists and does not require normalisation
    across systems.  It works particularly well when combining
    fundamentally different retrieval strategies (e.g. lexical and
    vector based).
    """
    if not runs:
        return []
    if weights is not None and len(weights) != len(runs):
        raise ValueError("Length of weights must match number of runs")
    # Default to equal weights
    if weights is None:
        weights = [1.0 for _ in runs]
    # Aggregate scores
    scores: Dict[str, float] = {}
    for run_idx, run in enumerate(runs):
        weight = weights[run_idx]
        for rank, doc_id in enumerate(run):
            # RRF score contribution: weight / (k + rank)
            scores[doc_id] = scores.get(doc_id, 0.0) + weight / (k + rank + 1)
    # Sort by descending score
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)