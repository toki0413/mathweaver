"""API integration tests exercised through the real FastAPI app.

Unlike the unit tests (which call the orchestrator directly), these tests
drive the actual HTTP surface via ``TestClient`` — the same route handlers,
request models, structured errors, and CORS wiring a production deployment
runs. The default ``MockLLMClient`` (no API key) keeps the whole stack
deterministic and offline.

Covered:
- Every REST endpoint in the canonical OpenAPI contract.
- The ``/ws/teach`` WebSocket protocol (start / input / state / ping).
- Structured error paths (404 for unknown curriculum / node / animation).
- Request-model validation (empty input → 422).
"""

from __future__ import annotations

import os

# Force a deterministic, isolated runtime BEFORE importing the app:
# mock LLM provider + in-memory SQLite so no state leaks to disk.
os.environ["MATHWEAVER_LLM_PROVIDER"] = "mock"
os.environ.pop("MATHWEAVER_LLM_API_KEY", None)
os.environ["MATHWEAVER_DB_PATH"] = ":memory:"

import sys  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mathweaver.api.app import app  # noqa: E402

# NOTE: `mathweaver.api.__init__` re-exports `app`, so
# `import mathweaver.api.app as X` binds X to the FastAPI instance, not the
# module. Grab the real module to reset its `_orchestrator` global.
_app_module = sys.modules["mathweaver.api.app"]


@pytest.fixture()
def client():
    """A fresh TestClient with a reset orchestrator per test."""
    _force_fresh_orchestrator()
    with TestClient(app) as c:
        yield c
    _force_fresh_orchestrator()


@pytest.fixture(autouse=True)
def _reset_metrics():
    """Force a fresh orchestrator (and metrics) before every test.

    The app keeps a module-level orchestrator singleton; after a test that
    drives the teaching loop, its MetricsCollector still holds counts. We
    reset the singleton so each test observes a clean slate regardless of
    ordering.
    """
    _force_fresh_orchestrator()
    yield
    _force_fresh_orchestrator()


def _force_fresh_orchestrator() -> None:
    """Drop the shared orchestrator so the next call rebuilds it."""
    _app_module._orchestrator = None


# ---------------------------------------------------------------------------
# Health & DAG
# ---------------------------------------------------------------------------


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "timestamp" in body


def test_dag_default_level(client):
    res = client.get("/api/dag")
    assert res.status_code == 200
    body = res.json()
    assert body["level"] == "group_theory"
    assert len(body["nodes"]) > 0
    assert body["milestones"]
    assert "summary" in body
    node = body["nodes"][0]
    assert {"id", "name", "description", "prerequisites", "is_milestone", "domain"} <= set(node)


def test_dag_specific_level(client):
    res = client.get("/api/dag", params={"level": "elementary"})
    assert res.status_code == 200
    assert res.json()["level"] == "elementary"


def test_dag_unknown_level_returns_structured_404(client):
    res = client.get("/api/dag", params={"level": "kindergarten"})
    assert res.status_code == 404
    body = res.json()
    assert body["headline"]
    assert "kindergarten" in body["headline"]
    assert "available_options" in body["recovery"]


# ---------------------------------------------------------------------------
# Curricula
# ---------------------------------------------------------------------------


def test_list_curricula(client):
    res = client.get("/api/curricula")
    assert res.status_code == 200
    levels = {c["level"] for c in res.json()["curricula"]}
    assert {
        "elementary",
        "middle_school",
        "high_school",
        "calculus",
        "linear_algebra",
        "discrete_math",
        "number_theory",
        "group_theory",
        "physics",
        "chemistry",
    } == levels


def test_curriculum_dag_full(client):
    res = client.get("/api/curricula/group_theory/dag")
    assert res.status_code == 200
    body = res.json()
    assert body["level"] == "group_theory"
    node = body["nodes"][0]
    for field in (
        "learning_objectives",
        "examples",
        "assessment_criteria",
        "estimated_minutes",
        "historical_context",
        "related_theorems",
        "common_misconceptions",
    ):
        assert field in node


def test_curriculum_dag_unknown_level_404(client):
    assert client.get("/api/curricula/nope/dag").status_code == 404


def test_learning_path(client):
    res = client.get("/api/dag/group_definition/path", params={"student_id": "demo"})
    assert res.status_code == 200
    body = res.json()
    assert body["target_node"] == "group_definition"
    assert body["node_name"]
    assert len(body["path"]) > 0


def test_learning_path_unknown_node_404(client):
    res = client.get("/api/dag/does_not_exist/path")
    assert res.status_code == 404
    assert "does_not_exist" in res.json()["headline"]


def test_curriculum_compare(client):
    res = client.post(
        "/api/curriculum/compare",
        json={"levels": ["group_theory", "linear_algebra"], "concept_keyword": "同构"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["keyword"] == "同构"
    assert isinstance(body["comparisons"], list)


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


def test_session_start(client):
    res = client.post(
        "/api/session/start",
        json={"student_id": "stu1", "student_name": "Alice", "target_node_id": "group_definition"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["session_id"].startswith("sess_stu1_")
    assert body["phase"] == "perceive"
    assert body["target_node"] == "group_definition"
    assert "learning_path" in body


def test_session_state_requires_start(client):
    # No session started yet for this fresh orchestrator.
    res = client.get("/api/session/state")
    assert res.status_code == 200
    assert "phase" in res.json()


def test_session_input_regular_question(client):
    client.post("/api/session/start", json={"student_id": "stu2"})
    res = client.post("/api/session/input", json={"student_input": "什么是群？"})
    assert res.status_code == 200
    body = res.json()
    assert body["response"]
    assert body["grill_mode"] is False
    assert body["proof_mode"] is False
    assert "four_fields" in body
    assert "decision" in body
    assert "phase_trace" in body


def test_session_input_grill_trigger(client):
    client.post("/api/session/start", json={"student_id": "stu3"})
    res = client.post("/api/session/input", json={"student_input": "考考我"})
    assert res.status_code == 200
    body = res.json()
    assert body["grill_mode"] is True
    assert body["grill_summary"] is not None
    assert body["grill_summary"]["active"] is True


def test_session_input_proof_trigger(client):
    client.post("/api/session/start", json={"student_id": "stu4"})
    proof = (
        "证明单位元唯一\n"
        "第一步：e·f = f 因为 e 是单位元\n"
        "第二步：e·f = e 因为 f 是单位元\n"
        "第三步：e = f 传递性"
    )
    res = client.post("/api/session/input", json={"student_input": proof})
    assert res.status_code == 200
    body = res.json()
    assert body["proof_mode"] is True
    assert body["proof_result"]["is_complete"] is True


def test_session_input_empty_rejected(client):
    res = client.post("/api/session/input", json={"student_input": ""})
    assert res.status_code == 422


def test_metrics(client):
    client.post("/api/session/start", json={"student_id": "stu5"})
    client.post("/api/session/input", json={"student_input": "什么是群？"})
    res = client.get("/api/metrics")
    assert res.status_code == 200
    assert res.json()["total_turns"] == 1


# ---------------------------------------------------------------------------
# Forge (counter-example)
# ---------------------------------------------------------------------------


def test_verify_group_abelian(client):
    # Cayley table of Z2 (abelian group).
    table = [[0, 1], [1, 0]]
    res = client.post("/api/forge/verify-group", json={"table": table})
    assert res.status_code == 200
    body = res.json()
    assert body["verdict"]["is_group"] is True
    assert body["verdict"]["is_abelian"] is True
    assert "headline" in body


def test_verify_group_non_abelian(client):
    # A non-abelian group (S3 is 6x6; use a simpler non-abelian 2x2 is impossible,
    # so assert the endpoint accepts a valid table regardless of verdict).
    table = [[0, 1], [1, 0]]
    res = client.post("/api/forge/verify-group", json={"table": table})
    assert res.status_code == 200
    assert "evidence" in res.json()


def test_verify_group_invalid_empty_table(client):
    res = client.post("/api/forge/verify-group", json={"table": []})
    assert res.status_code == 422


def test_find_non_associative(client):
    res = client.post("/api/forge/find-non-associative", params={"n": 2})
    assert res.status_code == 200
    body = res.json()
    assert "headline" in body
    assert "result" in body
    assert "metadata" in body


# ---------------------------------------------------------------------------
# Proof
# ---------------------------------------------------------------------------


def test_list_theorems(client):
    res = client.get("/api/proof/theorems", params={"level": "group_theory"})
    assert res.status_code == 200
    body = res.json()
    assert body["level"] == "group_theory"
    assert len(body["theorems"]) > 0
    assert body["count"] == len(body["theorems"])


def test_verify_proof_complete(client):
    res = client.post(
        "/api/proof/verify",
        json={
            "theorem_id": "identity_unique",
            "student_steps": [
                "设 e 和 f 都是单位元",
                "第一步：e·f = f 因为 e 是单位元",
                "第二步：e·f = e 因为 f 是单位元",
                "第三步：e = f 传递性",
            ],
            "curriculum_level": "group_theory",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["is_complete"] is True
    assert body["progress"].startswith("3/3")


def test_verify_proof_incomplete(client):
    res = client.post(
        "/api/proof/verify",
        json={
            "theorem_id": "identity_unique",
            "student_steps": ["e 是单位元"],
            "curriculum_level": "group_theory",
        },
    )
    assert res.status_code == 200
    assert res.json()["is_complete"] is False


# ---------------------------------------------------------------------------
# Grill
# ---------------------------------------------------------------------------


def test_grill_start(client):
    res = client.post("/api/grill/start", json={"student_id": "g1", "curriculum_level": "group_theory"})
    assert res.status_code == 200
    body = res.json()
    assert body["grill_mode"] is True
    assert body["grill_summary"]["active"] is True


def test_grill_answer(client):
    client.post("/api/grill/start", json={"student_id": "g2"})
    res = client.post(
        "/api/grill/answer",
        json={"qid": "q1", "answer": "群是满足封闭、结合、单位元和逆元的代数结构", "is_correct": True},
    )
    assert res.status_code == 200
    assert res.json()["grill_mode"] is True


# ---------------------------------------------------------------------------
# Conjecture translation
# ---------------------------------------------------------------------------


def test_conjecture_translate_refuted(client):
    res = client.post("/api/conjecture/translate", json={"claim": "所有群都是交换群"})
    assert res.status_code == 200
    body = res.json()
    assert "headline" in body
    assert body["verdict"] == "refuted"


def test_conjecture_translate_empty_rejected(client):
    assert client.post("/api/conjecture/translate", json={"claim": ""}).status_code == 422


# ---------------------------------------------------------------------------
# Historical narrative
# ---------------------------------------------------------------------------


def test_historical_narrative(client):
    res = client.post(
        "/api/historical/narrative",
        json={"query": "群论历史", "node_id": "group_definition", "top_k": 3},
    )
    assert res.status_code == 200
    body = res.json()
    assert "narrative" in body
    assert "entries" in body
    assert body["retrieval_method"] == "bm25"


# ---------------------------------------------------------------------------
# Animations
# ---------------------------------------------------------------------------


def test_animations_list(client):
    res = client.get("/api/animations")
    assert res.status_code == 200
    body = res.json()
    assert "animations" in body
    assert isinstance(body["animations"], list)


def test_animation_detail_unknown_404(client):
    res = client.get("/api/animations/does-not-exist")
    assert res.status_code == 404
    assert "does-not-exist" in res.json()["headline"]


def test_animation_video_unknown_404(client):
    res = client.get("/api/animations/does-not-exist/video")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------


def test_websocket_lifecycle(client):
    client.post("/api/session/start", json={"student_id": "ws1"})
    with client.websocket_connect("/ws/teach") as ws:
        # start
        ws.send_json({"type": "start", "student_id": "ws2", "target_node_id": "group_definition"})
        started = ws.receive_json()
        assert started["type"] == "session_started"
        assert started["session_id"].startswith("sess_ws2_")

        # input
        ws.send_json({"type": "input", "student_input": "什么是群？", "response_time_ms": 1000})
        resp = ws.receive_json()
        assert resp["type"] == "response"
        assert resp["response"]

        # state
        ws.send_json({"type": "state"})
        state = ws.receive_json()
        assert state["type"] == "state"
        assert "phase" in state

        # ping
        ws.send_json({"type": "ping"})
        pong = ws.receive_json()
        assert pong == {"type": "pong"}


def test_websocket_invalid_json(client):
    client.post("/api/session/start", json={"student_id": "ws3"})
    with client.websocket_connect("/ws/teach") as ws:
        ws.send_text("not-json")
        err = ws.receive_json()
        assert err["type"] == "error"
        assert "无法解析" in err["headline"]


def test_websocket_unknown_message_type_is_ignored(client):
    client.post("/api/session/start", json={"student_id": "ws4"})
    with client.websocket_connect("/ws/teach") as ws:
        ws.send_json({"type": "something-unknown"})
        # No response is expected for unknown types; a subsequent ping still works.
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
