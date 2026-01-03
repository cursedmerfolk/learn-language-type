from __future__ import annotations

import hashlib
import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent.parent
SOURCES_DIR = BASE_DIR / "sources"


@dataclass(frozen=True)
class Chunk:
    id: str
    page: str
    filename: str
    start_line: int
    end_line: int
    text: str


def _is_source_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in {".c", ".h"}


def _iter_source_files() -> Iterable[Path]:
    if not SOURCES_DIR.exists():
        return []
    for path in sorted(SOURCES_DIR.rglob("*")):
        if _is_source_file(path):
            yield path


def _normalize_newlines(text: str) -> str:
    # Keep \n as canonical newlines for consistent chunk hashing/scoring.
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _chunk_text_fixed(lines: list[str], lines_per_chunk: int = 12) -> list[tuple[int, int, str]]:
    """Split into deterministic fixed-size line windows.

    Important: this must be deterministic so chunk IDs remain stable across requests.
    """

    if not lines:
        return []

    chunks: list[tuple[int, int, str]] = []
    n = len(lines)
    i = 0
    while i < n:
        start = i
        end = min(n, i + lines_per_chunk)
        text = "".join(lines[start:end]).rstrip("\n")
        chunks.append((start + 1, end, text))
        i = end

    return chunks


def _load_chunks_for_file(file_path: Path) -> list[Chunk]:
    try:
        raw = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []

    raw = _normalize_newlines(raw)
    lines = [line + "\n" for line in raw.split("\n")]
    # split("\n") loses trailing newline; restore consistent lines
    if lines and lines[-1] == "\n":
        lines = lines[:-1]

    page = str(file_path.relative_to(SOURCES_DIR))
    filename = str(file_path.relative_to(BASE_DIR))

    chunks: list[Chunk] = []
    for start_line, end_line, text in _chunk_text_fixed(lines):
        digest = hashlib.sha1(
            (page + "\n" + f"{start_line}:{end_line}" + "\n" + text).encode("utf-8", errors="replace")
        ).hexdigest()[:12]
        chunks.append(
            Chunk(
                id=digest,
                page=page,
                filename=filename,
                start_line=start_line,
                end_line=end_line,
                text=text,
            )
        )

    return chunks


def load_all_chunks() -> list[Chunk]:
    chunks: list[Chunk] = []

    for file_path in _iter_source_files():
        chunks.extend(_load_chunks_for_file(file_path))

    return chunks


def _safe_resolve_source(page: str) -> Path | None:
    if not page:
        return None
    # Prevent absolute paths and traversal.
    candidate = (SOURCES_DIR / page).resolve()
    sources_root = SOURCES_DIR.resolve()
    if candidate == sources_root or sources_root not in candidate.parents:
        return None
    if not _is_source_file(candidate):
        return None
    return candidate


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/chunk/random")
    def api_chunk_random():
        chunks = [c for c in load_all_chunks() if c.text.strip()]
        if not chunks:
            return jsonify(
                {
                    "error": "No source chunks found. Put .c/.h files in ./sources",
                }
            ), 400

        chunk = random.choice(chunks)
        return jsonify(
            {
                "id": chunk.id,
                "page": chunk.page,
                "filename": chunk.filename,
                "start_line": chunk.start_line,
                "end_line": chunk.end_line,
                "text": chunk.text,
            }
        )

    @app.get("/api/chunk")
    def api_chunk_by_id():
        chunk_id = request.args.get("id", "").strip()
        if not chunk_id:
            return jsonify({"error": "Missing id"}), 400

        chunks = load_all_chunks()
        for c in chunks:
            if c.id == chunk_id:
                return jsonify(
                    {
                        "id": c.id,
                        "page": c.page,
                        "filename": c.filename,
                        "start_line": c.start_line,
                        "end_line": c.end_line,
                        "text": c.text,
                    }
                )

        return jsonify({"error": "Chunk not found"}), 404

    @app.get("/api/chunk/loc")
    def api_chunk_by_location():
        page = request.args.get("page", "").strip()
        line_raw = request.args.get("line", "1").strip()

        file_path = _safe_resolve_source(page)
        if not file_path:
            return jsonify({"error": "Invalid page"}), 400

        try:
            line = int(line_raw)
        except ValueError:
            return jsonify({"error": "Invalid line"}), 400
        if line < 1:
            line = 1

        chunks = _load_chunks_for_file(file_path)
        if not chunks:
            return jsonify({"error": "No chunks for page"}), 404

        # Clamp line to file end for convenience.
        last_end = chunks[-1].end_line
        if line > last_end:
            line = last_end

        chosen: Chunk | None = None
        for c in chunks:
            if c.start_line <= line <= c.end_line:
                chosen = c
                break

        if not chosen:
            chosen = chunks[0]

        return jsonify(
            {
                "id": chosen.id,
                "page": chosen.page,
                "filename": chosen.filename,
                "start_line": chosen.start_line,
                "end_line": chosen.end_line,
                "text": chosen.text,
            }
        )

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=True)
