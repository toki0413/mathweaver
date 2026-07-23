"""Visualization data builder: structures data for interactive UI rendering.

Produces JSON-serializable data for:
1. Concept DAG progress map (nodes with mastery, status, color)
2. Mastery radar (dimensions: axioms, abstraction, application, proof, conjecture)
3. Conjecture journey timeline (chronological conjecture → verdict → refinement)
4. Adaptive difficulty gauge (current difficulty, trend, accuracy)
5. Encouragement feed (recent encouragement snippets)

This data is returned in the orchestrator's response under the "visual" key,
ready for the frontend to render as interactive widgets.
"""

from __future__ import annotations

from typing import Any

from ..dag.concept_dag import ConceptDAG, get_dag
from .adaptive import AdaptiveDifficulty
from .encouragement import EncouragementEngine


class VisualDataBuilder:
    """Builds visualization-ready data structures from session state."""

    def __init__(
        self,
        dag: ConceptDAG | None = None,
        adaptive: AdaptiveDifficulty | None = None,
        encouragement: EncouragementEngine | None = None,
    ) -> None:
        self.dag = dag or get_dag()
        self.adaptive = adaptive or AdaptiveDifficulty()
        self.encouragement = encouragement or EncouragementEngine()

    def build_dag_progress(
        self,
        grill_branches: dict[str, Any] | None = None,
        mastery: dict[str, float] | None = None,
        current_node_id: str | None = None,
    ) -> dict[str, Any]:
        """Build concept DAG progress visualization data.

        Returns a graph structure with nodes and edges,
        each node having: id, name, mastery, status, is_current, is_milestone.
        """
        mastery = mastery or {}
        grill_branches = grill_branches or {}
        nodes = []
        edges = []

        for node in self.dag.get_all_nodes():
            node_mastery = mastery.get(node.id, 0.0)
            branch = grill_branches.get(node.id, {})
            status = branch.get("status", "pending") if isinstance(branch, dict) else "pending"

            # Determine visual status
            if status == "answered_correct":
                visual_status = "mastered"
            elif status == "answered_wrong":
                visual_status = "needs_review"
            elif status == "skipped":
                visual_status = "skipped"
            elif node.id == current_node_id:
                visual_status = "current"
            else:
                visual_status = "locked"

            nodes.append({
                "id": node.id,
                "name": node.name,
                "description": node.description,
                "mastery": round(node_mastery, 2),
                "status": visual_status,
                "is_current": node.id == current_node_id,
                "is_milestone": node.is_milestone,
                "difficulty": node.difficulty,
                "domain": node.domain,
                "abstraction_level": node.abstraction_level,
            })

            # Add edges from prerequisites
            for prereq in node.prerequisites:
                edges.append({
                    "source": prereq,
                    "target": node.id,
                })

        return {
            "nodes": nodes,
            "edges": edges,
            "total_nodes": len(nodes),
            "mastered_count": sum(1 for n in nodes if n["status"] == "mastered"),
            "current_node": current_node_id,
        }

    def build_mastery_radar(
        self,
        accuracy_rate: float = 0.5,
        conjecture_success_rate: float = 0.5,
        hint_independence: float = 0.5,
        speed_factor: float = 0.5,
        abstraction_level: float = 0.5,
    ) -> dict[str, Any]:
        """Build mastery radar chart data (5 dimensions).

        Dimensions:
        1. 准确率 (Accuracy): how often correct
        2. 猜想力 (Conjecture): conjecture success rate
        3. 独立性 (Independence): 1 - hint usage rate
        4. 流畅度 (Fluency): speed relative to baseline
        5. 抽象力 (Abstraction): highest abstraction level reached
        """
        return {
            "dimensions": [
                {"label": "准确率", "value": round(accuracy_rate, 2), "max": 1.0},
                {"label": "猜想力", "value": round(conjecture_success_rate, 2), "max": 1.0},
                {"label": "独立性", "value": round(hint_independence, 2), "max": 1.0},
                {"label": "流畅度", "value": round(speed_factor, 2), "max": 1.0},
                {"label": "抽象力", "value": round(abstraction_level, 2), "max": 1.0},
            ],
            "overall": round(
                (accuracy_rate + conjecture_success_rate + hint_independence
                 + speed_factor + abstraction_level) / 5, 2
            ),
        }

    def build_conjecture_journey(
        self,
        conjecture_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Build conjecture journey timeline data.

        Shows the student's conjecture → verdict → refinement chain
        as a chronological timeline.
        """
        history = conjecture_history or []
        timeline = []

        for i, conj in enumerate(history):
            entry = {
                "step": i + 1,
                "claim": conj.get("text", "")[:100],
                "verdict": conj.get("verdict", "unknown"),
                "counter_example": conj.get("counter_example"),
                "timestamp": conj.get("timestamp", ""),
                "is_refinement": i > 0,  # All after first are refinements
            }
            timeline.append(entry)

        # Compute summary stats
        total = len(timeline)
        confirmed = sum(1 for t in timeline if t["verdict"] == "confirmed")
        refuted = sum(1 for t in timeline if t["verdict"] == "refuted")

        return {
            "timeline": timeline,
            "total_conjectures": total,
            "confirmed": confirmed,
            "refuted": refuted,
            "refinement_chains": self._find_refinement_chains(timeline),
        }

    def _find_refinement_chains(self, timeline: list[dict[str, Any]]) -> list[list[int]]:
        """Find chains of conjecture → refutation → refinement."""
        chains = []
        current_chain: list[int] = []

        for entry in timeline:
            if entry["verdict"] == "refuted":
                current_chain.append(entry["step"])
            elif entry["verdict"] == "confirmed" and current_chain:
                current_chain.append(entry["step"])
                chains.append(current_chain)
                current_chain = []
            else:
                if current_chain:
                    chains.append(current_chain)
                current_chain = []

        if current_chain:
            chains.append(current_chain)

        return chains

    def build_difficulty_gauge(self) -> dict[str, Any]:
        """Build adaptive difficulty gauge data."""
        return {
            "current_difficulty": round(self.adaptive.current_difficulty, 3),
            "difficulty_band": self.adaptive.get_difficulty_band(),
            "trend": self.adaptive.get_trend(),
            "accuracy_rate": round(self.adaptive.accuracy_rate, 3),
            "conjecture_success_rate": round(self.adaptive.conjecture_success_rate, 3),
            "streak_correct": self.adaptive.streak_correct,
            "streak_wrong": self.adaptive.streak_wrong,
            "should_increase": self.adaptive.should_increase_difficulty(),
            "should_decrease": self.adaptive.should_decrease_difficulty(),
            "total_questions": self.adaptive._total_questions,
            "total_correct": self.adaptive._total_correct,
        }

    def build_all(
        self,
        grill_branches: dict[str, Any] | None = None,
        mastery: dict[str, float] | None = None,
        current_node_id: str | None = None,
        conjecture_history: list[dict[str, Any]] | None = None,
        response_time_ms: float = 5000.0,
    ) -> dict[str, Any]:
        """Build all visualization data in one call."""
        # Compute speed factor
        speed_factor = min(1.0, 5000.0 / max(response_time_ms, 500.0))

        # Hint independence
        hint_independence = 1.0
        if self.adaptive._total_questions > 0:
            hint_independence = 1.0 - (self.adaptive._hint_count / self.adaptive._total_questions)

        return {
            "dag_progress": self.build_dag_progress(
                grill_branches=grill_branches,
                mastery=mastery,
                current_node_id=current_node_id,
            ),
            "mastery_radar": self.build_mastery_radar(
                accuracy_rate=self.adaptive.accuracy_rate,
                conjecture_success_rate=self.adaptive.conjecture_success_rate,
                hint_independence=hint_independence,
                speed_factor=speed_factor,
                abstraction_level=min(1.0, self.adaptive.current_difficulty),
            ),
            "conjecture_journey": self.build_conjecture_journey(conjecture_history),
            "difficulty_gauge": self.build_difficulty_gauge(),
        }
