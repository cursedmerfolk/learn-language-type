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


def _chunk_text(lines: list[str], min_lines: int = 6, max_lines: int = 16) -> list[tuple[int, int, str]]:
    if not lines:
        return []

    chunks: list[tuple[int, int, str]] = []
    i = 0
    n = len(lines)
    while i < n:
        # Skip leading empty lines to avoid boring chunks.
        while i < n and lines[i].strip() == "":
            i += 1
        if i >= n:
            break

        length = random.randint(min_lines, max_lines)
        start = i
        end = min(n, i + length)
        text = "".join(lines[start:end]).rstrip("\n")

        if text.strip():
            chunks.append((start + 1, end, text))
        i = end

    return chunks


def load_all_chunks() -> list[Chunk]:
    chunks: list[Chunk] = []

    for file_path in _iter_source_files():
        try:
            raw = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        raw = _normalize_newlines(raw)
        lines = [line + "\n" for line in raw.split("\n")]
        # split("\n") loses trailing newline; restore consistent lines
        if lines and lines[-1] == "\n":
            lines = lines[:-1]

        for start_line, end_line, text in _chunk_text(lines):
            digest = hashlib.sha1(
                (str(file_path.relative_to(BASE_DIR)) + "\n" + f"{start_line}:{end_line}" + "\n" + text).encode(
                    "utf-8", errors="replace"
                )
            ).hexdigest()[:12]
            chunks.append(
                Chunk(
                    id=digest,
                    filename=str(file_path.relative_to(BASE_DIR)),
                    start_line=start_line,
                    end_line=end_line,
                    text=text,
                )
            )

    return chunks


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/chunk/random")
    def api_chunk_random():
        chunks = load_all_chunks()
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
                        "filename": c.filename,
                        "start_line": c.start_line,
                        "end_line": c.end_line,
                        "text": c.text,
                    }
                )

        return jsonify({"error": "Chunk not found"}), 404

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=True)
