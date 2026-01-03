#!/usr/bin/env python3
"""Strip C comments and "unused" whitespace from source files.

- Input: a directory containing .c/.h files (recursively)
- Output: a directory where cleaned copies are written, preserving subfolders

Removes:
- // line comments
- /* block comments */ (preserves newlines inside the comment)

Whitespace cleanup:
- Normalize newlines to \n
- Remove trailing whitespace on each line
- Collapse multiple consecutive blank lines down to a single blank line
- Remove leading/trailing blank lines

This is intended for typing-practice sources, not as a full C preprocessor.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Stats:
    files_processed: int = 0
    files_skipped: int = 0
    bytes_in: int = 0
    bytes_out: int = 0


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def strip_c_comments(text: str) -> str:
    """Remove C/C++ comments while respecting string/char literals."""

    NORMAL = 0
    IN_STRING = 1
    IN_CHAR = 2
    IN_SL_COMMENT = 3
    IN_ML_COMMENT = 4

    state = NORMAL
    out: list[str] = []

    i = 0
    n = len(text)

    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""

        if state == NORMAL:
            if ch == '"':
                state = IN_STRING
                out.append(ch)
                i += 1
                continue
            if ch == "'":
                state = IN_CHAR
                out.append(ch)
                i += 1
                continue
            if ch == "/" and nxt == "/":
                state = IN_SL_COMMENT
                i += 2
                continue
            if ch == "/" and nxt == "*":
                state = IN_ML_COMMENT
                i += 2
                continue

            out.append(ch)
            i += 1
            continue

        if state == IN_STRING:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                # escape next char
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                state = NORMAL
            i += 1
            continue

        if state == IN_CHAR:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == "'":
                state = NORMAL
            i += 1
            continue

        if state == IN_SL_COMMENT:
            # consume until newline, but preserve newline
            if ch == "\n":
                out.append("\n")
                state = NORMAL
            i += 1
            continue

        if state == IN_ML_COMMENT:
            # preserve newlines to keep line structure somewhat stable
            if ch == "\n":
                out.append("\n")
                i += 1
                continue
            if ch == "*" and nxt == "/":
                state = NORMAL
                i += 2
                continue
            i += 1
            continue

    return "".join(out)


def cleanup_whitespace(text: str) -> str:
    # Trim trailing whitespace
    lines = text.split("\n")
    lines = [ln.rstrip(" \t") for ln in lines]

    # Remove leading/trailing blank lines
    while lines and lines[0].strip() == "":
        lines.pop(0)
    while lines and lines[-1].strip() == "":
        lines.pop()

    # Collapse multiple blank lines
    cleaned: list[str] = []
    blank_run = 0
    for ln in lines:
        if ln.strip() == "":
            blank_run += 1
            if blank_run <= 1:
                cleaned.append("")
        else:
            blank_run = 0
            cleaned.append(ln)

    return "\n".join(cleaned) + "\n" if cleaned else ""


def should_process(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in {".c", ".h", ".html"}


def process_file(src: Path, dst: Path) -> tuple[int, int]:
    raw = src.read_text(encoding="utf-8", errors="replace")
    raw = normalize_newlines(raw)

    stripped = strip_c_comments(raw)
    cleaned = cleanup_whitespace(stripped)

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(cleaned, encoding="utf-8")

    return len(raw.encode("utf-8", errors="replace")), len(cleaned.encode("utf-8", errors="replace"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Strip comments and whitespace from C sources.")
    parser.add_argument("--in", dest="in_dir", default="sources", help="Input directory (default: sources)")
    parser.add_argument(
        "--out",
        dest="out_dir",
        default="sources_stripped",
        help="Output directory (default: sources_stripped)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow writing into an existing output directory",
    )

    args = parser.parse_args()

    in_dir = Path(args.in_dir).resolve()
    out_dir = Path(args.out_dir).resolve()

    if not in_dir.exists() or not in_dir.is_dir():
        raise SystemExit(f"Input directory not found: {in_dir}")

    if out_dir.exists() and not args.overwrite:
        raise SystemExit(
            f"Output directory already exists: {out_dir}\n"
            "Use --overwrite or choose a different --out directory."
        )

    stats = Stats()

    for path in sorted(in_dir.rglob("*")):
        if not should_process(path):
            continue

        rel = path.relative_to(in_dir)
        dst = out_dir / rel

        bytes_in, bytes_out = process_file(path, dst)
        stats = Stats(
            files_processed=stats.files_processed + 1,
            files_skipped=stats.files_skipped,
            bytes_in=stats.bytes_in + bytes_in,
            bytes_out=stats.bytes_out + bytes_out,
        )

    print(
        f"Processed {stats.files_processed} file(s). "
        f"Bytes: {stats.bytes_in} -> {stats.bytes_out}"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
