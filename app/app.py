from __future__ import annotations

import hashlib
import os
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent.parent
SOURCES_DIR = BASE_DIR / "sources"
SHADERS_DIR = BASE_DIR / "webgl-shader-examples" / "shaders"
WEB_CONTENT_DIR = BASE_DIR / "webgl-shader-examples" / "WebContent"


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


def _safe_resolve_shader(name: str) -> Path | None:
    if not name:
        return None
    candidate = (SHADERS_DIR / name).resolve()
    shaders_root = SHADERS_DIR.resolve()
    if candidate == shaders_root or shaders_root not in candidate.parents:
        return None
    if not candidate.is_file() or candidate.suffix.lower() != ".glsl":
        return None
    return candidate


def _iter_shaders() -> Iterable[str]:
    if not SHADERS_DIR.exists():
        return []
    for p in sorted(SHADERS_DIR.glob("*.glsl")):
        # Focus on the example shaders, not helper modules.
        if p.name.startswith("frag-") or p.name.startswith("vert-"):
            yield p.name


def _safe_resolve_example(name: str) -> Path | None:
    if not name:
        return None
    candidate = (WEB_CONTENT_DIR / name).resolve()
    root = WEB_CONTENT_DIR.resolve()
    if candidate == root or root not in candidate.parents:
        return None
    if not candidate.is_file() or candidate.suffix.lower() != ".html":
        return None
    return candidate


_ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"', re.IGNORECASE)


def _parse_attrs(attr_text: str) -> dict[str, str]:
    return {m.group(1).lower(): m.group(2) for m in _ATTR_RE.finditer(attr_text)}


_SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.IGNORECASE | re.DOTALL)


def _extract_inline_shaders(html_text: str) -> dict[str, dict[str, str]]:
    """Extract inline shader script tags.

    Returns a mapping like:
      {
        "vertex": {"vertexShader": "..."},
        "fragment": {"fragmentShader": "..."},
      }
    """

    out: dict[str, dict[str, str]] = {"vertex": {}, "fragment": {}}
    for m in _SCRIPT_RE.finditer(html_text):
        attrs = _parse_attrs(m.group(1) or "")
        typ = (attrs.get("type") or "").strip().lower()
        sid = (attrs.get("id") or "").strip() or None
        body = _normalize_newlines(m.group(2) or "").strip("\n")

        if typ == "x-shader/x-vertex":
            out["vertex"][sid or f"vertex_{len(out['vertex'])}"] = body
        elif typ == "x-shader/x-fragment":
            out["fragment"][sid or f"fragment_{len(out['fragment'])}"] = body

    return out


def _pick_vertex_fragment_pair(shaders: dict[str, dict[str, str]]) -> tuple[str, str, str, str] | None:
    verts = shaders.get("vertex") or {}
    frags = shaders.get("fragment") or {}
    if not verts or not frags:
        return None

    # Prefer the canonical IDs used by these examples.
    v_id = "vertexShader" if "vertexShader" in verts else sorted(verts.keys())[0]
    f_id = "fragmentShader" if "fragmentShader" in frags else sorted(frags.keys())[0]
    return v_id, verts[v_id], f_id, frags[f_id]


def _iter_examples() -> Iterable[str]:
    if not WEB_CONTENT_DIR.exists():
        return []
    for p in sorted(WEB_CONTENT_DIR.glob("*.html")):
        yield p.name


def _iter_examples_with_pairs() -> Iterable[str]:
    for name in _iter_examples():
        path = _safe_resolve_example(name)
        if not path:
            continue
        try:
            html_text = _normalize_newlines(path.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        pair = _pick_vertex_fragment_pair(_extract_inline_shaders(html_text))
        if pair:
            yield name


def _find_examples_referencing_shader(shader_name: str) -> list[str]:
    # A simple substring search is enough for this repo's nav links.
    needle = f"/shaders/{shader_name}"
    matches: list[str] = []
    for name in _iter_examples():
        path = _safe_resolve_example(name)
        if not path:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if needle in text or shader_name in text:
            matches.append(name)
    return sorted(set(matches))


def _find_glslify_export_symbol(text: str) -> str | None:
    # Example: #pragma glslify: export(cnoise)
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("#pragma glslify:") and "export(" in line:
            start = line.find("export(") + len("export(")
            end = line.find(")", start)
            if end != -1:
                sym = line[start:end].strip()
                if sym:
                    return sym
    return None


def _preprocess_glsl(path: Path, *, _stack: set[Path] | None = None) -> str:
    """A tiny subset of glslify, enough for this repo.

    Handles:
      - #pragma glslify: import("./imports/foo.glsl")
      - #pragma glslify: alias = require("./requires/bar")
      - #pragma glslify: export(name)   (removed)

    For require(), we inline the module then add: #define alias <exported_symbol>.
    """

    stack = _stack or set()
    if path in stack:
        raise ValueError(f"Cyclic shader import detected: {path.name}")
    stack.add(path)

    raw = _normalize_newlines(path.read_text(encoding="utf-8", errors="replace"))
    out_lines: list[str] = []

    for line in raw.split("\n"):
        stripped = line.strip()

        if stripped.startswith("#pragma glslify:"):
            rest = stripped[len("#pragma glslify:") :].strip()

            # import("...")
            if rest.startswith("import("):
                q1 = rest.find('"')
                q2 = rest.rfind('"')
                if q1 != -1 and q2 != -1 and q2 > q1:
                    rel = rest[q1 + 1 : q2]
                    inc = (path.parent / rel).resolve()
                    out_lines.append(_preprocess_glsl(inc, _stack=stack))
                    continue

            # alias = require("...")
            if "= require(" in rest:
                left, right = rest.split("=", 1)
                alias = left.strip()
                q1 = right.find('"')
                q2 = right.rfind('"')
                if alias and q1 != -1 and q2 != -1 and q2 > q1:
                    rel = right[q1 + 1 : q2]
                    inc = (path.parent / (rel + ("" if rel.endswith(".glsl") else ".glsl"))).resolve()
                    inc_text = _preprocess_glsl(inc, _stack=stack)
                    out_lines.append(inc_text)

                    export_sym = _find_glslify_export_symbol(
                        _normalize_newlines(inc.read_text(encoding="utf-8", errors="replace"))
                    )
                    if export_sym and export_sym != alias:
                        out_lines.append(f"#define {alias} {export_sym}")
                    continue

            # export(...) and any other glslify pragmas are removed
            continue

        out_lines.append(line)

    stack.remove(path)
    return "\n".join(out_lines)


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

    @app.get("/api/shader")
    def api_shader_by_name():
        name = request.args.get("name", "").strip()
        path = _safe_resolve_shader(name)
        if not path:
            return jsonify({"error": "Invalid shader name"}), 400

        try:
            text = _preprocess_glsl(path)
        except (OSError, ValueError) as e:
            return jsonify({"error": str(e)}), 400

        # WebGL fragment shaders generally need a precision qualifier.
        if name.startswith("frag-") and "precision " not in text:
            text = "precision mediump float;\n" + text

        line_count = text.count("\n") + 1
        shader_id = hashlib.sha1((name + "\n" + text).encode("utf-8", errors="replace")).hexdigest()[:12]

        return jsonify(
            {
                "id": shader_id,
                "shader": name,
                "text": text,
                "start_line": 1,
                "end_line": line_count,
            }
        )

    @app.get("/api/shader/random")
    def api_shader_random():
        shaders = list(_iter_shaders())
        if not shaders:
            return jsonify({"error": "No shaders found in webgl-shader-examples/shaders"}), 400
        name = random.choice(shaders)
        path = _safe_resolve_shader(name)
        if not path:
            return jsonify({"error": "Invalid shader name"}), 400

        try:
            text = _preprocess_glsl(path)
        except (OSError, ValueError) as e:
            return jsonify({"error": str(e)}), 400

        if name.startswith("frag-") and "precision " not in text:
            text = "precision mediump float;\n" + text

        line_count = text.count("\n") + 1
        shader_id = hashlib.sha1((name + "\n" + text).encode("utf-8", errors="replace")).hexdigest()[:12]

        return jsonify(
            {
                "id": shader_id,
                "shader": name,
                "text": text,
                "start_line": 1,
                "end_line": line_count,
            }
        )

    @app.get("/api/example")
    def api_example_by_name():
        name = request.args.get("name", "").strip()
        path = _safe_resolve_example(name)
        if not path:
            return jsonify({"error": "Invalid example name"}), 400

        try:
            html_text = _normalize_newlines(path.read_text(encoding="utf-8", errors="replace"))
        except OSError as e:
            return jsonify({"error": str(e)}), 400

        shaders = _extract_inline_shaders(html_text)
        pair = _pick_vertex_fragment_pair(shaders)
        if not pair:
            return jsonify({"error": "No inline vertex/fragment shader pair found"}), 400

        v_id, v_text, f_id, f_text = pair

        # Ensure fragment has a precision qualifier for WebGL1.
        if "precision " not in f_text:
            f_text = "precision mediump float;\n" + f_text

        example_id = hashlib.sha1(
            (name + "\n" + v_id + "\n" + v_text + "\n" + f_id + "\n" + f_text).encode("utf-8", errors="replace")
        ).hexdigest()[:12]

        line_count = f_text.count("\n") + 1
        return jsonify(
            {
                "id": example_id,
                "example": name,
                "vertex_id": v_id,
                "vertex": v_text,
                "fragment_id": f_id,
                "fragment": f_text,
                # The typing target is the fragment shader.
                "typed_kind": "fragment",
                "typed_id": f_id,
                "start_line": 1,
                "end_line": line_count,
            }
        )

    @app.get("/api/example/random")
    def api_example_random():
        names = list(_iter_examples_with_pairs())
        if not names:
            return jsonify({"error": "No WebContent examples with inline vertex/fragment shaders found"}), 400
        name = random.choice(names)
        # Delegate to the by-name loader.
        path = _safe_resolve_example(name)
        if not path:
            return jsonify({"error": "Invalid example name"}), 400

        html_text = _normalize_newlines(path.read_text(encoding="utf-8", errors="replace"))
        shaders = _extract_inline_shaders(html_text)
        pair = _pick_vertex_fragment_pair(shaders)
        if not pair:
            return jsonify({"error": "No inline vertex/fragment shader pair found"}), 400
        v_id, v_text, f_id, f_text = pair

        if "precision " not in f_text:
            f_text = "precision mediump float;\n" + f_text

        example_id = hashlib.sha1(
            (name + "\n" + v_id + "\n" + v_text + "\n" + f_id + "\n" + f_text).encode("utf-8", errors="replace")
        ).hexdigest()[:12]
        line_count = f_text.count("\n") + 1
        return jsonify(
            {
                "id": example_id,
                "example": name,
                "vertex_id": v_id,
                "vertex": v_text,
                "fragment_id": f_id,
                "fragment": f_text,
                "typed_kind": "fragment",
                "typed_id": f_id,
                "start_line": 1,
                "end_line": line_count,
            }
        )

    @app.get("/api/example/resolve")
    def api_example_resolve_by_shader():
        shader_name = request.args.get("shader", "").strip()
        if not shader_name:
            return jsonify({"error": "Missing shader"}), 400
        matches = _find_examples_referencing_shader(shader_name)
        # Prefer the first deterministically.
        chosen = matches[0] if matches else None
        return jsonify({"shader": shader_name, "example": chosen, "matches": matches})

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=True)
