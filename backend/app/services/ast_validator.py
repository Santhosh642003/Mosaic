"""Post-merge AST/syntax validation (Guard 3 MVP)."""

import ast
import logging
import subprocess
import tempfile
import os

logger = logging.getLogger(__name__)

_JS_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
_PYTHON_EXTENSIONS = {".py"}


def _validate_python(path: str, content: str) -> str | None:
    """Return error string if Python content fails to parse, else None."""
    try:
        ast.parse(content, filename=path)
        return None
    except SyntaxError as exc:
        return f"SyntaxError at line {exc.lineno}: {exc.msg}"
    except Exception as exc:
        return str(exc)


def _validate_js_ts(path: str, content: str) -> str | None:
    """
    Return error string if JS/TS content fails syntax check, else None.
    Uses `node --check` (syntax-only, no execution). Skips silently if node
    is not available.
    """
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            timeout=5,
        )
        if result.returncode != 0:
            return None  # node not available, skip
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None  # node not available, skip

    ext = os.path.splitext(path)[1].lower()
    # node --check only works on .js/.mjs/.cjs; for TS we skip (no tsc in MVP)
    if ext not in {".js", ".mjs", ".cjs"}:
        return None

    try:
        with tempfile.NamedTemporaryFile(suffix=ext, mode="w", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        result = subprocess.run(
            ["node", "--check", tmp_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
        os.unlink(tmp_path)

        if result.returncode != 0:
            # Trim path from error to avoid exposing tmp location
            error_text = result.stderr.replace(tmp_path, path)
            return error_text.strip() or "Syntax error"
        return None
    except subprocess.TimeoutExpired:
        return None  # timeout = skip rather than block
    except Exception as exc:
        logger.debug("JS/TS validation error for %s: %s", path, exc)
        return None


def validate_files(merged_files: dict[str, str]) -> dict[str, str]:
    """
    Validate all files in the merged output.
    Returns a dict of { path: error_message } for files that fail.
    Files that pass have no entry in the result.
    """
    errors: dict[str, str] = {}
    for path, content in merged_files.items():
        if not isinstance(content, str):
            continue
        ext = os.path.splitext(path)[1].lower()
        error: str | None = None

        if ext in _PYTHON_EXTENSIONS:
            error = _validate_python(path, content)
        elif ext in _JS_EXTENSIONS:
            error = _validate_js_ts(path, content)

        if error:
            errors[path] = error
            logger.warning("AST validation failed for %s: %s", path, error)

    return errors
