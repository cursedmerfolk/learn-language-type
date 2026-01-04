#!/usr/bin/env python3
"""Convert this repo's TSV sentence pairs to awesome-align input format.

Input TSV format (as in `sentence_pairs_sp_eng.tsv`):
  sp_id <TAB> spanish <TAB> en_id <TAB> english

awesome-align expects one sentence-pair per line:
  spanish_tokenized_sentence ||| english_tokenized_sentence

This script also optionally writes a sidecar JSONL file with IDs in the same
line order so later stages can reattach `sp_id`/`en_id`.

Example:
  ./tools/tsv_to_awesome_align.py \
    --input sentence_pairs_sp_eng.tsv \
    --output sp_en.txt \
    --meta sp_en_meta.jsonl
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator


@dataclass(frozen=True)
class Pair:
    sp_id: int
    en_id: int
    spanish: str
    english: str


def iter_tsv_pairs(path: Path, limit: int | None) -> Iterator[Pair]:
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line_idx, line in enumerate(f, start=1):
            if limit is not None and limit >= 0 and line_idx > limit:
                return

            s = line.rstrip("\n")
            if not s:
                continue
            cols = s.split("\t")
            if len(cols) < 4:
                continue

            # Some TSV sources include a UTF-8 BOM on the first line.
            cols[0] = cols[0].lstrip("\ufeff")

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


def tokenize_whitespace(text: str) -> list[str]:
    # awesome-align wants whitespace-tokenized sentences.
    # We keep punctuation attached to the token (same as your current dataset).
    return [t for t in text.strip().split() if t]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Convert sentence_pairs_sp_eng.tsv to awesome-align input format")
    ap.add_argument("--input", type=Path, default=Path("sentence_pairs_sp_eng.tsv"))
    ap.add_argument("--output", type=Path, default=Path("sp_en.txt"))
    ap.add_argument(
        "--meta",
        type=Path,
        default=Path("sp_en_meta.jsonl"),
        help="Optional sidecar JSONL mapping (sp_id/en_id) aligned by line number",
    )
    ap.add_argument(
        "--no-meta",
        action="store_true",
        help="Do not write the sidecar meta JSONL file",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Read at most this many TSV lines (default: all)",
    )
    args = ap.parse_args(argv)

    if not args.input.exists():
        raise SystemExit(f"Input not found: {args.input}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    if not args.no_meta:
        args.meta.parent.mkdir(parents=True, exist_ok=True)

    n_written = 0
    n_skipped = 0

    meta_f = None
    try:
        with args.output.open("w", encoding="utf-8") as out_f:
            if not args.no_meta:
                meta_f = args.meta.open("w", encoding="utf-8")

            for pair in iter_tsv_pairs(args.input, args.limit):
                es_toks = tokenize_whitespace(pair.spanish)
                en_toks = tokenize_whitespace(pair.english)
                if not es_toks or not en_toks:
                    n_skipped += 1
                    continue

                out_f.write(" ".join(es_toks))
                out_f.write(" ||| ")
                out_f.write(" ".join(en_toks))
                out_f.write("\n")

                if meta_f is not None:
                    meta_f.write(json.dumps({"sp_id": pair.sp_id, "en_id": pair.en_id}, ensure_ascii=False))
                    meta_f.write("\n")

                n_written += 1

    finally:
        if meta_f is not None:
            meta_f.close()

    print(f"Wrote {n_written} pairs to {args.output}")
    if not args.no_meta:
        print(f"Wrote meta mapping to {args.meta}")
    if n_skipped:
        print(f"Skipped {n_skipped} empty-token lines")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
