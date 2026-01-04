#!/usr/bin/env python3
"""Build the web-app JSONL dataset from awesome-align outputs.

Inputs:
- `sp_en.txt`: one sentence pair per line in awesome-align format:
    spanish_tokenized_sentence ||| english_tokenized_sentence

- `output-aligned.txt`: one line per sentence pair with alignment edges:
    0-0 2-1 3-2

Optional:
- `sp_en_meta.jsonl`: one JSON object per line with ids aligned to line number:
    {"sp_id": 2483, "en_id": 16492}

Output:
- JSONL records compatible with the learn-language web app:

  {
    "sp_id": 2483,
    "en_id": 16492,
    "es": ["¿Qué", "estás", "haciendo?"],
    "en": ["What", "are", "you", "doing?"],
    "groups": [ {"es": [0], "en": [0]}, ... ]
  }

Grouping logic:
- Build a bipartite graph from alignment edges (es_i <-> en_j)
- Connected components become "groups"
- Ensure every token appears in at least one group by adding singleton groups
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import DefaultDict, Iterable, Iterator


@dataclass(frozen=True)
class Meta:
    sp_id: int | None
    en_id: int | None


def parse_data_line(line: str) -> tuple[list[str], list[str]] | None:
    s = line.strip("\n")
    if not s:
        return None
    if "|||" not in s:
        return None
    left, right = s.split("|||", 1)
    es = [t for t in left.strip().split() if t]
    en = [t for t in right.strip().split() if t]
    if not es or not en:
        return None
    return es, en


def parse_align_line(line: str) -> list[tuple[int, int]]:
    s = line.strip()
    if not s:
        return []
    out: list[tuple[int, int]] = []
    for part in s.split():
        if "-" not in part:
            continue
        a, b = part.split("-", 1)
        try:
            i = int(a)
            j = int(b)
        except ValueError:
            continue
        out.append((i, j))
    return out


def iter_meta(path: Path) -> Iterator[Meta]:
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            try:
                obj = json.loads(s)
            except Exception:
                yield Meta(sp_id=None, en_id=None)
                continue

            sp_id = obj.get("sp_id")
            en_id = obj.get("en_id")
            try:
                sp_id_n = int(sp_id) if sp_id is not None else None
            except Exception:
                sp_id_n = None
            try:
                en_id_n = int(en_id) if en_id is not None else None
            except Exception:
                en_id_n = None
            yield Meta(sp_id=sp_id_n, en_id=en_id_n)


def build_groups_components(es_tokens: list[str], en_tokens: list[str], alignments: list[tuple[int, int]]):
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

    def key(g: tuple[list[int], list[int]]):
        es0 = g[0][0] if g[0] else 10**9
        en0 = g[1][0] if g[1] else 10**9
        return (es0, en0)

    groups.sort(key=key)
    return groups


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False))
            f.write("\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build trimmed_sentence_groups.jsonl from awesome-align output")
    ap.add_argument("--data", type=Path, default=Path("sp_en.txt"))
    ap.add_argument("--aligned", type=Path, default=Path("output-aligned.txt"))
    ap.add_argument("--meta", type=Path, default=Path("sp_en_meta.jsonl"))
    ap.add_argument("--no-meta", action="store_true", help="Do not read meta mapping; omit sp_id/en_id")
    ap.add_argument("--output", type=Path, default=Path("trimmed_sentence_groups.jsonl"))
    ap.add_argument("--limit", type=int, default=None, help="Process at most this many lines")
    ap.add_argument(
        "--allow-duplicate-spanish",
        action="store_true",
        help="Allow duplicate Spanish sentences (by tokenized Spanish side). Default: dedupe and keep first occurrence.",
    )
    ap.add_argument(
        "--allow-empty-groups",
        action="store_true",
        help=(
            "Allow records where some tokens are unaligned (which would otherwise result in groups with empty es/en lists). "
            "Default: drop such records entirely."
        ),
    )
    args = ap.parse_args(argv)

    if not args.data.exists():
        raise SystemExit(f"Data file not found: {args.data}")
    if not args.aligned.exists():
        raise SystemExit(f"Aligned file not found: {args.aligned}")

    meta_iter: Iterator[Meta] | None = None
    if not args.no_meta and args.meta.exists():
        meta_iter = iter_meta(args.meta)

    records: list[dict] = []
    n_read = 0
    n_written = 0
    n_dup_es = 0
    n_dropped_empty_group = 0
    seen_es: set[str] = set()

    with args.data.open("r", encoding="utf-8", errors="replace") as data_f, args.aligned.open(
        "r", encoding="utf-8", errors="replace"
    ) as aligned_f:
        for data_line, align_line in zip(data_f, aligned_f):
            if args.limit is not None and args.limit >= 0 and n_read >= args.limit:
                break

            n_read += 1
            parsed = parse_data_line(data_line)
            if not parsed:
                continue
            es_tokens, en_tokens = parsed

            if not args.allow_duplicate_spanish:
                es_key = " ".join(es_tokens)
                if es_key in seen_es:
                    n_dup_es += 1
                    # Consume the aligned/meta line but skip emitting this record.
                    if meta_iter is not None:
                        try:
                            next(meta_iter)
                        except StopIteration:
                            meta_iter = None
                    continue
                seen_es.add(es_key)

            alignments = parse_align_line(align_line)

            groups = build_groups_components(es_tokens, en_tokens, alignments)

            if not args.allow_empty_groups:
                # Drop entries that would require adding singleton groups with empty es/en.
                used_es = {i for g in groups for i in g[0]}
                used_en = {j for g in groups for j in g[1]}
                if len(used_es) != len(es_tokens) or len(used_en) != len(en_tokens):
                    n_dropped_empty_group += 1
                    if meta_iter is not None:
                        try:
                            next(meta_iter)
                        except StopIteration:
                            meta_iter = None
                    continue

                # Also guard against any unexpected empty-sided group.
                if any((not g[0]) or (not g[1]) for g in groups):
                    n_dropped_empty_group += 1
                    if meta_iter is not None:
                        try:
                            next(meta_iter)
                        except StopIteration:
                            meta_iter = None
                    continue

            sp_id = None
            en_id = None
            if meta_iter is not None:
                try:
                    m = next(meta_iter)
                    sp_id, en_id = m.sp_id, m.en_id
                except StopIteration:
                    meta_iter = None

            rec: dict = {
                "es": es_tokens,
                "en": en_tokens,
                "groups": [{"es": es_idxs, "en": en_idxs} for (es_idxs, en_idxs) in groups],
            }
            if sp_id is not None:
                rec["sp_id"] = sp_id
            if en_id is not None:
                rec["en_id"] = en_id

            records.append(rec)
            n_written += 1

    if n_read == 0:
        raise SystemExit("No lines read. Check input files.")

    write_jsonl(args.output, records)
    print(f"Read {n_read} lines")
    print(f"Wrote {n_written} records to {args.output}")
    if n_dup_es and not args.allow_duplicate_spanish:
        print(f"Skipped {n_dup_es} duplicate Spanish sentences")
    if n_dropped_empty_group and not args.allow_empty_groups:
        print(f"Dropped {n_dropped_empty_group} records due to empty-sided groups")

    if not args.no_meta and not args.meta.exists():
        print(f"Note: meta file not found ({args.meta}); output omitted sp_id/en_id")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
