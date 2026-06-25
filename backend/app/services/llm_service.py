"""
Provider-agnostic LLM client.

All supported providers (Groq, Cerebras, DeepSeek, OpenRouter) expose an
OpenAI-compatible API, so we use openai.AsyncOpenAI with base_url pointing
at whichever provider is configured via LLM_BASE_URL / LLM_API_KEY.

Switch providers entirely in .env — no code changes needed:

    # Groq (default)
    LLM_BASE_URL=https://api.groq.com/openai/v1
    LLM_API_KEY=gsk_...

    # Cerebras
    LLM_BASE_URL=https://api.cerebras.ai/v1
    LLM_API_KEY=csk_...

    # DeepSeek
    LLM_BASE_URL=https://api.deepseek.com/v1
    LLM_API_KEY=sk-...

    # OpenRouter (access to every model)
    LLM_BASE_URL=https://openrouter.ai/api/v1
    LLM_API_KEY=sk-or-...
"""

import asyncio
import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import TypeVar

import instructor
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm_schemas import AgentResult, MergeResult, TaskDecomposition

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# ── Single shared client — the only place AsyncOpenAI is constructed ──────────
# agent.py and any future module must import get_llm_client() rather than
# building their own AsyncOpenAI instance, so there is exactly one source of
# truth for base_url / api_key.

_raw_client: AsyncOpenAI | None = None
_instructor_client: instructor.AsyncInstructor | None = None


def get_llm_client() -> AsyncOpenAI:
    """
    Return the singleton AsyncOpenAI client configured from .env.

    This is the ONLY place AsyncOpenAI(...) should be constructed in the
    entire backend. All callers (llm_service, agent loop, future services)
    must import this function instead of building their own client.
    """
    global _raw_client
    if _raw_client is None:
        if not settings.llm_base_url:
            raise RuntimeError(
                "LLM_BASE_URL is not set. Add it to your .env file.\n"
                "  Groq:       LLM_BASE_URL=https://api.groq.com/openai/v1\n"
                "  Cerebras:   LLM_BASE_URL=https://api.cerebras.ai/v1\n"
                "  DeepSeek:   LLM_BASE_URL=https://api.deepseek.com/v1\n"
                "  OpenRouter: LLM_BASE_URL=https://openrouter.ai/api/v1"
            )
        _raw_client = AsyncOpenAI(
            base_url=settings.llm_base_url,
            api_key=settings.resolved_api_key,
        )
        logger.info(
            "LLM client initialised: base_url=%s model=%s",
            settings.llm_base_url,
            settings.coding_model,
        )
    return _raw_client


def _instructor_client_get() -> instructor.AsyncInstructor:
    global _instructor_client
    if _instructor_client is None:
        # Reuse the same underlying AsyncOpenAI — no second construction.
        _instructor_client = instructor.from_openai(
            get_llm_client(),
            mode=instructor.Mode.JSON,
        )
    return _instructor_client


# ── Think-block stripping (DeepSeek-R1 / reasoning models) ───────────────────

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _strip_think_block(text: str) -> str:
    return _THINK_RE.sub("", text).strip()


def _extract_json(text: str) -> str:
    cleaned = _strip_think_block(text)
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", cleaned)
    return match.group(0) if match else cleaned


# ── Low-level transport helpers ────────────────────────────────────────────────

async def _chat_stream(
    model: str,
    messages: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> AsyncGenerator[str, None]:
    stream = await get_llm_client().chat.completions.create(
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
    for attempt in range(retries):
        try:
            resp = await get_llm_client().chat.completions.create(
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
            logger.warning("LLM attempt %d failed (%s), retrying in %ds", attempt + 1, exc, wait)
            await asyncio.sleep(wait)
    return ""


async def _structured_complete(
    model: str,
    messages: list[dict],
    response_model: type[T],
    temperature: float = 0.2,
    max_tokens: int = 8192,
    max_retries: int = 3,
) -> T:
    """
    Return a validated Pydantic model from the LLM.
    Primary path: instructor (handles retries + validation).
    Fallback: raw call + manual think-block strip + manual JSON parse.
    """
    for attempt in range(max_retries):
        try:
            return await _instructor_client_get().chat.completions.create(
                model=model,
                messages=messages,
                response_model=response_model,
                temperature=temperature,
                max_tokens=max_tokens,
                max_retries=max_retries,
            )
        except Exception as exc:
            if attempt == max_retries - 1:
                logger.warning(
                    "instructor call failed after %d attempts: %s — falling back to raw parse",
                    max_retries, exc,
                )
                break
            wait = 2 ** attempt
            logger.warning("instructor attempt %d failed (%s), retrying in %ds", attempt + 1, exc, wait)
            await asyncio.sleep(wait)

    for attempt in range(max_retries):
        try:
            raw = await _chat_complete(model, messages, temperature, max_tokens, retries=1)
            data = json.loads(_extract_json(raw))
            return response_model.model_validate(data)
        except (json.JSONDecodeError, ValidationError) as exc:
            if attempt == max_retries - 1:
                raise ValueError(
                    f"Failed to obtain valid {response_model.__name__} after {max_retries} fallback attempts"
                ) from exc
            wait = 2 ** attempt
            logger.warning("Fallback parse attempt %d failed (%s), retrying", attempt + 1, exc)
            await asyncio.sleep(wait)

    raise ValueError(f"Exhausted all attempts for {response_model.__name__}")


# ── Public API ────────────────────────────────────────────────────────────────

async def decompose_brief(
    brief: str,
    language: list[str],
    max_tasks: int,
    members: list[dict] | None = None,
) -> TaskDecomposition:
    lang_str = ", ".join(language) if language else "any"
    system = (
        "You are a senior software architect. Your job is to break down a project brief "
        "into parallelizable coding tasks for a hackathon team. Each task must be "
        "independently implementable with clear interface contracts.\n\n"
        "If a team roster is provided, set each task's suggested_assignee to the name "
        "of the member whose stated skills best match that task. Use a member's exact "
        "name, balance the workload so everyone gets work, and leave suggested_assignee "
        'empty ("") only if no member fits.\n\n'
        "Respond ONLY with valid JSON — no markdown fences, no explanation.\n"
        'Schema: { "tasks": [ { "name": str, "description": str, "tech": str, '
        '"complexity": "low"|"medium"|"high", "color": str (hex), '
        '"files": [str], "exposes": [{"name": str, "type": str, "description": str}], '
        '"depends_on": [{"name": str, "provided_by": str}], '
        '"suggested_assignee": str } ] }'
    )

    roster = ""
    if members:
        lines = [
            f"- {m['display_name']}: {m.get('skills') or 'no skills listed'}"
            for m in members
        ]
        roster = "\n\nTeam roster:\n" + "\n".join(lines)

    user = (
        f"Project brief: {brief}\n\nTech stack: {lang_str}\nMax tasks: {max_tasks}"
        f"{roster}\n\n"
        f"Create {max_tasks} or fewer distinct, parallelizable tasks. "
        "Assign each a unique hex color from: "
        "#4F8EF7, #3FB950, #A371F7, #D29922, #F85149, #58A6FF."
    )

    return await _structured_complete(
        model=settings.decomp_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_model=TaskDecomposition,
        temperature=0.3,
        max_tokens=4096,
        max_retries=3,
    )


async def stream_coding_response(
    prompt: str,
    context_code: str = "",
    task_context: str = "",
) -> AsyncGenerator[str, None]:
    system = (
        "You are Mosaic AI, an expert pair programmer embedded in a collaborative coding IDE. "
        "Give concise, correct, production-quality code. "
        "Wrap code in ```language blocks. Keep explanations short."
    )
    parts = []
    if task_context:
        parts.append(f"<task_context>\n{task_context}\n</task_context>")
    if context_code:
        parts.append(f"<current_code>\n{context_code}\n</current_code>")

    async for chunk in _chat_stream(
        model=settings.coding_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": "\n\n".join(parts + [prompt]) if parts else prompt},
        ],
        temperature=0.15,
        max_tokens=2048,
    ):
        yield chunk


async def merge_codebases(tasks_payload: list[dict], brief: str) -> MergeResult:
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
        'Schema: { "merged_files": { "path": "content" }, '
        '"diff_report": [{"path": str, "operation": str, "lines_added": int, "lines_removed": int}], '
        '"conflicts": [{"id": str, "description": str, "resolution": str, "files": [str]}] }'
    )
    return await _structured_complete(
        model=settings.merge_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"Project brief: {brief}\n\nTask codebases:\n{tasks_json}"},
        ],
        response_model=MergeResult,
        temperature=0.1,
        max_tokens=8192,
        max_retries=3,
    )


async def merge_self_correct(
    merged_files: dict[str, str],
    parse_errors: dict[str, str],
    brief: str,
) -> MergeResult:
    failing = "\n\n".join(
        f"--- {path} ---\nError: {err}\n\nContent:\n{merged_files.get(path, '')}"
        for path, err in parse_errors.items()
    )
    system = (
        "You are a senior engineer fixing syntax errors in merged code files. "
        "Return ONLY the corrected files in the same JSON format — no explanation.\n"
        'Schema: { "merged_files": { "path": "corrected_content" }, "diff_report": [], "conflicts": [] }'
    )
    return await _structured_complete(
        model=settings.merge_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"Project brief: {brief}\n\nFailing files:\n{failing}"},
        ],
        response_model=MergeResult,
        temperature=0.1,
        max_tokens=8192,
        max_retries=2,
    )


# ── In-editor agents (single-turn, no sandbox) ────────────────────────────────

AGENT_PROMPTS: dict[str, str] = {
    "builder": (
        "You are Builder, an agent that writes and modifies code to implement the "
        "developer's task. Produce complete, working, production-quality code."
    ),
    "reviewer": (
        "You are Reviewer, a meticulous senior engineer. Review for bugs, style, and "
        "correctness. Prefer concrete fixes: edit the file and explain why."
    ),
    "tester": (
        "You are Tester, an agent that writes thorough automated tests. "
        "Create new test files covering important cases."
    ),
    "debugger": (
        "You are Debugger. Diagnose and fix bugs. Identify the root cause, "
        "edit the files to fix it, and explain concisely."
    ),
    "explainer": (
        "You are Explainer. Explain code and concepts clearly. "
        "You do NOT modify files — always return an empty edits list."
    ),
}

DEFAULT_AGENT = "builder"


async def run_agent(
    agent_id: str,
    prompt: str,
    task_context: str,
    files: dict[str, str],
) -> AgentResult:
    persona = AGENT_PROMPTS.get(agent_id, AGENT_PROMPTS[DEFAULT_AGENT])
    files_text = (
        "\n\n".join(f"--- {path} ---\n{content}" for path, content in files.items())
        or "(no files yet)"
    )
    system = (
        f"{persona}\n\n"
        "Respond ONLY with valid JSON — no markdown fences.\n"
        'Schema: { "reply": str, "edits": [ { "path": str, "content": str, "summary": str } ] }'
    )
    return await _structured_complete(
        model=settings.coding_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"{task_context}\nCurrent files:\n{files_text}\n\nRequest: {prompt}"},
        ],
        response_model=AgentResult,
        temperature=0.2,
        max_tokens=8192,
        max_retries=2,
    )
