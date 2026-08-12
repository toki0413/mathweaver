"""LLM client interface.

Defines the contract for LLM providers so agents can use any backend
(DeepSeek, GLM, Qwen, mock) interchangeably.

The LLM client is the mechanism through which agents achieve dynamic
control flow: instead of hardcoded if-else, the LLM decides which
agent to call next, whether to use a tool, and when to deliver.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from ..intent import (
    CONJECTURE_TRIGGER_KEYWORDS,
    GRILL_TRIGGER_KEYWORDS,
    PROOF_TRIGGER_KEYWORDS,
)

logger = logging.getLogger(__name__)


def extract_content(resp: Any) -> str:
    """Extract text content from an LLM response.

    Handles both LLMResponse dataclass and legacy dict returns.
    """
    if hasattr(resp, "content"):
        return resp.content
    if isinstance(resp, dict):
        return resp.get("content", "")
    return str(resp)


@dataclass
class LLMResponse:
    """Structured response from an LLM call."""

    content: str
    tool_calls: list[dict[str, Any]] | None = None
    next_action: str | None = None  # "call_agent", "deliver", "use_tool"
    next_agent: str | None = None   # which agent to call next
    finish_reason: str = "stop"
    usage: dict[str, int] | None = None  # {"prompt_tokens": N, "completion_tokens": M}


@runtime_checkable
class LLMClient(Protocol):
    """Protocol for LLM clients."""

    async def chat(
        self,
        system_prompt: str,
        user_message: str,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> LLMResponse:
        ...


class MockLLMClient:
    """Deterministic mock LLM client for testing and development.

    Produces different execution paths based on input type, satisfying
    acceptance criterion 1.2 (different inputs produce different sequences).

    Parses the '已执行:' field from the orchestrator input to track
    which agents have already been called.
    """

    def __init__(self) -> None:
        self.call_history: list[dict[str, Any]] = []

    async def chat(
        self,
        system_prompt: str,
        user_message: str,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> LLMResponse:
        self.call_history.append({
            "system": system_prompt[:200],
            "user": user_message[:200],
        })

        # Parse which agents have already been called
        # Match both "已执行:" (legacy) and "已经听过：" (current) formats
        called = set()
        exec_match = re.search(r"(?:已执行|已经听过)[：:]\s*(.*)", user_message)
        if exec_match:
            exec_str = exec_match.group(1).strip()
            if exec_str and exec_str != "无" and exec_str != "还没有人发言":
                called = set(a.strip() for a in exec_str.split(","))

        # Parse student input type
        # Match both "学生输入:" (legacy) and "学生写下了：" (current) formats
        student_input = ""
        input_match = re.search(r"(?:学生输入|学生写下了)[：:]\s*(.*)", user_message)
        if input_match:
            student_input = input_match.group(1)

        is_cayley = "[[" in student_input or "cayley" in student_input.lower()
        is_history = "历史" in student_input or "history" in student_input.lower()
        is_conjecture = any(kw in student_input for kw in CONJECTURE_TRIGGER_KEYWORDS)
        is_grill_trigger = any(kw in student_input.lower() for kw in GRILL_TRIGGER_KEYWORDS)
        is_proof = any(kw in student_input for kw in PROOF_TRIGGER_KEYWORDS)

        # Grill Me mode: trigger directly routes to deliver (collaboration handles grill)
        if is_grill_trigger and "perception" not in called:
            return LLMResponse(
                content="Grill mode triggered",
                next_action="call_agent",
                next_agent="perception",
            )
        if is_grill_trigger and "perception" in called:
            return LLMResponse(
                content="Grill mode: delivering question to student",
                next_action="deliver",
            )

        # Proof mode: route through perception then deliver (orchestrator runs proof assistant)
        if is_proof and "perception" not in called:
            return LLMResponse(
                content="Proof attempt detected",
                next_action="call_agent",
                next_agent="perception",
            )
        if is_proof and "perception" in called:
            return LLMResponse(
                content="Proof mode: delivering proof verification",
                next_action="deliver",
            )

        # Determine next agent based on what's been called and input type
        if "perception" not in called:
            return LLMResponse(
                content="Starting with perception",
                next_action="call_agent",
                next_agent="perception",
            )

        if is_cayley:
            # Cayley table path: perception -> abstraction -> counter_example -> epistemic -> collaboration
            if "abstraction" not in called:
                return LLMResponse(
                    content="Abstracting Cayley table structure",
                    next_action="call_agent",
                    next_agent="abstraction",
                )
            if "counter_example" not in called:
                return LLMResponse(
                    content="Verifying with Z3",
                    next_action="call_agent",
                    next_agent="counter_example",
                )
            if "epistemic" not in called:
                return LLMResponse(
                    content="Diagnosing cognitive state",
                    next_action="call_agent",
                    next_agent="epistemic",
                )
        elif is_conjecture:
            # Conjecture path: perception -> counter_example (test conjecture) -> epistemic -> collaboration
            if "counter_example" not in called:
                return LLMResponse(
                    content="Testing conjecture with Z3",
                    next_action="call_agent",
                    next_agent="counter_example",
                )
            if "epistemic" not in called:
                return LLMResponse(
                    content="Diagnosing cognitive state after conjecture",
                    next_action="call_agent",
                    next_agent="epistemic",
                )
        elif is_history:
            # History path: perception -> historical -> collaboration (shorter path)
            if "historical" not in called:
                return LLMResponse(
                    content="Retrieving historical context",
                    next_action="call_agent",
                    next_agent="historical",
                )
        else:
            # Default path: perception -> abstraction -> epistemic -> collaboration
            if "abstraction" not in called:
                return LLMResponse(
                    content="Abstracting input",
                    next_action="call_agent",
                    next_agent="abstraction",
                )
            if "epistemic" not in called:
                return LLMResponse(
                    content="Diagnosing cognitive state",
                    next_action="call_agent",
                    next_agent="epistemic",
                )

        # All needed agents have run, deliver
        return LLMResponse(
            content="All agents complete, delivering response [DELIVER]",
            next_action="deliver",
            finish_reason="stop",
        )


class OpenAICompatibleClient:
    """LLM client for OpenAI-compatible APIs (DeepSeek, GLM, Qwen, etc.).

    Features:
    - Connection reuse via persistent httpx.AsyncClient
    - Automatic retry with exponential backoff for 429/5xx errors
    - Token usage tracking exposed via total_tokens property
    """

    # Retryable HTTP status codes
    _RETRYABLE_STATUS = {429, 500, 502, 503, 504}

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.deepseek.com/v1",
        model: str = "deepseek-chat",
        max_retries: int = 3,
        timeout: float = 60.0,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.max_retries = max_retries
        self.timeout = timeout
        self._total_tokens: int = 0
        self._client: Any = None  # lazy-init httpx.AsyncClient

    async def _get_client(self):
        """Get or create the persistent httpx client."""
        if self._client is None or self._client.is_closed:
            import httpx
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout, connect=10.0),
                limits=httpx.Limits(
                    max_connections=10,
                    max_keepalive_connections=5,
                    keepalive_expiry=30.0,
                ),
            )
        return self._client

    async def _call_api(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Make a single API call with retry on transient failures."""
        import httpx

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        client = await self._get_client()
        last_exc: Exception | None = None

        for attempt in range(self.max_retries + 1):
            try:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                )
                if resp.status_code in self._RETRYABLE_STATUS and attempt < self.max_retries:
                    # Exponential backoff: 1s, 2s, 4s, ...
                    delay = 2 ** attempt
                    logger.warning(
                        "LLM API returned %d, retrying in %ds (attempt %d/%d)",
                        resp.status_code, delay, attempt + 1, self.max_retries,
                    )
                    await asyncio.sleep(delay)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.TimeoutException as e:
                last_exc = e
                if attempt < self.max_retries:
                    delay = 2 ** attempt
                    logger.warning(
                        "LLM API timeout, retrying in %ds (attempt %d/%d): %s",
                        delay, attempt + 1, self.max_retries, e,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise
            except httpx.HTTPStatusError:
                raise  # Non-retryable HTTP errors propagate immediately
            except httpx.HTTPError as e:
                last_exc = e
                if attempt < self.max_retries:
                    delay = 2 ** attempt
                    logger.warning(
                        "LLM API error, retrying in %ds (attempt %d/%d): %s",
                        delay, attempt + 1, self.max_retries, e,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise

        # All retries exhausted
        raise last_exc or RuntimeError("LLM API call failed after all retries")

    async def chat(
        self,
        system_prompt: str,
        user_message: str,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> LLMResponse:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = [
                {"type": "function", "function": t} for t in tools
            ]

        data = await self._call_api(payload)

        choice = data["choices"][0]
        message = choice["message"]
        usage = data.get("usage", {})
        self._total_tokens += usage.get("total_tokens", 0)

        tool_calls = None
        if message.get("tool_calls"):
            tool_calls = []
            for tc in message["tool_calls"]:
                fn = tc.get("function", {})
                args_str = fn.get("arguments", "{}")
                try:
                    args = json.loads(args_str)
                except json.JSONDecodeError:
                    args = {"raw": args_str}
                tool_calls.append({
                    "id": tc.get("id"),
                    "name": fn.get("name"),
                    "arguments": args,
                })

        content = message.get("content", "")
        next_action = None
        next_agent = None
        if "[DELIVER]" in content:
            next_action = "deliver"
        elif "[CALL:" in content:
            match = re.search(r"\[CALL:(\w+)\]", content)
            if match:
                next_action = "call_agent"
                next_agent = match.group(1)

        return LLMResponse(
            content=content,
            tool_calls=tool_calls,
            next_action=next_action,
            next_agent=next_agent,
            finish_reason=choice.get("finish_reason", "stop"),
            usage=usage,
        )

    @property
    def total_tokens(self) -> int:
        """Total tokens consumed across all calls."""
        return self._total_tokens

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
