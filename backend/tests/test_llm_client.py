"""Contract tests for the LLM client layer.

Two contracts are verified:

1. ``MockLLMClient`` — the deterministic routing state machine. Given a message
   in the orchestrator's format (``学生写下了：…。已经听过：…``), the mock must
   drive the agent pipeline through a predictable sequence ending in ``deliver``.
   This is the contract the orchestrator relies on when no real LLM is present.

2. ``OpenAICompatibleClient`` — the response-parsing contract. From a raw
   OpenAI-compatible HTTP payload it must produce a structured ``LLMResponse``
   (tool calls, ``[DELIVER]`` / ``[CALL:agent]`` directives, token accounting)
   and retry transient HTTP failures (429 / 5xx) with backoff.
"""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from mathweaver.llm.client import (
    LLMClient,
    LLMResponse,
    MockLLMClient,
    OpenAICompatibleClient,
    extract_content,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _run_sequence(client: MockLLMClient, first_input: str) -> list[tuple[str | None, str | None]]:
    """Drive the mock through turns, recording (next_action, next_agent).

    Simulates the orchestrator: after each ``call_agent`` step the agent name is
    appended to the ``已经听过`` field, and the turn repeats until ``deliver``.
    """
    called: set[str] = set()
    steps: list[tuple[str | None, str | None]] = []
    for _ in range(10):
        executed = "无" if not called else ",".join(sorted(called))
        user = f"学生写下了：{first_input}。已经听过：{executed}"
        resp = await client.chat("system", user)
        steps.append((resp.next_action, resp.next_agent))
        if resp.next_action == "deliver":
            break
        if resp.next_action == "call_agent" and resp.next_agent:
            called.add(resp.next_agent)
        else:
            pytest.fail(f"unexpected turn: {resp}")
    return steps


def _agent_names(steps: list[tuple[str | None, str | None]]) -> list[str]:
    """Extract the ordered agent names from a step sequence."""
    return [agent for action, agent in steps if action == "call_agent" and agent]


# ---------------------------------------------------------------------------
# MockLLMClient — routing state machine
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_client() -> MockLLMClient:
    return MockLLMClient()


@pytest.mark.asyncio
async def test_mock_satisfies_llm_client_protocol():
    """MockLLMClient implements the LLMClient protocol (runtime_checkable)."""
    assert isinstance(MockLLMClient(), LLMClient)


@pytest.mark.asyncio
async def test_mock_default_path_routes_perception_abstraction_epistemic(mock_client):
    steps = await _run_sequence(mock_client, "3+5 等于多少")
    assert _agent_names(steps) == ["perception", "abstraction", "epistemic"]
    assert steps[-1][0] == "deliver"


@pytest.mark.asyncio
async def test_mock_cayley_path_uses_counter_example_before_epistemic(mock_client):
    steps = await _run_sequence(mock_client, "[[1,0],[0,1]] 是群吗")
    assert _agent_names(steps) == [
        "perception",
        "abstraction",
        "counter_example",
        "epistemic",
    ]
    assert steps[-1][0] == "deliver"


@pytest.mark.asyncio
async def test_mock_conjecture_path_skips_abstraction(mock_client):
    steps = await _run_sequence(mock_client, "猜想所有偶数都能表示成两个质数之和")
    assert _agent_names(steps) == ["perception", "counter_example", "epistemic"]
    assert steps[-1][0] == "deliver"


@pytest.mark.asyncio
async def test_mock_history_path_is_shorter(mock_client):
    steps = await _run_sequence(mock_client, "讲讲质数的历史")
    assert _agent_names(steps) == ["perception", "historical"]
    assert steps[-1][0] == "deliver"


@pytest.mark.asyncio
async def test_mock_proof_path_routes_through_perception_then_delivers(mock_client):
    steps = await _run_sequence(mock_client, "证明费马小定理")
    assert _agent_names(steps) == ["perception"]
    assert steps[-1][0] == "deliver"


@pytest.mark.asyncio
async def test_mock_grill_path_routes_through_perception_then_delivers(mock_client):
    steps = await _run_sequence(mock_client, "考考我群论")
    assert _agent_names(steps) == ["perception"]
    assert steps[-1][0] == "deliver"


@pytest.mark.asyncio
async def test_mock_different_inputs_produce_different_sequences(mock_client):
    """Acceptance criterion 1.2: different inputs yield different execution paths."""
    cayley = await _run_sequence(mock_client, "[[1,0],[0,1]]")
    history = await _run_sequence(mock_client, "讲讲质数的历史")
    assert _agent_names(cayley) != _agent_names(history)


@pytest.mark.asyncio
async def test_mock_records_call_history(mock_client):
    await mock_client.chat("a system prompt", "学生写下了：3+5。已经听过：无")
    assert len(mock_client.call_history) == 1
    assert mock_client.call_history[0]["system"] == "a system prompt"
    assert "3+5" in mock_client.call_history[0]["user"]


@pytest.mark.asyncio
async def test_mock_returns_llmresponse_dataclass(mock_client):
    resp = await mock_client.chat("sys", "学生写下了：3+5。已经听过：无")
    assert isinstance(resp, LLMResponse)
    assert hasattr(resp, "content")
    assert hasattr(resp, "next_action")


# ---------------------------------------------------------------------------
# extract_content
# ---------------------------------------------------------------------------


def test_extract_content_handles_dataclass_dict_and_scalar():
    assert extract_content(LLMResponse(content="hi")) == "hi"
    assert extract_content({"content": "from-dict"}) == "from-dict"
    assert extract_content("raw-string") == "raw-string"
    assert extract_content({"no_content": 1}) == ""


# ---------------------------------------------------------------------------
# OpenAICompatibleClient — response parsing & retry
# ---------------------------------------------------------------------------

OK_RESPONSE: dict[str, Any] = {
    "choices": [
        {
            "message": {"content": "hello [DELIVER]"},
            "finish_reason": "stop",
        }
    ],
    "usage": {"total_tokens": 10},
}

TOOL_RESPONSE: dict[str, Any] = {
    "choices": [
        {
            "message": {
                "content": "call a tool",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "function": {"name": "lookup", "arguments": '{"a": 1, "b": 2}'},
                    }
                ],
            },
            "finish_reason": "tool_calls",
        }
    ],
    "usage": {"total_tokens": 25},
}


@pytest.mark.asyncio
async def test_openai_client_parses_deliver_directive():
    client = OpenAICompatibleClient(api_key="k", base_url="https://x", model="m")

    async def transport(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=OK_RESPONSE)

    client._get_client = _async_client(transport)
    resp = await client.chat("sys", "user")
    assert resp.content == "hello [DELIVER]"
    assert resp.next_action == "deliver"
    assert resp.finish_reason == "stop"


@pytest.mark.asyncio
async def test_openai_client_parses_call_agent_directive():
    client = OpenAICompatibleClient(api_key="k")

    async def transport(request: httpx.Request) -> httpx.Response:
        payload = copy.deepcopy(OK_RESPONSE)
        payload["choices"][0]["message"]["content"] = "next: [CALL:abstraction]"
        return httpx.Response(200, json=payload)

    client._get_client = _async_client(transport)
    resp = await client.chat("sys", "user")
    assert resp.next_action == "call_agent"
    assert resp.next_agent == "abstraction"


@pytest.mark.asyncio
async def test_openai_client_parses_tool_calls():
    client = OpenAICompatibleClient(api_key="k")

    async def transport(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=TOOL_RESPONSE)

    client._get_client = _async_client(transport)
    resp = await client.chat("sys", "user", tools=[{"name": "lookup", "description": "d"}])
    assert resp.tool_calls is not None
    assert resp.tool_calls[0]["name"] == "lookup"
    assert resp.tool_calls[0]["id"] == "call_1"
    assert resp.tool_calls[0]["arguments"] == {"a": 1, "b": 2}


@pytest.mark.asyncio
async def test_openai_client_falls_back_to_raw_arguments_on_bad_json():
    client = OpenAICompatibleClient(api_key="k")

    async def transport(request: httpx.Request) -> httpx.Response:
        payload = TOOL_RESPONSE.copy()
        payload["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = "{not json"
        return httpx.Response(200, json=payload)

    client._get_client = _async_client(transport)
    resp = await client.chat("sys", "user")
    assert resp.tool_calls[0]["arguments"] == {"raw": "{not json"}


@pytest.mark.asyncio
async def test_openai_client_tracks_total_tokens():
    client = OpenAICompatibleClient(api_key="k")

    async def transport(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=OK_RESPONSE)

    client._get_client = _async_client(transport)
    await client.chat("sys", "user")
    await client.chat("sys", "user")
    assert client.total_tokens == 20


@pytest.mark.asyncio
async def test_openai_client_retries_transient_429_with_backoff():
    client = OpenAICompatibleClient(api_key="k", max_retries=1)
    calls = {"n": 0}

    async def transport(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={"error": "rate limit"})
        return httpx.Response(200, json=OK_RESPONSE)

    client._get_client = _async_client(transport)
    # Patch the backoff sleep to keep the test fast.
    with _patch_sleep():
        resp = await client.chat("sys", "user")
    assert calls["n"] == 2
    assert resp.content == "hello [DELIVER]"


@pytest.mark.asyncio
async def test_openai_client_retries_5xx():
    client = OpenAICompatibleClient(api_key="k", max_retries=1)
    calls = {"n": 0}

    async def transport(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503, json={"error": "unavailable"})
        return httpx.Response(200, json=OK_RESPONSE)

    client._get_client = _async_client(transport)
    with _patch_sleep():
        await client.chat("sys", "user")
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_openai_client_raises_on_non_retryable_status():
    client = OpenAICompatibleClient(api_key="k", max_retries=3)
    calls = {"n": 0}

    async def transport(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, json={"error": "bad request"})

    client._get_client = _async_client(transport)
    with pytest.raises(httpx.HTTPStatusError):
        await client.chat("sys", "user")
    # A 400 is not retryable: it must fail immediately after one attempt.
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_openai_client_raises_after_retries_exhausted():
    client = OpenAICompatibleClient(api_key="k", max_retries=2)

    async def transport(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    client._get_client = _async_client(transport)
    with _patch_sleep():
        with pytest.raises(httpx.HTTPStatusError):
            await client.chat("sys", "user")


# ---------------------------------------------------------------------------
# Test scaffolding
# ---------------------------------------------------------------------------


def _async_client(transport: Callable[[httpx.Request], httpx.Response]) -> Callable[[], Any]:
    """Return an async ``_get_client`` replacement bound to a MockTransport."""

    async def _client() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(transport))

    return _client


def _patch_sleep():
    """Temporarily replace asyncio.sleep so backoff does not slow the tests."""

    class _Ctx:
        def __enter__(self):
            self._orig = asyncio.sleep
            asyncio.sleep = _noop_sleep  # type: ignore[assignment]
            return self

        def __exit__(self, *exc):
            asyncio.sleep = self._orig  # type: ignore[assignment]
            return False

    return _Ctx()


async def _noop_sleep(_delay: float) -> None:
    """No-op stand-in for :func:`asyncio.sleep`."""
    return None
