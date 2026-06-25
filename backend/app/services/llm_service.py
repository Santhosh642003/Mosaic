"""Groq LLM client with retry, streaming, structured output, and model routing."""

import asyncio
import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import TypeVar

import instructor
from groq import AsyncGroq
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm_schemas import AgentResult, MergeResult, TaskDecomposition

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_raw_client: AsyncGroq | None = None
_instructor_client: instructor.AsyncInstructor | None = None


def _groq() -> AsyncGroq:
    global _raw_client
    if _raw_client is None:
        _raw_client = AsyncGroq(api_key=settings.groq_api_key)
    return _raw_client


def _groq_instructor() -> instructor.AsyncInstructor:
    """Return an instructor-wrapped async Groq client (JSON mode)."""
    global _instructor_client
    if _instructor_client is None:
        _instructor_client = instructor.from_groq(
            AsyncGroq(api_key=settings.groq_api_key),
            mode=instructor.Mode.JSON,
        )
    return _instructor_client


# ── DeepSeek-R1 think-block stripping ─────────────────────────────────────────

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _strip_think_block(text: str) -> str:
    """Remove DeepSeek-R1 <think>...</think> reasoning traces from output."""
    return _THINK_RE.sub("", text).strip()


def _extract_json(text: str) -> str:
    """Strip think block, then find the first JSON object/array in the text."""
    cleaned = _strip_think_block(text)
    # Try to find a JSON object or array if surrounded by extra text
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", cleaned)
    return match.group(0) if match else cleaned


# ── Low-level transport helpers ────────────────────────────────────────────────

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


async def _structured_complete(
    model: str,
    messages: list[dict],
    response_model: type[T],
    temperature: float = 0.2,
    max_tokens: int = 8192,
    max_retries: int = 3,
) -> T:
    """
    Use instructor to get a validated Pydantic response.
    Falls back to manual JSON extraction + validation if instructor fails.
    Strips DeepSeek-R1 think blocks before any parse attempt.
    """
    # Primary path: instructor handles validation + retry
    for attempt in range(max_retries):
        try:
            result = await _groq_instructor().chat.completions.create(
                model=model,
                messages=messages,
                response_model=response_model,
                temperature=temperature,
                max_tokens=max_tokens,
                max_retries=max_retries,
            )
            return result
        except Exception as exc:
            if attempt == max_retries - 1:
                logger.warning(
                    "instructor structured call failed after %d attempts: %s. "
                    "Falling back to raw parse.",
                    max_retries,
                    exc,
                )
                break
            wait = 2 ** attempt
            logger.warning(
                "instructor attempt %d failed (%s), retrying in %ds", attempt + 1, exc, wait
            )
            await asyncio.sleep(wait)

    # Fallback: raw call + manual think-block strip + manual validation
    for attempt in range(max_retries):
        try:
            raw = await _chat_complete(model, messages, temperature, max_tokens, retries=1)
            json_str = _extract_json(raw)
            data = json.loads(json_str)
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
    """
    Call DeepSeek-R1 to decompose a project brief into parallelizable tasks.
    When a team roster (name + skills) is provided, the model also suggests
    which member best fits each task. Returns a validated TaskDecomposition
    (Guard 1).
    """
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
        roster = (
            "\n\nTeam roster (assign tasks to fit these members' skills):\n"
            + "\n".join(lines)
        )

    user = (
        f"Project brief: {brief}\n\n"
        f"Tech stack: {lang_str}\n"
        f"Max tasks: {max_tasks}"
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


async def merge_codebases(tasks_payload: list[dict], brief: str) -> MergeResult:
    """
    Call the merge model to semantically merge all task codebases.
    Returns a validated MergeResult (Guard 1).
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
        'Schema: { "merged_files": { "path": "content" }, '
        '"diff_report": [{"path": str, "operation": str, "lines_added": int, "lines_removed": int}], '
        '"conflicts": [{"id": str, "description": str, "resolution": str, "files": [str]}] }'
    )
    user = f"Project brief: {brief}\n\nTask codebases:\n{tasks_json}"

    return await _structured_complete(
        model=settings.merge_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
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
    """
    One self-correction pass: send failing files + errors back to the merge model
    and ask it to return corrected versions (Guard 3).
    """
    failing_files_text = "\n\n".join(
        f"--- {path} ---\nError: {error}\n\nContent:\n{merged_files.get(path, '')}"
        for path, error in parse_errors.items()
    )

    system = (
        "You are a senior engineer fixing syntax errors in merged code files. "
        "Return ONLY the corrected files in the same JSON format — no explanation.\n"
        'Schema: { "merged_files": { "path": "corrected_content" }, '
        '"diff_report": [], "conflicts": [] }'
    )
    user = (
        f"These files failed syntax/AST validation after merging. "
        f"Fix ALL errors and return a valid JSON response.\n\n"
        f"Project brief: {brief}\n\n"
        f"Failing files:\n{failing_files_text}"
    )

    return await _structured_complete(
        model=settings.merge_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_model=MergeResult,
        temperature=0.1,
        max_tokens=8192,
        max_retries=2,
    )


# ── In-editor agents ────────────────────────────────────────────────────────────

# Each agent is a persona with a distinct job. The id is what the client sends.
AGENT_PROMPTS: dict[str, str] = {
    "builder": (
        "You are Builder, an agent that writes and modifies code to implement the "
        "developer's task. Produce complete, working, production-quality code. When "
        "asked to build or change something, edit the relevant files directly."
    ),
    "reviewer": (
        "You are Reviewer, a meticulous senior engineer. Review the current code for "
        "bugs, style, and correctness. Prefer concrete fixes: when you spot an issue, "
        "edit the file to fix it and explain why in your reply."
    ),
    "tester": (
        "You are Tester, an agent that writes thorough automated tests for the task. "
        "Create new test files covering the important cases. Match the project's "
        "language and conventions."
    ),
    "debugger": (
        "You are Debugger, an agent that diagnoses and fixes bugs. Identify the root "
        "cause from the code and error description, then edit the files to fix it. "
        "Explain the root cause concisely."
    ),
    "explainer": (
        "You are Explainer, an agent that explains code and concepts clearly and "
        "concisely. You do NOT modify files — always return an empty edits list."
    ),
}

DEFAULT_AGENT = "builder"


async def run_agent(
    agent_id: str,
    prompt: str,
    task_context: str,
    files: dict[str, str],
) -> AgentResult:
    """
    Run a selected in-editor agent. The agent sees the task context and the
    current file contents, and returns a chat reply plus any full-file edits.
    """
    persona = AGENT_PROMPTS.get(agent_id, AGENT_PROMPTS[DEFAULT_AGENT])

    files_text = (
        "\n\n".join(f"--- {path} ---\n{content}" for path, content in files.items())
        or "(no files yet)"
    )

    system = (
        f"{persona}\n\n"
        "You are embedded in a collaborative IDE and are scoped to ONE task. "
        "You may create or modify the task's files. Respond ONLY with valid JSON — "
        "no markdown fences.\n"
        'Schema: { "reply": str, "edits": [ { "path": str, "content": str, "summary": str } ] }\n'
        "- reply: a short message to the developer (markdown allowed).\n"
        "- edits: ONLY the files you created or changed. Put the COMPLETE new file "
        "content in `content` (never a diff or partial snippet). Use [] when you make "
        "no code changes."
    )
    user = (
        f"{task_context}\n"
        f"Current files:\n{files_text}\n\n"
        f"Developer request: {prompt}"
    )

    return await _structured_complete(
        model=settings.coding_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_model=AgentResult,
        temperature=0.2,
        max_tokens=8192,
        max_retries=2,
    )
