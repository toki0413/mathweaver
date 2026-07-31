"""Orchestrator: Four-field coupling engine.

This is the central coordinator that:
1. Maintains the FourFieldState (single-writer pattern)
2. Routes messages between agents
3. Makes pedagogical decisions based on field coupling
4. Manages the teaching loop state machine

State machine phases:
  PERCEIVE -> ABSTRACT -> VERIFY -> DIAGNOSE -> REFLECT -> PERCEIVE
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from ..audit.exporter import AuditExporter
from ..communication.bus import MessageBus
from ..context import ContextMessage, TaskDecomposition
from ..counterexample.forge import CounterExampleForge, CounterExampleResult
from ..dag.concept_dag import ConceptDAG, get_dag
from ..evidence.chain import EvidenceChain
from ..grill.adaptive import AdaptiveDifficulty
from ..grill.encouragement import EncouragementEngine
from ..models.state import (
    AgentMessage,
    AgentRole,
    CognitiveState,
    EmotionalState,
    FourFieldState,
    StudentProfile,
)
from ..observability.metrics import MetricsCollector
from ..observability.trace import SpanStatus, TraceCollector
from ..persistence.store import StateStore
from ..rag.retriever import KnowledgeBase, build_default_kb
from ..safety.approval import ApprovalGate, ApprovalStatus, RiskLevel
from ..safety.checkpoint import CheckpointManager
from ..topology.config import TopologyConfig

logger = logging.getLogger(__name__)


class SessionPhase(str, Enum):
    """Phases of the teaching loop."""

    IDLE = "idle"
    PERCEIVE = "perceive"          # Perception Agent observes student input
    ABSTRACT = "abstract"           # Abstraction Agent extracts formal structure
    VERIFY = "verify"               # Counter-Example Agent verifies
    DIAGNOSE = "diagnose"           # Epistemic Agent diagnoses cognitive state
    REFLECT = "reflect"             # Historical Agent provides context
    COLLABORATE = "collaborate"     # Collaboration Agent synthesizes response
    DELIVER = "deliver"             # Final response to student


# ---------------------------------------------------------------------------
# Teaching Decision
# ---------------------------------------------------------------------------

@dataclass
class TeachingDecision:
    """A decision made by the orchestrator based on four-field coupling."""

    action: str
    reason: str
    field_signals: dict[str, Any] = field(default_factory=dict)
    hint_level: int = 0
    next_phase: SessionPhase = SessionPhase.PERCEIVE


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class Orchestrator:
    """The central orchestrator implementing four-field coupling.

    Implements the single-writer pattern: only the orchestrator
    writes to the FourFieldState. Agents read the state and produce
    messages with proposed field updates, which the orchestrator
    applies atomically.
    """

    def __init__(
        self,
        dag: ConceptDAG | None = None,
        forge: CounterExampleForge | None = None,
        llm_client: Any = None,
        db_path: str = "mathweaver.db",
        audit_path: str | None = None,
        topology: TopologyConfig | None = None,
        curriculum_level: str = "group_theory",
    ) -> None:
        self.curriculum_level = curriculum_level
        self.dag = dag or get_dag(curriculum_level)
        self.forge = forge or CounterExampleForge(llm_client=llm_client)
        self.llm_client = llm_client
        self.state = FourFieldState()
        self.profile: StudentProfile | None = None
        self.phase: SessionPhase = SessionPhase.IDLE
        self.message_history: list[AgentMessage] = []
        self._session_start: datetime | None = None
        self.evidence_chain: EvidenceChain | None = None
        self.context_messages: list[ContextMessage] = []

        # 5.3: Configurable agent topology
        self.topology = topology or TopologyConfig.default()

        # 7.2: Trace collector (created per session)
        self.trace_collector: TraceCollector | None = None
        # 7.3: Metrics collector (session-level)
        self.metrics_collector = MetricsCollector()
        # 5.1: Message bus for explicit agent communication
        self.message_bus = MessageBus()
        # 6.5: Checkpoint manager for state rollback
        self.checkpoint_manager = CheckpointManager()
        # 6.4: HITL approval gate
        self.approval_gate = ApprovalGate()
        # 7.1: Audit exporter (created per session with evidence chain)
        self.audit_exporter: AuditExporter | None = None
        self._audit_path: str | None = audit_path
        # 8.1: SQLite state persistence
        self.state_store = StateStore(db_path=db_path)
        # 3.5: RAG knowledge base
        self.knowledge_base: KnowledgeBase = build_default_kb()

        # S2: Decision effectiveness tracker (feedback pipeline)
        from ..evolution.feedback import DecisionEffectivenessTracker
        self.feedback_tracker = DecisionEffectivenessTracker()

        # Grill Me mode: session for interviewing the student
        from ..grill.session import GrillSession
        self.grill_session: GrillSession | None = None

        # Initialize independent agents (1.1: each agent is a self-contained class)
        from ..agents import (
            AbstractionAgent,
            CollaborationAgent,
            CounterExampleAgent,
            EpistemicAgent,
            HistoricalAgent,
            MetaEvolutionAgent,
            PerceptionAgent,
        )

        # S3: Meta-evolution agent with parameter learner
        from ..evolution.param_learner import ParameterLearner
        self.param_learner = ParameterLearner()

        self.agents: dict[str, Any] = {
            "perception": PerceptionAgent(llm_client=llm_client),
            "abstraction": AbstractionAgent(llm_client=llm_client),
            "counter_example": CounterExampleAgent(forge=self.forge, llm_client=llm_client),
            "epistemic": EpistemicAgent(llm_client=llm_client),
            "historical": HistoricalAgent(llm_client=llm_client, knowledge_base=self.knowledge_base),
            "collaboration": CollaborationAgent(llm_client=llm_client),
            "meta": MetaEvolutionAgent(llm_client=llm_client, param_learner=self.param_learner),
        }

    # -- Session Management --

    def start_session(
        self,
        student_id: str,
        student_name: str = "",
        target_node_id: str | None = None,
        curriculum_level: str | None = None,
    ) -> dict[str, Any]:
        """Start a new teaching session.

        Args:
            student_id: Unique student identifier.
            student_name: Display name.
            target_node_id: Optional starting concept node.
            curriculum_level: Optional curriculum level to switch to
                (elementary / middle_school / high_school / group_theory).
        """
        # Switch curriculum if requested
        if curriculum_level and curriculum_level != self.curriculum_level:
            self.switch_curriculum(curriculum_level)

        self.profile = StudentProfile(student_id=student_id, name=student_name)
        self.state = FourFieldState()
        self.phase = SessionPhase.PERCEIVE
        self.message_history = []
        self.evidence_chain = EvidenceChain(session_id=student_id)
        self.context_messages = []

        # 7.2: Initialize trace collector for this session
        self.trace_collector = TraceCollector(session_id=student_id)
        # 5.1: Clear message bus for new session
        self.message_bus.clear()
        # 7.1: Initialize audit exporter
        self.audit_exporter = AuditExporter(self.evidence_chain)

        # 8.1: Try to load previous session state from persistence
        prev_state = self.state_store.load_session(student_id)
        if prev_state:
            try:
                self.state = FourFieldState.model_validate(prev_state["state"])
                # Validate that the restored current_node_id exists in the
                # current DAG — stale state from a different curriculum level
                # would cause grill sessions and routing to break.
                restored_node = self.state.knowledge.current_node_id
                if restored_node and not self.dag.get_node(restored_node):
                    logger.warning(
                        "Restored current_node_id '%s' not in DAG "
                        "'%s', resetting to None",
                        restored_node, self.curriculum_level,
                    )
                    self.state.knowledge.current_node_id = None
                logger.info("Restored state for session %s", student_id)
            except Exception:
                logger.warning("Failed to restore state, starting fresh")

        self._session_start = datetime.now(timezone.utc)

        # Set initial knowledge field
        if target_node_id:
            node = self.dag.get_node(target_node_id)
            if node:
                self.state.knowledge.current_node_id = target_node_id
                self.state.knowledge.mastery_estimate = self.profile.get_mastery(target_node_id)

                # Check prerequisites
                gaps = self.dag.check_prerequisites(target_node_id, self.profile.dag_mastery)
                self.state.knowledge.prerequisite_gaps = gaps

                return {
                    "session_id": f"sess_{student_id}_{int(self._session_start.timestamp())}",
                    "student_id": student_id,
                    "target_node": target_node_id,
                    "node_name": node.name,
                    "node_description": node.description,
                    "prerequisite_gaps": gaps,
                    "learning_path": self.dag.get_learning_path(target_node_id, self.profile.dag_mastery),
                    "phase": self.phase.value,
                }

        return {
            "session_id": f"sess_{student_id}_{int(self._session_start.timestamp())}",
            "student_id": student_id,
            "phase": self.phase.value,
        }

    def get_state_snapshot(self) -> dict[str, Any]:
        """Return current four-field state snapshot."""
        return {
            "phase": self.phase.value,
            "four_fields": self.state.snapshot(),
            "current_node": self.state.knowledge.current_node_id,
            "in_zpd": self.state.knowledge.in_zpd,
            "cognitive_overloaded": self.state.cognitive.is_overloaded,
            "emotional_state": self.state.emotional.state.value,
            "in_flow": self.state.emotional.in_flow,
            "should_fade_scaffold": self.state.interaction.should_fade_scaffold,
        }

    def get_metrics(self) -> dict[str, Any]:
        """Return current metrics summary (7.3: for /metrics endpoint)."""
        return self.metrics_collector.summary()

    def switch_curriculum(self, level: str) -> None:
        """Switch to a different curriculum level.

        Replaces the DAG, resets grill session, and updates the current
        knowledge node to the first concept of the new curriculum.
        """
        from ..dag.concept_dag import CURRICULUM_LABELS, CURRICULUM_LEVELS, get_dag

        if level not in CURRICULUM_LEVELS:
            raise ValueError(
                f"Unknown curriculum level: {level}. Available: {CURRICULUM_LEVELS}"
            )

        self.curriculum_level = level
        self.dag = get_dag(level)

        # Reset grill session — the old session was tied to the old DAG
        self.grill_session = None

        # Update knowledge field to first node of new curriculum
        all_nodes = self.dag.get_all_nodes()
        if all_nodes:
            first = min(all_nodes, key=lambda n: n.abstraction_level)
            self.state.knowledge.current_node_id = first.id

        logger.info(
            "Switched curriculum to [%s] (%s), %d concepts",
            level, CURRICULUM_LABELS.get(level, level),
            self.dag.get_node_count(),
        )

    def _detect_curriculum_switch(self, text: str) -> tuple[str, str] | None:
        """Detect if student wants to switch curriculum level.

        Returns (level, label) tuple if a switch is detected, None otherwise.
        """
        from ..dag.concept_dag import CURRICULUM_LABELS

        text_lower = text.lower()

        # Mapping: keywords → curriculum level
        switch_map: dict[str, list[str]] = {
            "elementary": ["小学", "elementary", "primary"],
            "middle_school": ["初中", "middle school", "中学"],
            "high_school": ["高中", "high school"],
            "group_theory": ["群论", "group theory", "大学", "抽象代数"],
        }

        # Check for switch intent + level keyword
        switch_verbs = ["切换", "学", "想学", "换", "转到", "switch", "change"]
        has_switch_intent = any(v in text_lower for v in switch_verbs)

        for level, keywords in switch_map.items():
            if any(kw in text_lower for kw in keywords):
                # Either explicit switch verb or direct level mention
                if has_switch_intent or level != self.curriculum_level:
                    return (level, CURRICULUM_LABELS.get(level, level))

        return None

    def get_curriculum_info(self) -> dict[str, Any]:
        """Return current curriculum information for UI display."""
        from ..dag.concept_dag import CURRICULUM_LABELS, get_available_curricula

        summary = self.dag.get_curriculum_summary()
        return {
            "current_level": self.curriculum_level,
            "current_label": CURRICULUM_LABELS.get(self.curriculum_level, self.curriculum_level),
            "current_summary": summary,
            "available": get_available_curricula(),
        }

    def rollback(self, checkpoint_id: str) -> bool:
        """Rollback the four-field state to a previous checkpoint (6.5).

        Args:
            checkpoint_id: The checkpoint to restore.

        Returns:
            True if rollback succeeded, False if checkpoint not found.
        """
        # 6.4: Check approval gate for state rollback
        if self.approval_gate.should_gate("state_rollback"):
            req_id = self.approval_gate.request_approval(
                "state_rollback",
                reason=f"Rollback to checkpoint {checkpoint_id}",
                risk_level=RiskLevel.HIGH,
            )
            status = self.approval_gate.await_approval(req_id)
            if status not in (ApprovalStatus.APPROVED, ApprovalStatus.AUTO_APPROVED):
                logger.warning("Rollback blocked by approval gate (status=%s)", status.value)
                return False

        restored = self.checkpoint_manager.restore_checkpoint(checkpoint_id)
        if restored is None:
            return False
        self.state = restored
        logger.info("Rolled back to checkpoint %s", checkpoint_id)
        return True

    # -- Message Routing (Single-Writer) --

    def _apply_field_update(self, field_name: str, updates: dict[str, Any]) -> None:
        """Apply a field update atomically (single-writer pattern).

        Validates field name, type, and range constraints before applying.
        Rejects invalid updates silently (logged at warning level).
        """
        # Map field name to the Pydantic model instance
        field_map = {
            "knowledge": self.state.knowledge,
            "cognitive": self.state.cognitive,
            "emotional": self.state.emotional,
            "interaction": self.state.interaction,
        }

        model = field_map.get(field_name)
        if model is None:
            logger.warning("Rejected field update: unknown field '%s'", field_name)
            return

        # Type/range constraints per field
        float_01_fields = {
            "knowledge": {"mastery_estimate", "misconception_rate"},
            "cognitive": {"cognitive_load"},
            "emotional": {"anxiety_index", "flow_score", "skip_rate"},
            "interaction": {"hint_dependency"},
        }
        int_fields = {
            "cognitive": {"backtrack_count", "trial_sequence_length"},
            "interaction": {"current_hint_level", "consecutive_correct",
                            "scaffold_fade_threshold"},
        }
        non_negative_floats = {
            "cognitive": {"response_time_ms", "baseline_rt_ms",
                          "struggle_duration_s"},
            "interaction": {"struggle_duration_s"},
        }

        ok_01 = float_01_fields.get(field_name, set())
        ok_int = int_fields.get(field_name, set())
        ok_nn_float = non_negative_floats.get(field_name, set())

        for key, val in updates.items():
            if not hasattr(model, key):
                logger.warning("Rejected: %s.%s does not exist", field_name, key)
                continue

            # Validate float in [0, 1]
            if key in ok_01:
                if not isinstance(val, (int, float)) or not (0.0 <= val <= 1.0):
                    logger.warning("Rejected: %s.%s = %r out of [0,1]", field_name, key, val)
                    continue

            # Validate non-negative int
            if key in ok_int:
                if not isinstance(val, int) or val < 0:
                    logger.warning("Rejected: %s.%s = %r not non-negative int", field_name, key, val)
                    continue

            # Validate non-negative float
            if key in ok_nn_float:
                if not isinstance(val, (int, float)) or val < 0:
                    logger.warning("Rejected: %s.%s = %r not non-negative", field_name, key, val)
                    continue

            setattr(model, key, val)

        self.state.updated_at = datetime.now(timezone.utc)

    # -- Pedagogical Decision Engine --

    def make_decision(self) -> TeachingDecision:
        """Make a pedagogical decision based on four-field coupling.

        This is the core coupling logic: the orchestrator reads all
        four fields simultaneously and decides the next action.
        """
        k = self.state.knowledge
        c = self.state.cognitive
        e = self.state.emotional
        i = self.state.interaction

        # Case 1: Student is overwhelmed — reduce load
        if c.is_overloaded and not e.in_flow:
            return TeachingDecision(
                action="reduce_abstraction",
                reason=f"Cognitive overload detected (RT z-score={c.rt_zscore:.2f}), "
                       f"reducing abstraction level",
                field_signals={"cognitive_load": c.cognitive_load, "rt_zscore": c.rt_zscore},
                hint_level=min(i.current_hint_level + 1, 3),
                next_phase=SessionPhase.COLLABORATE,
            )

        # Case 2: Student is anxious — provide emotional support
        if e.is_anxious:
            return TeachingDecision(
                action="emotional_support",
                reason=f"Anxiety index {e.anxiety_index:.2f} exceeds threshold, "
                       f"providing scaffolding before proceeding",
                field_signals={"anxiety_index": e.anxiety_index},
                hint_level=min(i.current_hint_level + 1, 3),
                next_phase=SessionPhase.REFLECT,
            )

        # Case 3: Student is in flow — advance
        if e.in_flow and k.ready_to_advance:
            return TeachingDecision(
                action="advance",
                reason="Student is in flow and mastery exceeds ZPD upper bound, advancing",
                field_signals={"flow_score": e.flow_score, "mastery": k.mastery_estimate},
                hint_level=0,
                next_phase=SessionPhase.ABSTRACT,
            )

        # Case 4: Student in ZPD — continue guided discovery
        if k.in_zpd:
            return TeachingDecision(
                action="guided_discovery",
                reason="Mastery is in ZPD grey area, continuing guided discovery",
                field_signals={"mastery": k.mastery_estimate, "zpd_range": [k.zpd_lower, k.zpd_upper]},
                hint_level=max(i.current_hint_level - 1, 0) if i.should_fade_scaffold else i.current_hint_level,
                next_phase=SessionPhase.VERIFY,
            )

        # Case 5: Student struggling — provide hint
        if i.is_struggling:
            return TeachingDecision(
                action="provide_hint",
                reason=f"Struggle duration {i.struggle_duration_s:.0f}s, providing hint level {i.current_hint_level + 1}",
                field_signals={"struggle_duration": i.struggle_duration_s},
                hint_level=min(i.current_hint_level + 1, 3),
                next_phase=SessionPhase.COLLABORATE,
            )

        # Default: continue current phase
        return TeachingDecision(
            action="continue",
            reason="No special condition detected, continuing current phase",
            next_phase=self.phase,
        )

    def _execute_decision(self, decision: TeachingDecision) -> None:
        """Execute the pedagogical decision, mutating orchestrator state.

        This bridges the gap between make_decision() (which computes what to do)
        and the actual state changes.  Previously the decision was only passed as
        metadata; now it drives real transitions:

        - advance:            actually move current_node_id to the next DAG node
        - reduce_abstraction:  bump hint_level
        - emotional_support:   bump hint_level
        - provide_hint:       bump hint_level
        - guided_discovery:    fade scaffold if appropriate
        """
        # Apply hint level change to interaction field
        if decision.hint_level != self.state.interaction.current_hint_level:
            old = self.state.interaction.current_hint_level
            self.state.interaction.current_hint_level = decision.hint_level
            logger.info(
                "Decision '%s': hint_level %d -> %d",
                decision.action, old, decision.hint_level,
            )

        # Advance: actually move the DAG pointer
        if decision.action == "advance":
            current = self.state.knowledge.current_node_id
            if current:
                dependents = self.dag.get_dependents(current)
                if dependents:
                    next_id = dependents[0]
                    next_node = self.dag.get_node(next_id)
                    if next_node:
                        old_id = current
                        self.state.knowledge.current_node_id = next_id
                        # Store old id for response reporting
                        self._last_advanced_from = old_id
                        self._last_advanced_to = next_id
                        # Reset mastery for the new node (student starts fresh)
                        self.state.knowledge.mastery_estimate = 0.0
                        # Clear prerequisite gaps for the new node
                        self.state.knowledge.prerequisite_gaps = []
                        # Reset consecutive correct counter
                        self.state.interaction.consecutive_correct = 0
                        logger.info(
                            "DAG advance executed: %s -> %s (%s)",
                            old_id, next_id, next_node.name,
                        )

        # Guided discovery: fade scaffold if threshold met
        if decision.action == "guided_discovery":
            if self.state.interaction.should_fade_scaffold:
                self.state.interaction.hint_dependency = max(
                    self.state.interaction.hint_dependency - 0.1, 0.0
                )

        # Apply phase transition
        if decision.next_phase != SessionPhase.IDLE:
            self.phase = decision.next_phase

    # -- Agent Execution with Exception Isolation --

    async def _safe_agent_run(
        self,
        agent_name: str,
        ctx: AgentContext,
        root_span_id: str,
        span_id: str,
    ) -> AgentMessage | None:
        """Run an agent with exception isolation.

        If the agent raises, log the error, end the trace span with ERROR
        status, and return None. The caller decides how to handle the
        failure (skip, fallback, or deliver error message).
        """
        agent = self.agents[agent_name]
        try:
            msg = await agent.run(ctx)
            return msg
        except Exception as e:
            logger.error(
                "Agent '%s' raised exception: %s: %s",
                agent_name, type(e).__name__, e,
                exc_info=True,
            )
            # End span with error status
            if self.trace_collector is not None and span_id:
                try:
                    self.trace_collector.end_span(
                        span_id,
                        output_summary=f"[ERROR] {type(e).__name__}: {str(e)[:100]}",
                        tool_calls=[],
                        status=SpanStatus.ERROR,
                    )
                except Exception:
                    pass  # Don't let trace errors mask the real error
            return None

    # -- Teaching Loop --

    async def process_student_input(
        self,
        student_input: str,
        input_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Process student input through the LLM-driven agent loop.

        Instead of a fixed pipeline, the LLM decides which agent to call next.
        Different inputs produce different execution paths (acceptance 1.2).
        The loop continues until the LLM says "deliver" or max iterations.
        """
        input_metadata = input_metadata or {}
        rt_ms = input_metadata.get("response_time_ms", 5000)

        # Track turn duration for metrics (7.3)
        turn_start = datetime.now(timezone.utc)

        # Update cognitive field from response time
        if "response_time_ms" in input_metadata:
            self.state.cognitive.update_rt(rt_ms)

        # 7.2: Start root trace span
        root_span_id = ""
        if self.trace_collector is not None:
            root_span_id = self.trace_collector.start_root_span(
                input_summary=student_input[:200],
                metadata={"response_time_ms": rt_ms},
            )

        # 6.5: Save checkpoint before processing (rollback point)
        checkpoint_id = self.checkpoint_manager.save_checkpoint(
            self.state, label=f"before_input_{datetime.now(timezone.utc).isoformat()}"
        )

        # --- Curriculum switch detection ---
        # Students can switch between curriculum levels by saying things like
        # "我想学小学数学" / "切换到初中" / "学高中" / "switch to elementary"
        switched = self._detect_curriculum_switch(student_input)
        if switched:
            level, label = switched
            self.switch_curriculum(level)
            return {
                "response": (
                    f"已切换到「{label}」课程体系！\n"
                    f"当前课程包含 {self.dag.get_node_count()} 个概念，"
                    f"涵盖 {len(self.dag.get_curriculum_summary().get('domains', []))} 个知识域。\n"
                    f"你可以开始学习，或说「考考我」进入提问模式。"
                ),
                "curriculum_switched": True,
                "curriculum_level": level,
                "curriculum_label": label,
                "curriculum_summary": self.dag.get_curriculum_summary(),
            }

        # --- Grill Me mode detection ---
        # Trigger: student says "考考我" / "grill me" / "考考看" / "来考考"
        grill_trigger_keywords = ["考考我", "grill me", "考考看", "来考考", "审问我", "面试我"]
        is_grill_trigger = any(kw in student_input.lower() for kw in grill_trigger_keywords)

        if is_grill_trigger and self.grill_session is None:
            # Initialize grill session with LLM client for dynamic question generation
            from ..grill.session import GrillSession
            self.grill_session = GrillSession(
                dag=self.dag,
                current_node_id=self.state.knowledge.current_node_id or "group_definition",
                llm_client=self.llm_client,
            )
            self.grill_session.activate()
            logger.info("Grill mode activated by student request")
        elif is_grill_trigger and self.grill_session is not None:
            # Re-trigger: reactivate existing session
            self.grill_session.activate()
            logger.info("Grill mode re-activated by student request")

        # --- Proof mode detection ---
        # When student writes a proof, the orchestrator runs the proof
        # assistant directly and passes results to the collaboration agent.
        proof_trigger_keywords = ["证明", "求证", "prove", "proof", "我要证", "验证以下"]
        is_proof = any(kw in student_input.lower() for kw in proof_trigger_keywords)
        proof_result_data: dict[str, Any] | None = None

        if is_proof:
            proof_result_data = self._handle_proof(student_input)
            logger.info(
                "Proof mode: theorem=%s, progress=%s",
                proof_result_data.get("theorem_name", "?"),
                proof_result_data.get("progress", "?"),
            )

        # --- Track Cayley tables for grill session "codebase-first" ---
        if self.grill_session is not None:
            # Update response time for adaptive tracking
            self.grill_session._last_response_time_ms = rt_ms

            if student_input.strip().startswith("[") and student_input.strip().endswith("]"):
                try:
                    import json as _json
                    table = _json.loads(student_input.strip())
                    if isinstance(table, list) and all(isinstance(r, list) for r in table):
                        self.grill_session.record_cayley_table(table)
                except Exception:
                    pass

        # LLM-driven agent loop (1.2: LLM controls flow, not hardcoded pipeline)
        from ..agents import AgentContext
        from ..llm.client import MockLLMClient

        llm = self.llm_client or MockLLMClient()

        prior_results: dict[str, Any] = {}
        phase_trace: list[str] = []
        full_trace: list[dict[str, Any]] = []
        max_iterations = self.topology.max_iterations
        called_agents: set[str] = set()
        session_id = self.profile.student_id if self.profile else "unknown"
        total_tokens_used = 0  # Track LLM token usage across this turn

        # Pre-compute a default decision in case the loop exits early
        # (e.g., topology routes directly to exit without entering the deliver branch)
        decision = self.make_decision()

        # 5.3: Track last agent for topology routing validation
        # Start as "orchestrator" (virtual node) — entry_agent is always routable from orchestrator
        last_agent = "orchestrator"

        # 2.1: LLM generates task decomposition (not hardcoded)
        decomposition = await self._decompose_task(llm, student_input)
        full_trace.append({"phase": "decompose", "decomposition": decomposition.to_dict()})

        # Track tokens from decomposition call (if using OpenAICompatibleClient)
        if hasattr(llm, "_total_tokens"):
            total_tokens_used = llm._total_tokens

        for iteration in range(max_iterations):
            # Ask LLM which agent to call next
            # 5.3: Filter available agents by topology connections
            agent_descriptions = {
                name: agent.describe()
                for name, agent in self.agents.items()
                if name not in called_agents or name == self.topology.exit_agent
            }
            # 5.3: Further filter by topology routing rules
            if called_agents:
                # After first agent, restrict by topology connections
                topology_allowed = set(self.topology.available_from(last_agent))
            else:
                # Before any agent called: entry_agent is always available
                topology_allowed = {self.topology.entry_agent}
            topology_allowed.add(self.topology.exit_agent)  # exit always allowed
            agent_descriptions = {
                name: desc for name, desc in agent_descriptions.items()
                if name in topology_allowed or name not in self.topology.agents
            }

            llm_input = self._build_llm_input(
                student_input, prior_results, called_agents, agent_descriptions
            )

            llm_resp = await llm.chat(
                system_prompt=self._system_prompt(),
                user_message=llm_input,
            )
            # Accumulate token usage from LLM responses
            if hasattr(llm_resp, "usage") and llm_resp.usage:
                total_tokens_used += llm_resp.usage.get("total_tokens", 0)

            # LLM decides to deliver
            if llm_resp.next_action == "deliver" or iteration == max_iterations - 1:
                # Run exit agent for final synthesis
                exit_name = self.topology.exit_agent

                # Compute pedagogical decision BEFORE collaboration
                # so the agent can adapt its style (reduce_abstraction, emotional_support, etc.)
                decision = self.make_decision()

                # Execute the decision: actually mutate state (hint level, DAG advance, etc.)
                self._execute_decision(decision)

                # S2: Record decision for effectiveness tracking
                turn_id = f"turn_{len(self.metrics_collector._turns)}"
                self.feedback_tracker.record_decision(decision, self.state, turn_id)

                # --- Grill Me mode: prepare grill session data for collaboration agent ---
                grill_data = None
                if self.grill_session is not None and self.grill_session.is_active:
                    # Record conjecture result if this was a conjecture input
                    ce_result = prior_results.get("counter_example", {})
                    ce_meta = ce_result.get("metadata", {})
                    if ce_meta.get("conjecture_verdict"):
                        self.grill_session.record_conjecture(
                            text=ce_meta.get("conjecture_result", {}).get("claim", student_input),
                            verdict=ce_meta["conjecture_verdict"],
                            counter_example=ce_meta.get("conjecture_counter_example"),
                        )

                    # Get next grill question (pre-generate if needed)
                    if self.grill_session is not None:
                        # Find the next pending branch and ensure it has questions
                        for nid, br in self.grill_session.branches.items():
                            if br.status == "pending":
                                await self.grill_session.ensure_questions_for(nid)
                                break
                    grill_q = self.grill_session.next_question()
                    grill_data = {
                        "active": True,
                        "next_question": grill_q.to_dict() if grill_q else None,
                        "summary": self.grill_session.get_summary(),
                        "conjecture_history": self.grill_session.get_conjecture_history(),
                    }

                ctx = AgentContext(
                    student_input=student_input,
                    four_field_state=self.state,
                    prior_results=prior_results,
                    metadata={
                        "response_time_ms": rt_ms,
                        "pedagogical_decision": {
                            "action": decision.action,
                            "reason": decision.reason,
                            "hint_level": decision.hint_level,
                            "field_signals": decision.field_signals,
                        },
                        "grill_session": grill_data,
                        "proof_result": proof_result_data,
                    },
                )

                # 2.2: Create explicit context message
                ctx_msg = ContextMessage.create(
                    session_id=session_id,
                    from_agent="orchestrator",
                    to_agent=exit_name,
                    student_input=student_input,
                    prior_results=prior_results,
                    four_field_snapshot=self.state.snapshot(),
                    task_decomposition=decomposition.steps,
                    metadata={"response_time_ms": rt_ms},
                )
                self.context_messages.append(ctx_msg)
                # 5.1: Publish to message bus
                self.message_bus.publish_context(ctx_msg)

                # 7.2: Start child span
                collab_span_id = ""
                if self.trace_collector is not None:
                    collab_span_id = self.trace_collector.start_span(
                        agent_name=exit_name,
                        phase="collaborate",
                        parent_span_id=root_span_id,
                        input_summary=student_input[:200],
                    )

                msg = await self._safe_agent_run(exit_name, ctx, root_span_id, collab_span_id)
                if msg is None:
                    # Agent failed, but we still need to deliver a response
                    from ..agents.base import AgentMessage
                    from ..models.state import AgentRole
                    msg = AgentMessage(
                        role=AgentRole.COLLABORATION,
                        content=(
                            "抱歉，系统在生成回应时遇到了内部错误。"
                            "请重新尝试你的问题。"
                        ),
                        confidence=0.1,
                        metadata={"error_recovery": True},
                    )
                self.message_history.append(msg)
                # 5.1: Publish agent message to bus
                self.message_bus.publish(msg, from_agent=exit_name)
                prior_results[exit_name] = {
                    "content": msg.content,
                    "metadata": msg.metadata,
                }
                phase_trace.append("collaborate")
                full_trace.append({
                    "phase": "collaborate",
                    "agent": exit_name,
                    "result": {"content": msg.content},
                    "iteration": iteration,
                    "tool_calls": len(msg.tool_calls),
                })

                # 7.2: End child span
                if self.trace_collector is not None and collab_span_id:
                    self.trace_collector.end_span(
                        collab_span_id,
                        output_summary=msg.content[:200],
                        tool_calls=msg.tool_calls,
                        status=SpanStatus.OK,
                    )

                # 4.2: Record evidence
                if self.evidence_chain is not None:
                    self.evidence_chain.append(
                        agent_name=exit_name,
                        phase="collaborate",
                        input_summary=student_input[:200],
                        output_summary=msg.content[:200],
                        tool_calls=msg.tool_calls,
                        field_updates=msg.field_updates,
                        confidence=msg.confidence,
                        metadata=msg.metadata,
                    )
                break

            # LLM decides which agent to call
            next_agent_name = llm_resp.next_agent
            # 5.3: Reject agents not in topology
            if next_agent_name and not self.topology.is_active(next_agent_name):
                logger.info("Agent '%s' not in topology, ignoring", next_agent_name)
                next_agent_name = None
            if not next_agent_name or next_agent_name not in self.agents:
                if self.topology.exit_agent not in called_agents:
                    next_agent_name = self.topology.exit_agent
                else:
                    break

            # 5.3: Validate routing against topology
            if self.topology.is_active(next_agent_name):
                if next_agent_name != self.topology.exit_agent:
                    # Allow orchestrator -> entry_agent, and topology-validated routes
                    is_entry = (not called_agents and next_agent_name == self.topology.entry_agent)
                    if not is_entry and not self.topology.can_route(last_agent, next_agent_name):
                        logger.warning(
                            "Topology blocked route %s -> %s, falling back to exit",
                            last_agent, next_agent_name,
                        )
                        next_agent_name = self.topology.exit_agent

            agent = self.agents[next_agent_name]
            called_agents.add(next_agent_name)
            last_agent = next_agent_name  # 5.3: update for next iteration
            phase_name = self._agent_to_phase(next_agent_name)
            self.phase = phase_name

            # 2.2: Build explicit context message for this agent
            ctx_msg = ContextMessage.create(
                session_id=session_id,
                from_agent="orchestrator",
                to_agent=next_agent_name,
                student_input=student_input,
                prior_results=prior_results,
                four_field_snapshot=self.state.snapshot(),
                task_decomposition=decomposition.steps,
                metadata={"response_time_ms": rt_ms},
            )
            self.context_messages.append(ctx_msg)
            # 5.1: Publish to message bus
            self.message_bus.publish_context(ctx_msg)

            # 7.2: Start child span for this agent
            agent_span_id = ""
            if self.trace_collector is not None:
                agent_span_id = self.trace_collector.start_span(
                    agent_name=next_agent_name,
                    phase=phase_name.value,
                    parent_span_id=root_span_id,
                    input_summary=student_input[:200],
                )

            # Build context for this agent
            ctx = AgentContext(
                student_input=student_input,
                four_field_state=self.state,
                prior_results=prior_results,
                metadata={"response_time_ms": rt_ms},
            )

            # Run the agent (with exception isolation)
            msg = await self._safe_agent_run(next_agent_name, ctx, root_span_id, agent_span_id)
            if msg is None:
                # Agent failed — skip to next iteration or exit
                logger.warning(
                    "Agent '%s' failed, skipping (iteration %d)",
                    next_agent_name, iteration,
                )
                # Record partial evidence of the failure
                if self.evidence_chain is not None:
                    self.evidence_chain.append(
                        agent_name=next_agent_name,
                        phase=phase_name.value,
                        input_summary=student_input[:200],
                        output_summary="[AGENT ERROR - skipped]",
                        tool_calls=[],
                        field_updates={},
                        confidence=0.0,
                        metadata={"error_recovery": True},
                    )
                continue
            self.message_history.append(msg)
            # 5.1: Publish agent message to bus
            self.message_bus.publish(msg, from_agent=next_agent_name)

            # Apply field updates (single-writer: orchestrator applies, not agent)
            for field_name, updates in msg.field_updates.items():
                # 6.4: Check approval gate for high-risk operations
                if field_name == "knowledge" and "mastery_estimate" in updates:
                    delta = abs(updates["mastery_estimate"] - self.state.knowledge.mastery_estimate)
                    if delta > 0.1:
                        req_id = self.approval_gate.request_approval(
                            "mastery_change",
                            reason=f"mastery delta {delta:.2f} exceeds threshold",
                            risk_level=RiskLevel.HIGH,
                        )
                        status = self.approval_gate.await_approval(req_id)
                        if status not in (ApprovalStatus.APPROVED, ApprovalStatus.AUTO_APPROVED):
                            logger.warning("Mastery change blocked by approval gate (status=%s)", status.value)
                            continue
                self._apply_field_update(field_name, updates)

            # 7.2: End child span
            if self.trace_collector and agent_span_id:
                self.trace_collector.end_span(
                    agent_span_id,
                    output_summary=msg.content[:200],
                    tool_calls=msg.tool_calls,
                    status=SpanStatus.OK,
                )

            # Store result for next agent
            prior_results[next_agent_name] = {
                "content": msg.content,
                "field_updates": msg.field_updates,
                "tool_calls": msg.tool_calls,
                "confidence": msg.confidence,
                "metadata": msg.metadata,
            }

            phase_trace.append(phase_name.value)
            full_trace.append({
                "phase": phase_name.value,
                "agent": next_agent_name,
                "result": prior_results[next_agent_name],
                "iteration": iteration,
                "llm_decision": llm_resp.next_action,
                "tool_calls": len(msg.tool_calls),
                "context_message_id": ctx_msg.message_id,
            })

            # 4.2: Record evidence for this agent
            if self.evidence_chain is not None:
                self.evidence_chain.append(
                    agent_name=next_agent_name,
                    phase=phase_name.value,
                    input_summary=student_input[:200],
                    output_summary=msg.content[:200],
                    tool_calls=msg.tool_calls,
                    field_updates=msg.field_updates,
                    confidence=msg.confidence,
                    metadata=msg.metadata,
                )

        # Decision was already computed before collaboration agent ran
        # (so the agent could adapt its response style)

        # Update interaction field
        self.state.interaction.hint_dependency = min(
            self.state.interaction.hint_dependency + 0.01, 1.0
        )
        if self.profile:
            self.profile.total_interactions += 1

        # Get final response
        final_response = prior_results.get("collaboration", {})
        response_content = final_response.get("content", "未能生成回应。")

        self.phase = SessionPhase.DELIVER

        # 7.2: End root span
        if self.trace_collector and root_span_id:
            self.trace_collector.end_span(
                root_span_id,
                output_summary=response_content[:200],
                status=SpanStatus.OK,
            )

        # 7.1: Export evidence chain to audit log
        if self.audit_exporter and self._audit_path:
            try:
                self.audit_exporter.export_to_file(self._audit_path)
            except Exception:
                logger.warning("Failed to export audit log", exc_info=True)

        # 8.1: Persist state to SQLite
        if self.profile:
            try:
                self.state_store.save_session(
                    session_id, self.profile.student_id, self.state, self.profile
                )
                if self.evidence_chain is not None:
                    self.state_store.save_evidence(session_id, self.evidence_chain.export())
                if self.context_messages:
                    self.state_store.save_context_messages(
                        session_id, [m.to_dict() for m in self.context_messages]
                    )
            except Exception:
                logger.warning("Failed to persist session state", exc_info=True)

        # 7.3: Record metrics for this turn
        turn_duration = (datetime.now(timezone.utc) - turn_start).total_seconds() * 1000
        total_tool_calls = sum(
            e.get("tool_calls", 0) if isinstance(e.get("tool_calls"), int)
            else len(e.get("tool_calls", []))
            for e in full_trace
        )
        total_llm_calls = sum(
            1 for e in full_trace if e.get("result", {}).get("metadata", {}).get("llm_generated")
        )
        self.metrics_collector.record_turn(
            turn_id=session_id,
            student_input=student_input,
            success=True,
            duration_ms=turn_duration,
            agent_calls=len(phase_trace),
            tool_calls=total_tool_calls,
            llm_calls=total_llm_calls,
            tokens_used=total_tokens_used,
            agents_called=phase_trace,
            phase_trace=phase_trace,
            evidence_entries=len(self.evidence_chain) if self.evidence_chain is not None else 0,
        )

        # S2: Evaluate pending decisions (feedback pipeline)
        self.feedback_tracker.evaluate_pending(self.state)

        # S3: Run meta-evolution agent (during post-processing)
        meta_result = None
        try:
            from ..agents.base import AgentContext as MetaCtx
            meta_agent = self.agents.get("meta")
            if meta_agent is not None:
                feedback_summary = self.feedback_tracker.get_effectiveness_summary()
                meta_ctx = MetaCtx(
                    student_input=student_input,
                    four_field_state=self.state,
                    prior_results={},
                    metadata={
                        "feedback": feedback_summary,
                        "metrics": self.metrics_collector.summary(),
                    },
                )
                meta_msg = await meta_agent.run(meta_ctx)
                meta_result = {
                    "content": meta_msg.content,
                    "version": meta_msg.metadata.get("version", 0),
                    "effectiveness": meta_msg.metadata.get("effectiveness", 0),
                    "evolution_count": meta_msg.metadata.get("evolution_count", 0),
                    "param_learner_state": meta_msg.metadata.get("param_learner_state", {}),
                }
        except Exception as e:
            logger.warning("MetaEvolution agent failed: %s", e)

        # DAG advance: report whether _execute_decision advanced the DAG pointer
        dag_advance = None
        if decision.action == "advance":
            # _execute_decision already moved current_node_id to the next node.
            # Report the advance so the frontend can update its UI.
            new_id = self.state.knowledge.current_node_id
            new_node = self.dag.get_node(new_id) if new_id else None
            if new_node:
                dag_advance = {
                    "from": getattr(self, "_last_advanced_from", None),
                    "to": new_id,
                    "to_name": new_node.name,
                    "to_description": new_node.description,
                    "reason": decision.reason,
                    "executed": True,
                }
                logger.info("DAG advance reported (already executed): -> %s", new_id)
        else:
            # Check if mastery is high but decision didn't advance
            # (e.g., student not in flow).  Report as a recommendation.
            if self.state.knowledge.mastery_estimate >= self.state.knowledge.zpd_upper:
                current = self.state.knowledge.current_node_id
                if current:
                    dependents = self.dag.get_dependents(current)
                    if dependents:
                        next_id = dependents[0]
                        next_node = self.dag.get_node(next_id)
                        if next_node:
                            dag_advance = {
                                "from": current,
                                "to": next_id,
                                "to_name": next_node.name,
                                "to_description": next_node.description,
                                "reason": f"掌握度 {self.state.knowledge.mastery_estimate:.0%} 超过 ZPD 上界 {self.state.knowledge.zpd_upper:.0%}",
                                "executed": False,
                            }
                            logger.info("DAG advance recommended (not executed): %s -> %s", current, next_id)

        return {
            "response": response_content,
            "four_fields": self.state.snapshot(),
            "decision": decision.__dict__,
            "phase_trace": phase_trace,
            "full_trace": full_trace,
            "evidence": self.evidence_chain.export() if self.evidence_chain is not None else [],
            "evidence_intact": self.evidence_chain.verify() if self.evidence_chain is not None else False,
            "evidence_summary": self.evidence_chain.summary() if self.evidence_chain is not None else {},
            "context_messages": [m.to_dict() for m in self.context_messages],
            # 7.2: Trace data
            "trace": self.trace_collector.export() if self.trace_collector is not None else {},
            "trace_summary": self.trace_collector.summary() if self.trace_collector is not None else {},
            # 5.1: Message bus data
            "bus_messages": self.message_bus.export(),
            # 6.5: Checkpoint info
            "checkpoint_id": checkpoint_id,
            "checkpoints": self.checkpoint_manager.list_checkpoints(),
            # 6.4: Approval gate info
            "approval_requests": len(self.approval_gate),
            # 7.3: Metrics
            "metrics": self.metrics_collector.summary(),
            # 5.3: Topology info
            "topology": self.topology.to_dict(),
            # DAG 自主推进
            "dag_advance": dag_advance,
            # Grill Me mode
            "grill_mode": self.grill_session is not None and self.grill_session.is_active,
            "grill_summary": self.grill_session.get_summary() if self.grill_session is not None else None,
            # Proof mode
            "proof_mode": proof_result_data is not None,
            "proof_result": proof_result_data,
            # Curriculum info
            "curriculum_level": self.curriculum_level,
            # S2: Feedback pipeline data
            "feedback": self.feedback_tracker.get_effectiveness_summary(),
            # S3: Meta-evolution data
            "meta": meta_result,
            # Visual interaction data (for frontend rendering)
            "visual": self._build_visual_data(rt_ms),
        }

    def _build_visual_data(self, rt_ms: float) -> dict[str, Any]:
        """Build visualization data for interactive UI rendering.

        Works in both grill and non-grill modes. In non-grill mode,
        builds a subset of visualizations from the current four-field state
        and DAG, so the frontend always has rich visual data to render.
        """
        from ..grill.visual_data import VisualDataBuilder

        # Build mastery dict from profile
        mastery = {}
        if self.profile:
            mastery = dict(self.profile.dag_mastery)

        current_node = self.state.knowledge.current_node_id

        # --- Grill mode: full visualization suite ---
        if self.grill_session is not None and self.grill_session.is_active:
            builder = VisualDataBuilder(
                dag=self.dag,
                adaptive=self.grill_session.adaptive,
                encouragement=self.grill_session.encouragement,
            )
            return builder.build_all(
                grill_branches={bid: b.to_dict() for bid, b in self.grill_session.branches.items()},
                mastery=mastery,
                current_node_id=current_node,
                conjecture_history=self.grill_session.get_conjecture_history(),
                response_time_ms=rt_ms,
            )

        # --- Non-grill mode: build available visualizations from state ---
        builder = VisualDataBuilder(
            dag=self.dag,
            adaptive=AdaptiveDifficulty(),
            encouragement=EncouragementEngine(),
        )

        # DAG progress is always available
        dag_progress = builder.build_dag_progress(
            grill_branches={},
            mastery=mastery,
            current_node_id=current_node,
        )

        # Four-field gauges from current state
        four_field_gauges = {
            "cognitive_load": round(self.state.cognitive.cognitive_load, 2),
            "cognitive_state": self.state.cognitive.state.value,
            "anxiety_index": round(self.state.emotional.anxiety_index, 2),
            "flow_score": round(self.state.emotional.flow_score, 2),
            "emotional_state": self.state.emotional.state.value,
            "hint_dependency": round(self.state.interaction.hint_dependency, 2),
            "mastery_estimate": round(self.state.knowledge.mastery_estimate, 2),
            "consecutive_correct": self.state.interaction.consecutive_correct,
            "in_zpd": self.state.knowledge.in_zpd,
            "ready_to_advance": self.state.knowledge.ready_to_advance,
        }

        # Mastery radar from four-field state
        speed_factor = min(1.0, 5000.0 / max(rt_ms, 500.0))
        mastery_radar = builder.build_mastery_radar(
            accuracy_rate=self.state.knowledge.mastery_estimate,
            conjecture_success_rate=0.5,
            hint_independence=1.0 - self.state.interaction.hint_dependency,
            speed_factor=speed_factor,
            abstraction_level=min(1.0, self.state.knowledge.mastery_estimate),
        )

        return {
            "dag_progress": dag_progress,
            "four_field_gauges": four_field_gauges,
            "mastery_radar": mastery_radar,
        }

    # -- Proof Assistant Integration --

    def _handle_proof(self, student_input: str) -> dict[str, Any]:
        """Handle a proof attempt: parse, verify, and return results.

        Detects the theorem name from the input, parses numbered proof
        steps, runs the proof assistant, and returns the verification
        result dict for the collaboration agent to format.
        """
        from ..proof.assistant import ProofAssistant

        pa = ProofAssistant(curriculum_level=self.curriculum_level)
        theorem_name = self._detect_theorem(student_input)
        steps = self._parse_proof_steps(student_input)

        if theorem_name and steps:
            result = pa.submit_proof(theorem_name, steps)
            return result.to_dict()

        if theorem_name and not steps:
            # Student named a theorem but didn't provide steps
            template = pa.get_template(theorem_name)
            if template:
                return {
                    "theorem_name": theorem_name,
                    "is_complete": False,
                    "progress": f"0/{len(template.expected_steps)}",
                    "overall_feedback": (
                        f"你想证明「{template.description}」。\n"
                        f"已知：{', '.join(template.given)}\n"
                        f"求证：{template.to_prove}\n\n"
                        f"请写出你的证明步骤，每一步包含论断和理由。"
                    ),
                    "socratic_hint": template.socratic_hints[0] if template.socratic_hints else "",
                    "steps": [],
                    "missing_steps": template.expected_steps,
                    "available_theorems": [],
                }

        # No theorem matched — show theorems available for current curriculum level
        level_theorems = pa.get_theorems_by_level(self.curriculum_level)
        available: list[dict[str, Any]] = []
        for tname in level_theorems:
            tmpl = pa.get_template(tname)
            if tmpl:
                available.append({
                    "name": tmpl.theorem_name,
                    "description": tmpl.description,
                    "given": tmpl.given,
                    "to_prove": tmpl.to_prove,
                    "num_expected_steps": len(tmpl.expected_steps),
                })
        return {
            "theorem_name": None,
            "is_complete": False,
            "progress": "0/0",
            "overall_feedback": "我可以帮你验证以下定理的证明：",
            "available_theorems": available,
            "steps": [],
            "missing_steps": [],
            "socratic_hint": "选择一个定理，写出你的证明步骤。",
        }

    def _detect_theorem(self, text: str) -> str | None:
        """Detect which theorem the student is trying to prove."""
        text_lower = text.lower()
        theorem_map: dict[str, list[str]] = {
            # Group theory
            "identity_unique": ["单位元唯一", "identity unique", "identity is unique", "唯一单位元"],
            "inverse_unique": ["逆元唯一", "inverse unique", "逆元唯一性", "唯一逆元"],
            "cancellation_law": ["消去律", "cancellation", "消去"],
            "trivial_subgroup": ["平凡子群", "trivial subgroup", "{e}是子群", "{e} 是子群"],
            "abelian_subgroup_of_squares": ["平方子群", "squares", "{g²}", "交换群的平方"],
            # High school
            "function_monotonicity": ["单调", "单调递增", "单调性", "monotonic"],
            "am_gm_inequality": ["基本不等式", "均值不等式", "am-gm", "am gm", "a+b≥2"],
            "arithmetic_sequence_sum": ["等差数列求和", "等差数列", "求和公式", "sn="],
            "cos_double_angle": ["二倍角", "余弦二倍角", "cos2a", "cos2α", "double angle"],
            # Middle school
            "pythagorean_theorem": ["勾股", "pythagorean", "毕达哥拉斯"],
            "triangle_angle_sum": ["内角和", "三角形内角", "angle sum", "角度和"],
            "quadratic_formula": ["求根公式", "quadratic formula", "一元二次方程的公式"],
            "congruent_sss": ["sss", "三边对应相等", "全等", "congruent"],
            # Elementary
            "commutative_addition": ["加法交换律", "交换律", "commutative", "a+b=b+a"],
            "fraction_equivalence": ["分数等价", "分数相等", "fraction equiv"],
            "distributive_law": ["分配律", "distributive", "乘法分配"],
        }
        for name, keywords in theorem_map.items():
            if any(kw.lower() in text_lower for kw in keywords):
                return name
        return None

    def _parse_proof_steps(self, text: str) -> list[dict[str, str]]:
        """Parse proof steps from natural language text.

        Handles multiple step formats:
        - "第一步：..." / "第二步：..."
        - "1. ..." / "2. ..." / "1、..."
        - "Step 1: ..." / "Step 2: ..."
        """
        import re

        steps: list[dict[str, str]] = []

        # Pattern 1: 第X步：claim
        matches = re.findall(
            r"第[一二三四五六七八九十\d]+步[：:]\s*(.*?)(?=第[一二三四五六七八九十\d]+步[：:]|$)",
            text, re.DOTALL,
        )
        if matches:
            for m in matches:
                steps.append(self._split_claim_justification(m.strip()))
            return steps

        # Pattern 2: Step N: claim
        matches = re.findall(
            r"Step\s*\d+[：:]\s*(.*?)(?=Step\s*\d+[：:]|$)",
            text, re.DOTALL | re.IGNORECASE,
        )
        if matches:
            for m in matches:
                steps.append(self._split_claim_justification(m.strip()))
            return steps

        # Pattern 3: N. claim  or  N、 claim
        # Only match if there are at least 2 numbered items
        matches = re.findall(
            r"(?:^|\n)\s*(\d+)[.、]\s*(.*?)(?=\n\s*\d+[.、]|$)",
            text, re.DOTALL,
        )
        if len(matches) >= 2:
            for _, m in matches:
                steps.append(self._split_claim_justification(m.strip()))
            return steps

        return steps

    def _split_claim_justification(self, text: str) -> dict[str, str]:
        """Split a step into claim and justification.

        Tries separators: 因为, （, (, since, because, ，,
        """
        for sep in ["因为", "（", "(", "since", "because"]:
            if sep in text:
                parts = text.split(sep, 1)
                claim = parts[0].strip()
                just = parts[1].strip().rstrip(")）").strip()
                return {"claim": claim, "justification": just}
        # Fallback: split on comma
        if "，" in text:
            parts = text.split("，", 1)
            return {"claim": parts[0].strip(), "justification": parts[1].strip()}
        return {"claim": text, "justification": ""}

    async def _decompose_task(self, llm: Any, student_input: str) -> TaskDecomposition:
        """LLM-generated task decomposition (acceptance 2.1).

        The LLM analyzes the input and proposes which agents to call.
        Different inputs produce different decompositions.
        """
        resp = await llm.chat(
            system_prompt=(
                "一位学生刚刚写下了他的数学笔记。作为课程设计者，"
                "你需要判断这个问题需要从哪些角度来回应。\n"
                "可用的视角：\n"
                "  perception —— 辨认学生在做什么\n"
                "  abstraction —— 提炼数学结构\n"
                "  counter_example —— 用 Z3 做形式化验证\n"
                "  epistemic —— 诊断学生的认知状态\n"
                "  historical —— 连接数学史\n"
                "  collaboration —— 综合苏格拉底式回应\n\n"
                "并非每个问题都需要全部视角。想想：这个学生此刻最需要什么？\n"
                "用 [CALL:视角名] 标注每个需要的步骤，以 [DELIVER] 结束。"
            ),
            user_message=f"学生写下了：{student_input}\n\n这个回答需要哪些视角？",
        )

        # Parse LLM response to build decomposition
        import re
        calls = re.findall(r"\[CALL:(\w+)\]", resp.content)
        if not calls:
            # Fallback: infer from input type
            if "[[" in student_input:
                calls = ["perception", "abstraction", "counter_example", "epistemic"]
            elif "历史" in student_input:
                calls = ["perception", "historical"]
            else:
                calls = ["perception", "abstraction", "epistemic"]

        steps = [
            {
                "agent": name,
                "reason": f"LLM decided: needed for {name}",
                "optional": name in ("historical",),
            }
            for name in calls
        ]

        return TaskDecomposition.create(student_input=student_input, steps=steps)

    def _system_prompt(self) -> str:
        """System prompt for the LLM orchestrator (5.3: uses topology config)."""
        # 5.3: Build agent list from topology
        agent_lines = {
            "perception": "辨认学生在做什么",
            "abstraction": "提炼数学结构",
            "counter_example": "用 Z3 做形式化验证",
            "epistemic": "感知学生的认知状态",
            "historical": "连接数学史脉络",
            "collaboration": "综合苏格拉底式回应",
        }
        active = "\n".join(
            f"- {name}: {agent_lines.get(name, '未知')}"
            for name in self.topology.agents
            if name in self.agents
        )
        return (
            "你是一位指挥，面前有几位各有所长的乐手。\n"
            "学生抛出了一个数学问题，你需要决定让谁先回应。\n\n"
            f"在场的乐手：\n{active}\n\n"
            "听完一位乐手的演奏后，判断是否需要其他视角补充，"
            "还是已经可以交付回应。\n"
            "用 [CALL:agent_name] 召唤下一位，用 [DELIVER] 表示可以交付。"
        )

    def _build_llm_input(
        self,
        student_input: str,
        prior_results: dict[str, Any],
        called_agents: set[str],
        available_agents: dict[str, Any],
    ) -> str:
        """Build the input message for the LLM to decide next action."""
        parts = [f"学生写下了：{student_input[:500]}"]
        parts.append(f"已经听过：{', '.join(sorted(called_agents)) or '还没有人发言'}")

        # Summarize prior results
        for name, result in prior_results.items():
            content = result.get("content", "")[:200]
            parts.append(f"[{name}]: {content}")

        # Available agents
        avail_names = list(available_agents.keys())
        parts.append(f"可以召唤：{', '.join(avail_names)}")
        parts.append("下一位该是谁？")

        return "\n".join(parts)

    def _agent_to_phase(self, agent_name: str) -> SessionPhase:
        """Map agent name to session phase."""
        mapping = {
            "perception": SessionPhase.PERCEIVE,
            "abstraction": SessionPhase.ABSTRACT,
            "counter_example": SessionPhase.VERIFY,
            "epistemic": SessionPhase.DIAGNOSE,
            "historical": SessionPhase.REFLECT,
            "collaboration": SessionPhase.COLLABORATE,
            "meta": SessionPhase.REFLECT,
        }
        return mapping.get(agent_name, SessionPhase.IDLE)
