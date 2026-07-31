"""FastAPI application for MathWeaver.

Provides REST and WebSocket endpoints for the teaching loop.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..config import create_llm_client, get_config
from ..counterexample.forge import CounterExampleForge
from ..dag.concept_dag import get_dag
from ..orchestrator.engine import Orchestrator

logger = logging.getLogger(__name__)

_config = get_config()
logging.basicConfig(level=getattr(logging, _config.log_level.upper(), logging.INFO))

app = FastAPI(
    title="MathWeaver API",
    description="Multi-Agent Cognitive Operating System for Math Education",
    version="0.1.0",
)

# CORS for frontend (configurable via .env)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_config.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global orchestrator instance
_orchestrator: Orchestrator | None = None


def get_orchestrator() -> Orchestrator:
    global _orchestrator
    if _orchestrator is None:
        llm_client = create_llm_client(_config.llm)
        _orchestrator = Orchestrator(
            llm_client=llm_client,
            db_path=_config.db_path,
        )
        provider = _config.llm.provider
        logger.info("Orchestrator initialized — LLM provider: %s, DB: %s", provider, _config.db_path)
    return _orchestrator


def structured_error(
    status: int,
    headline: str,
    detail: str = "",
    recovery: dict[str, Any] | None = None,
) -> JSONResponse:
    """Return a structured error response with a guided recovery path.

    Design principle: errors are not machine codes—they are signposts.
    The student should always know what went wrong and what to do next.
    """
    body: dict[str, Any] = {"headline": headline}
    if detail:
        body["detail"] = detail
    if recovery:
        body["recovery"] = recovery
    return JSONResponse(status_code=status, content=body)


# ---------------------------------------------------------------------------
# Request/Response Models
# ---------------------------------------------------------------------------

class StartSessionRequest(BaseModel):
    student_id: str
    student_name: str = ""
    target_node_id: str = "group_definition"


class StudentInputRequest(BaseModel):
    student_input: str = Field(..., min_length=1)
    response_time_ms: float = 5000.0


class CayleyTableRequest(BaseModel):
    table: list[list[int]] = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# REST Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/dag")
async def get_dag_nodes(level: str | None = None) -> dict[str, Any]:
    """Get the concept DAG nodes for a curriculum level."""
    from ..dag.concept_dag import CURRICULUM_LEVELS
    if level and level not in CURRICULUM_LEVELS:
        return structured_error(
            status=404,
            headline=f"未找到课程层级「{level}」",
            detail="该层级不在当前课程体系中。",
            recovery={
                "suggestion": "请从可用层级中选择",
                "available_options": list(CURRICULUM_LEVELS),
            },
        )
    dag = get_dag(level) if level else get_dag()
    nodes = dag.get_all_nodes()
    summary = dag.get_curriculum_summary()
    level_label = summary.get("label", dag.get_level())
    return {
        "headline": f"{level_label} · {len(nodes)} 个概念节点 · {len([n for n in nodes if n.is_milestone])} 个里程碑",
        "level": dag.get_level(),
        "nodes": [
            {
                "id": n.id,
                "name": n.name,
                "description": n.description,
                "prerequisites": n.prerequisites,
                "abstraction_level": n.abstraction_level,
                "difficulty": n.difficulty,
                "is_milestone": n.is_milestone,
                "domain": n.domain,
            }
            for n in nodes
        ],
        "milestones": [n.id for n in dag.get_milestone_nodes()],
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# Historical narrative & cross-curriculum comparison (T-3.4 / T-3.5)
# ---------------------------------------------------------------------------

class HistoricalRequest(BaseModel):
    query: str
    node_id: str = "group_definition"
    top_k: int = 3


class CurriculumCompareRequest(BaseModel):
    levels: list[str] = ["group_theory", "linear_algebra", "number_theory"]
    concept_keyword: str = "isomorphism"


@app.post("/api/historical/narrative")
async def get_historical_narrative(req: HistoricalRequest) -> dict[str, Any]:
    """Retrieve a historical narrative for a concept via RAG.

    Uses the ``HistoricalAgent``'s BM25 retrieval to find relevant
    mathematical-history entries, then returns a narrative summary plus
    the raw retrieved entries.

    Returns:
        JSON with ``narrative`` (str), ``entries`` (list of
        ``{title, content, score}``), ``node_id``, and
        ``retrieval_method``.
    """
    from ..agents.historical import HistoricalAgent

    agent = HistoricalAgent()
    results = agent._retrieve(req.query, top_k=req.top_k)

    if not results:
        # Fallback: search using the node_id as query
        results = agent._retrieve(req.node_id, top_k=req.top_k)

    if results:
        top = results[0]
        narrative = top["content"]
        entries = [
            {
                "title": r["title"],
                "content": r["content"],
                "score": r["score"],
            }
            for r in results
        ]
    else:
        narrative = "暂无相关历史背景。"
        entries = []

    return {
        "narrative": narrative,
        "entries": entries,
        "node_id": req.node_id,
        "retrieval_method": "bm25",
    }


@app.post("/api/curriculum/compare")
async def compare_curriculum_structures(req: CurriculumCompareRequest) -> dict[str, Any]:
    """Compare how a concept appears across different curriculum levels.

    Searches each specified curriculum DAG for nodes whose name or
    description contains ``concept_keyword``, then returns a structured
    comparison highlighting the concept's structural role in each
    curriculum.

    Returns:
        JSON with ``comparisons`` (list of ``{level, concept_id,
        concept_name, description, structural_type}``) and ``keyword``.
    """
    from ..dag.concept_dag import CURRICULUM_LEVELS

    comparisons: list[dict[str, Any]] = []

    for level in req.levels:
        if level not in CURRICULUM_LEVELS:
            continue
        dag = get_dag(level)
        matches = dag.search_nodes_by_keyword(req.concept_keyword)
        for node in matches:
            comparisons.append({
                "level": level,
                "concept_id": node.id,
                "concept_name": node.name,
                "description": node.description,
                "structural_type": node.domain,
            })

    return {
        "headline": (
            f"跨课程对照 · 关键词「{req.concept_keyword}」"
            f" · {len(comparisons)} 个匹配"
        ),
        "comparisons": comparisons,
        "keyword": req.concept_keyword,
    }


@app.get("/api/curricula")
async def list_curricula() -> dict[str, Any]:
    """List all available curriculum levels."""
    from ..dag.concept_dag import get_available_curricula
    return {"curricula": get_available_curricula()}


@app.get("/api/curricula/{level}/dag")
async def get_curriculum_dag(level: str) -> dict[str, Any]:
    """Get the DAG for a specific curriculum level."""
    from ..dag.concept_dag import CURRICULUM_LEVELS
    if level not in CURRICULUM_LEVELS:
        return structured_error(
            status=404,
            headline=f"未找到课程层级「{level}」",
            detail="该层级不在当前课程体系中。",
            recovery={
                "suggestion": "请从可用层级中选择",
                "available_options": list(CURRICULUM_LEVELS),
            },
        )
    dag = get_dag(level)
    nodes = dag.get_all_nodes()
    summary = dag.get_curriculum_summary()
    level_label = summary.get("label", level)
    return {
        "headline": f"{level_label} · {len(nodes)} 个概念节点 · {len([n for n in nodes if n.is_milestone])} 个里程碑",
        "level": level,
        "label": level_label,
        "nodes": [
            {
                "id": n.id,
                "name": n.name,
                "description": n.description,
                "prerequisites": n.prerequisites,
                "abstraction_level": n.abstraction_level,
                "domain": n.domain,
                "difficulty": n.difficulty,
                "is_milestone": n.is_milestone,
                "learning_objectives": n.learning_objectives,
                "examples": n.examples,
                "assessment_criteria": n.assessment_criteria,
                "estimated_minutes": n.estimated_minutes,
                "historical_context": n.historical_context,
                "related_theorems": n.related_theorems,
                "common_misconceptions": n.common_misconceptions,
            }
            for n in nodes
        ],
        "summary": summary,
    }


@app.get("/api/dag/{node_id}/path")
async def get_learning_path(node_id: str, student_id: str = "demo") -> dict[str, Any]:
    """Get the learning path to a target node."""
    dag = get_dag()
    node = dag.get_node(node_id)
    if not node:
        return structured_error(
            status=404,
            headline=f"未找到概念节点「{node_id}」",
            detail="该节点不在当前课程图谱中。",
            recovery={
                "suggestion": "查看完整的概念列表来选择有效的节点",
                "endpoint": "/api/dag",
            },
        )

    path = dag.get_learning_path(node_id, {})
    path_nodes = [dag.get_node(nid) for nid in path]
    return {
        "headline": f"通往「{node.name}」的学习路径 · {len(path_nodes)} 步",
        "target_node": node_id,
        "node_name": node.name,
        "path": [
            {
                "id": n.id,
                "name": n.name,
                "description": n.description,
            }
            for n in path_nodes
        ],
    }


@app.post("/api/session/start")
async def start_session(req: StartSessionRequest) -> dict[str, Any]:
    """Start a new teaching session."""
    orch = get_orchestrator()
    result = orch.start_session(
        student_id=req.student_id,
        student_name=req.student_name,
        target_node_id=req.target_node_id,
    )
    return result


@app.get("/api/session/state")
async def get_session_state() -> dict[str, Any]:
    """Get current four-field state."""
    orch = get_orchestrator()
    return orch.get_state_snapshot()


@app.post("/api/session/input")
async def process_input(req: StudentInputRequest) -> dict[str, Any]:
    """Process a student input through the teaching loop."""
    orch = get_orchestrator()
    result = await orch.process_student_input(
        student_input=req.student_input,
        input_metadata={"response_time_ms": req.response_time_ms},
    )
    return result


@app.post("/api/forge/verify-group")
async def verify_group_axioms(req: CayleyTableRequest) -> dict[str, Any]:
    """Verify if a Cayley table defines a group.

    Response structure follows narrative hierarchy:
    - headline: what the student most needs to know
    - verdict: the core boolean results
    - evidence: detailed violations and explanations
    """
    forge = CounterExampleForge()
    result = forge.check_group_axioms(req.table)

    # Also check associativity and commutativity
    assoc_result = forge.verify_associativity(req.table)
    comm_result = forge.check_commutativity(req.table)

    is_group = not result.success
    is_abelian = is_group and not comm_result.success

    # Narrative headline — the one thing the student should take away
    if is_group and is_abelian:
        headline = "四条公理悉数通过，运算可交换——这是一个交换群"
    elif is_group:
        headline = "群公理成立，但交换律被打破——这是一个非交换群"
    else:
        headline = "群公理未通过——这不是一个群"

    return {
        "headline": headline,
        "verdict": {
            "is_group": is_group,
            "is_abelian": is_abelian,
            "level": result.level.value,
        },
        "evidence": {
            "axiom_violation": result.counter_example,
            "explanation": result.explanation,
            "associativity": {
                "satisfied": not assoc_result.success,
                "violation": assoc_result.counter_example if assoc_result.success else None,
            },
            "commutativity": {
                "satisfied": not comm_result.success,
                "violation": comm_result.counter_example if comm_result.success else None,
            },
        },
    }


@app.post("/api/forge/find-non-associative")
async def find_non_associative(n: int = 3) -> dict[str, Any]:
    """Use Z3 to find a non-associative binary operation.

    Response structure:
    - headline: whether a counter-example was found
    - result: the counter-example and explanation
    - metadata: Z3 model details and verification level
    """
    forge = CounterExampleForge()
    result = forge.find_non_associative_table(n)
    return {
        "headline": "找到了一个不满足结合律的运算" if result.success else "所有运算都满足结合律",
        "result": {
            "found": result.success,
            "counter_example": result.counter_example,
            "explanation": result.explanation,
        },
        "metadata": {
            "z3_model": result.z3_model,
            "level": result.level.value,
        },
    }


@app.get("/api/metrics")
async def get_metrics() -> dict[str, Any]:
    """Get orchestrator metrics."""
    orch = get_orchestrator()
    return orch.get_metrics()


# --- Proof endpoints ---

class ProofSubmitRequest(BaseModel):
    theorem_id: str
    student_steps: list[str]
    curriculum_level: str | None = None


@app.get("/api/proof/theorems")
async def list_theorems(level: str | None = None) -> dict[str, Any]:
    """List available theorems for proof verification."""
    from ..proof.assistant import ProofAssistant
    pa = ProofAssistant(curriculum_level=level or "group_theory")
    theorems = pa.get_theorems_by_level(level or "group_theory")
    return {
        "headline": f"可用定理 · {len(theorems)} 道 · {level or 'group_theory'}",
        "theorems": theorems,
        "level": level or "group_theory",
        "count": len(theorems),
    }


@app.post("/api/proof/verify")
async def verify_proof(req: ProofSubmitRequest) -> dict[str, Any]:
    """Submit and verify a student proof."""
    from ..proof.assistant import ProofAssistant
    pa = ProofAssistant(curriculum_level=req.curriculum_level or "group_theory")
    result = pa.submit_proof(req.theorem_id, req.student_steps)
    return result.to_dict()


# --- Grill endpoints ---

class GrillStartRequest(BaseModel):
    student_id: str = "grill_student"
    curriculum_level: str | None = None


class GrillAnswerRequest(BaseModel):
    qid: str
    answer: str
    is_correct: bool | None = None
    response_time_ms: float = 5000.0


@app.post("/api/grill/start")
async def start_grill(req: GrillStartRequest) -> dict[str, Any]:
    """Start a Grill Me interview session."""
    orch = get_orchestrator()
    if req.curriculum_level:
        orch.switch_curriculum(req.curriculum_level)
    result = await orch.process_student_input("考考我")
    return result


@app.post("/api/grill/answer")
async def submit_grill_answer(req: GrillAnswerRequest) -> dict[str, Any]:
    """Submit a grill answer and get the next question."""
    orch = get_orchestrator()
    result = await orch.process_student_input(req.answer)
    return result


# --- NL→Z3 translation endpoint ---

class NLToZ3Request(BaseModel):
    claim: str = Field(..., min_length=1)


@app.post("/api/conjecture/translate")
async def nl_to_z3_translate(req: NLToZ3Request) -> dict[str, Any]:
    """Translate a natural-language conjecture into a Z3 verification task.

    Pipeline: NL → StructuredConjecture → Z3 → Verdict.
    Uses the LLM (if configured) to parse the claim, then Z3 for
    formal verification. Falls back to rule-based parsing offline.

    Response structure:
    - headline: human-readable summary of the verdict
    - verdict: confirmed / refuted / undecidable
    - counter_example: the refuting structure (if refuted)
    - explanation: why Z3 reached this verdict
    - smt_summary: the Z3 encoding used (human-readable)
    - structured_parse: the parsed conjecture structure
    """
    from ..conjecture.nl_translator import NLToZ3Translator

    llm = get_orchestrator().llm_client
    translator = NLToZ3Translator(llm_client=llm)
    result = await translator.translate_and_verify(req.claim)

    verdict = result.verdict
    if verdict == "confirmed":
        headline = "Z3 验证通过：猜想成立"
    elif verdict == "refuted":
        headline = f"Z3 找到反例：{result.counter_example}"
    else:
        headline = "Z3 无法判定此猜想"

    return {
        "headline": headline,
        **result.to_dict(),
    }


# --- Manim animation endpoints ---

@app.get("/api/animations")
async def list_animations() -> dict[str, Any]:
    """List all available pre-rendered animations.

    Returns animation metadata including whether a video file
    is available or if SVG frames should be used instead.
    """
    from ..animation.pipeline import get_animation_catalog

    catalog = get_animation_catalog()
    return {
        "headline": f"动画库 · {len(catalog.animations)} 个动画",
        "animations": catalog.list_ids(),
    }


@app.get("/api/animations/{anim_id}")
async def get_animation(anim_id: str) -> dict[str, Any]:
    """Get a specific animation's frame data (for SVG playback).

    If a pre-rendered video exists, returns its path; otherwise
    returns the SVG frames for client-side playback.
    """
    from ..animation.pipeline import get_animation_catalog

    catalog = get_animation_catalog()
    anim = catalog.get(anim_id)
    if anim is None:
        return structured_error(
            status=404,
            headline=f"未找到动画「{anim_id}」",
            detail="该动画不在当前动画库中。",
            recovery={
                "suggestion": "查看可用动画列表",
                "endpoint": "/api/animations",
            },
        )

    return {
        "headline": anim.title,
        "id": anim.id,
        "title": anim.title,
        "description": anim.description,
        "concept": anim.concept,
        "duration_s": anim.duration_s,
        "has_video": anim.video_path is not None,
        "video_url": f"/api/animations/{anim_id}/video" if anim.video_path else None,
        "frames": [
            {
                "svg": frame.svg,
                "duration_ms": frame.duration_ms,
                "caption": frame.caption,
            }
            for frame in anim.frames
        ],
        "manim_source": anim.manim_source if anim.manim_source else None,
    }


@app.get("/api/animations/{anim_id}/video")
async def get_animation_video(anim_id: str):
    """Stream a pre-rendered animation video file."""
    from fastapi.responses import FileResponse

    from ..animation.pipeline import get_animation_catalog

    catalog = get_animation_catalog()
    anim = catalog.get(anim_id)
    if anim is None or anim.video_path is None:
        return structured_error(
            status=404,
            headline="视频不可用",
            detail="该动画尚未渲染为视频。请使用 SVG 帧播放，或在安装 Manim 后重新渲染。",
        )

    return FileResponse(
        anim.video_path,
        media_type="video/mp4",
        filename=f"{anim_id}.mp4",
    )


# ---------------------------------------------------------------------------
# WebSocket for real-time teaching loop
# ---------------------------------------------------------------------------

class ConnectionManager:
    """Manage WebSocket connections."""

    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)

    async def send_json(self, ws: WebSocket, data: dict) -> None:
        await ws.send_text(json.dumps(data, ensure_ascii=False, default=str))


manager = ConnectionManager()


@app.websocket("/ws/teach")
async def websocket_teach(ws: WebSocket) -> None:
    """WebSocket endpoint for real-time teaching interaction.

    Protocol:
    - Client sends: {"type": "start", "student_id": "...", "target_node_id": "..."}
    - Client sends: {"type": "input", "student_input": "...", "response_time_ms": 5000}
    - Server sends: {"type": "response", ...} with full teaching loop result
    """
    await manager.connect(ws)
    orch = get_orchestrator()

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await manager.send_json(ws, {
                    "type": "error",
                    "headline": "无法解析消息",
                    "detail": "发送的消息不是有效的 JSON 格式。",
                    "recovery": "请以 {\"type\": \"input\", \"student_input\": \"...\"} 格式发送。",
                })
                continue
            msg_type = msg.get("type", "")

            if msg_type == "start":
                result = orch.start_session(
                    student_id=msg.get("student_id", "ws_student"),
                    student_name=msg.get("student_name", ""),
                    target_node_id=msg.get("target_node_id", "group_definition"),
                )
                await manager.send_json(ws, {"type": "session_started", **result})

            elif msg_type == "input":
                result = await orch.process_student_input(
                    student_input=msg.get("student_input", ""),
                    input_metadata={
                        "response_time_ms": msg.get("response_time_ms", 5000),
                    },
                )
                await manager.send_json(ws, {"type": "response", **result})

            elif msg_type == "state":
                snapshot = orch.get_state_snapshot()
                await manager.send_json(ws, {"type": "state", **snapshot})

            elif msg_type == "ping":
                await manager.send_json(ws, {"type": "pong"})

    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        logger.exception("WebSocket error")
        try:
            await manager.send_json(ws, {
                "type": "error",
                "headline": "连接遇到了问题",
                "detail": "服务器在处理请求时发生了异常。",
                "recovery": "请重新连接后重试。",
            })
        except Exception:
            pass
        manager.disconnect(ws)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup() -> None:
    logger.info("MathWeaver API starting up...")
    # Pre-initialize orchestrator
    get_orchestrator()
    logger.info("Orchestrator initialized with %d DAG nodes", len(get_dag().get_all_nodes()))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "mathweaver.api.app:app",
        host=_config.host,
        port=_config.port,
        reload=True,
    )
