"""Groq LLM client with retry, streaming, and model routing."""

import asyncio
import logging
from collections.abc import AsyncGenerator

from groq import AsyncGroq

from app.config import settings

logger = logging.getLogger(__name__)

_client: AsyncGroq | None = None


def _groq() -> AsyncGroq:
    global _client
    if _client is None:
        _client = AsyncGroq(api_key=settings.groq_api_key)
    return _client


async def _chat_stream(
    model: str,
    messages: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> AsyncGenerator[str, None]:
    """Yield text chunks from a Groq streaming chat call."""
    stream = await _groq().chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def _chat_complete(
    model: str,
    messages: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 8192,
    retries: int = 3,
) -> str:
    """Complete a chat turn (non-streaming) with exponential-backoff retry."""
    for attempt in range(retries):
        try:
            resp = await _groq().chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
            )
            return resp.choices[0].message.content or ""
        except Exception as exc:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            logger.warning("Groq attempt %d failed (%s), retrying in %ds", attempt + 1, exc, wait)
            await asyncio.sleep(wait)
    return ""


# ── Public API ────────────────────────────────────────────────────────────────

async def decompose_brief(brief: str, language: list[str], max_tasks: int) -> str:
    """
    Call DeepSeek-R1 to decompose a project brief into parallelizable tasks.
    Returns raw JSON string.
    """
    lang_str = ", ".join(language) if language else "any"
    system = (
        "You are a senior software architect. Your job is to break down a project brief "
        "into parallelizable coding tasks for a hackathon team. Each task must be "
        "independently implementable with clear interface contracts.\n\n"
        "Respond ONLY with valid JSON — no markdown fences, no explanation.\n"
        "Schema: { \"tasks\": [ { \"name\": str, \"description\": str, \"tech\": str, "
        "\"complexity\": \"low\"|\"medium\"|\"high\", \"color\": str (hex), "
        "\"files\": [str], \"exposes\": [{\"name\": str, \"type\": str, \"description\": str}], "
        "\"depends_on\": [{\"name\": str, \"provided_by\": str}] } ] }"
    )
    user = (
        f"Project brief: {brief}\n\n"
        f"Tech stack: {lang_str}\n"
        f"Max tasks: {max_tasks}\n\n"
        "Create {max_tasks} or fewer distinct, parallelizable tasks. "
        "Assign each a unique hex color from: "
        "#4F8EF7, #3FB950, #A371F7, #D29922, #F85149, #58A6FF."
    ).replace("{max_tasks}", str(max_tasks))

    return await _chat_complete(
        model=settings.decomp_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.3,
        max_tokens=4096,
    )


async def stream_coding_response(
    prompt: str,
    context_code: str = "",
    task_context: str = "",
) -> AsyncGenerator[str, None]:
    """Stream a Qwen code-generation response for the in-editor AI assistant."""
    system = (
        "You are Mosaic AI, an expert pair programmer embedded in a collaborative coding IDE. "
        "Give concise, correct, production-quality code. "
        "When providing code, wrap it in ```language blocks. "
        "Keep explanations short — developers need answers, not lectures."
    )
    context_parts = []
    if task_context:
        context_parts.append(f"<task_context>\n{task_context}\n</task_context>")
    if context_code:
        context_parts.append(f"<current_code>\n{context_code}\n</current_code>")

    user_content = "\n\n".join(context_parts + [prompt]) if context_parts else prompt

    async for chunk in _chat_stream(
        model=settings.coding_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        temperature=0.15,
        max_tokens=2048,
    ):
        yield chunk


async def merge_codebases(tasks_payload: list[dict], brief: str) -> str:
    """
    Call the merge model to semantically merge all task codebases.
    Returns raw JSON string: { merged_files: {path: content}, diff_report: [...], conflicts: [...] }
    """
    tasks_json = "\n\n".join(
        f"=== Task: {t['name']} ===\n"
        + "\n".join(f"--- {path} ---\n{content}" for path, content in (t.get("code") or {}).items())
        for t in tasks_payload
    )

    system = (
        "You are a senior engineer performing a semantic code merge. "
        "Merge the provided task codebases into a single coherent project. "
        "Resolve all conflicts intelligently. Ensure imports, exports, and interfaces align. "
        "Respond ONLY with valid JSON — no markdown fences.\n"
        "Schema: { \"merged_files\": { \"path\": \"content\" }, "
        "\"diff_report\": [{\"path\": str, \"operation\": str, \"lines_added\": int, \"lines_removed\": int}], "
        "\"conflicts\": [{\"id\": str, \"description\": str, \"resolution\": str, \"files\": [str]}] }"
    )
    user = f"Project brief: {brief}\n\nTask codebases:\n{tasks_json}"

    return await _chat_complete(
        model=settings.merge_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.1,
        max_tokens=8192,
        retries=3,
    )
