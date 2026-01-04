#!/usr/bin/env python3
"""Build a trimmed bilingual dataset with alignment-based connected components.

Reads `sentence_pairs_sp_eng.tsv` (same format as the Flask app), filters out
profane/too-long sentences, computes SimAlign word alignments, then outputs a
compact JSON dataset:

{
  "es": ["No", "me", "gusta"],
  "en": ["I", "do", "not"],
  "groups": [ {"es": [0], "en": [2]}, ... ]
}

Output is JSONL by default (one object per line).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import DefaultDict, Iterable


@dataclass(frozen=True)
class Pair:
    sp_id: int
    en_id: int
    spanish: str
    english: str


def parse_tsv_pairs(path: Path) -> Iterable[Pair]:
    """Parse the TSV format used in this repo.

    Expected columns: sp_id, spanish, en_id, english
    """

    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            cols = line.split("\t")
            if len(cols) < 4:
                continue

            try:
                sp_id = int(cols[0])
                en_id = int(cols[2])
            except ValueError:
                continue

            spanish = cols[1].strip()
            english = cols[3].strip()
            if not spanish or not english:
                continue

            yield Pair(sp_id=sp_id, en_id=en_id, spanish=spanish, english=english)


def has_profanity(text: str) -> bool:
    """Return True if text contains profanity.

    Uses `better_profanity`, which is lightweight and Python 3.13 compatible.
    """

    try:
        from better_profanity import profanity  # type: ignore

        # Ensure default wordset is loaded.
        profanity.load_censor_words()
        return bool(profanity.contains_profanity(text))
    except Exception:
        # If the profanity library misbehaves on weird unicode, treat as profane
        # so we err on the side of skipping.
        return True


def compute_alignment_pairs(aligner, spanish: str, english: str) -> list[tuple[int, int]]:
    aligns = aligner.get_word_aligns(spanish, english)
    method = "mwmf" if "mwmf" in aligns else (next(iter(aligns.keys())) if aligns else "none")
    pairs = aligns.get(method) if aligns else None
    if not pairs:
        return []

    out: list[tuple[int, int]] = []
    for i, j in sorted(pairs):
        out.append((int(i), int(j)))
    return out


def build_groups(es_tokens: list[str], en_tokens: list[str], alignments: list[tuple[int, int]]):
    """Connected components in a bipartite graph.

    Nodes: ("es", i) and ("en", j)
    Edges: alignment pairs

    Returns: list of (sorted_es_indices, sorted_en_indices)
    """

    graph: DefaultDict[tuple[str, int], set[tuple[str, int]]] = defaultdict(set)

    for es_i, en_i in alignments:
        if not (0 <= es_i < len(es_tokens)):
            continue
        if not (0 <= en_i < len(en_tokens)):
            continue
        graph[("es", es_i)].add(("en", en_i))
        graph[("en", en_i)].add(("es", es_i))

    visited: set[tuple[str, int]] = set()
    groups: list[tuple[list[int], list[int]]] = []

    for node in list(graph.keys()):
        if node in visited:
            continue

        stack = [node]
        es_idxs: set[int] = set()
        en_idxs: set[int] = set()

        while stack:
            n = stack.pop()
            if n in visited:
                continue
            visited.add(n)

            lang, idx = n
            if lang == "es":
                es_idxs.add(idx)
            else:
                en_idxs.add(idx)

            for neigh in graph[n]:
                if neigh not in visited:
                    stack.append(neigh)

        groups.append((sorted(es_idxs), sorted(en_idxs)))

    # Ensure every token is represented at least once.
    # This allows the JS to always have a "current group" for any cursor position.
    used_es = {i for g in groups for i in g[0]}
    used_en = {j for g in groups for j in g[1]}

    for i in range(len(es_tokens)):
        if i not in used_es:
            groups.append(([i], []))

    for j in range(len(en_tokens)):
        if j not in used_en:
            groups.append(([], [j]))

    # Stable ordering: primarily by first ES index, then by first EN index.
    def key(g: tuple[list[int], list[int]]):
        es0 = g[0][0] if g[0] else 10**9
        en0 = g[1][0] if g[1] else 10**9
        return (es0, en0)

    groups.sort(key=key)
    return groups


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False))
            f.write("\n")


def write_json(path: Path, records: list[dict]) -> None:
    payload = {"items": records}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Build a trimmed bilingual dataset with bipartite connected-component groups.")
    ap.add_argument("--input", type=Path, default=Path("sentence_pairs_sp_eng.tsv"))
    ap.add_argument("--output", type=Path, default=Path("trimmed_sentence_groups.jsonl"))
    ap.add_argument("--limit", type=int, default=50_000, help="Read up to this many TSV lines")
    ap.add_argument("--max-chars", type=int, default=80, help="Skip sentences where either side exceeds this length")
    ap.add_argument("--method", type=str, default="mwmf", help="Preferred SimAlign method (mwmf/inter/itermax)")
    ap.add_argument("--json", action="store_true", help="Write a single JSON file (with {items:[...]}) instead of JSONL")
    args = ap.parse_args(argv)

    if args.limit <= 0:
        raise SystemExit("--limit must be > 0")

    try:
        from better_profanity import profanity  # type: ignore

        profanity.load_censor_words()
    except Exception as e:  # noqa: BLE001
        raise SystemExit(
            "Missing dependency 'better-profanity'. Install it (e.g. pip install better-profanity). "
            f"Import error: {e}"
        )

    try:
        from simalign import SentenceAligner
    except Exception as e:  # noqa: BLE001
        raise SystemExit(
            "Missing dependency 'simalign'. Install it (and its deps) to enable alignment. "
            f"Import error: {e}"
        )

    if not args.input.exists():
        raise SystemExit(f"Input not found: {args.input}")

    aligner = SentenceAligner(model="bert", token_type="bpe")

    read_n = 0
    kept = 0
    skip_profanity = 0
    skip_len = 0
    skip_errors = 0

    records: list[dict] = []

    def iter_records():
        nonlocal read_n, kept, skip_profanity, skip_len, skip_errors

        for pair in parse_tsv_pairs(args.input):
            if read_n >= args.limit:
                break
            read_n += 1

            if len(pair.spanish) > args.max_chars or len(pair.english) > args.max_chars:
                skip_len += 1
                continue

            if has_profanity(pair.spanish) or has_profanity(pair.english):
                skip_profanity += 1
                continue

            try:
                es_tokens = pair.spanish.split()
                en_tokens = pair.english.split()
                align_pairs = compute_alignment_pairs(aligner, pair.spanish, pair.english)

                groups = build_groups(es_tokens, en_tokens, align_pairs)
                groups_out = [{"es": es, "en": en} for (es, en) in groups]

                rec = {
                    "sp_id": pair.sp_id,
                    "en_id": pair.en_id,
                    "es": es_tokens,
                    "en": en_tokens,
                    "groups": groups_out,
                }

                kept += 1
                yield rec
            except Exception:
                skip_errors += 1
                continue

    if args.json:
        records = list(iter_records())
        write_json(args.output, records)
    else:
        write_jsonl(args.output, iter_records())

    print(
        json.dumps(
            {
                "lines_read": read_n,
                "kept": kept,
                "skipped_profanity": skip_profanity,
                "skipped_too_long": skip_len,
                "skipped_errors": skip_errors,
                "output": str(args.output),
                "format": "json" if args.json else "jsonl",
            },
            ensure_ascii=False,
        ),
        file=sys.stderr,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
