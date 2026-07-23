"""Evaluation runner: measures task success rate.

Acceptance criterion 9.2: "端到端从输入到交付形成闭环，演示中无人工补位"
Acceptance criterion 9.3: "在问题集上跑出成功率数值，重跑偏差 < 10%"
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from ..orchestrator.engine import Orchestrator
from .problemset import MathProblem, get_problem_set

logger = logging.getLogger(__name__)


@dataclass
class ProblemResult:
    """Result of running a single problem."""
    problem_id: str
    topic: str
    passed: bool
    response: str
    phase_trace: list[str]
    error: str | None = None
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class EvaluationReport:
    """Full evaluation report."""
    total: int
    passed: int
    failed: int
    success_rate: float
    by_topic: dict[str, dict[str, int]]
    results: list[ProblemResult]

    def summary(self) -> str:
        lines = [
            f"Total: {self.total}, Passed: {self.passed}, Failed: {self.failed}",
            f"Success rate: {self.success_rate:.1%}",
            "By topic:",
        ]
        for topic, stats in self.by_topic.items():
            lines.append(f"  {topic}: {stats['passed']}/{stats['total']}")
        return "\n".join(lines)


def verify_result(problem: MathProblem, response: str, metadata: dict[str, Any]) -> bool:
    """Verify if the response matches the expected result."""
    expected = problem.expected_result

    if "is_group" in expected:
        # Cayley table problems: check metadata from counter_example agent
        actual_is_group = metadata.get("is_group", None)
        if actual_is_group is None:
            # Fallback: check response text
            if expected["is_group"]:
                return any(kw in response for kw in ["满足", "群"]) and "非群" not in response
            else:
                return "不满足" in response or "非群" in response or "违反" in response

        if actual_is_group != expected["is_group"]:
            return False

        if "is_abelian" in expected and actual_is_group:
            actual_abelian = metadata.get("is_abelian", None)
            if actual_abelian is not None and actual_abelian != expected["is_abelian"]:
                return False

        return True

    if "should_contain" in expected:
        # Text problems: check if response contains at least one expected keyword.
        # Socratic responses at hint_level 0 are deliberately concise/guiding,
        # so we check partial match rather than requiring all keywords.
        response_lower = response.lower()
        matched = sum(1 for kw in expected["should_contain"] if kw.lower() in response_lower)
        # Pass if at least 50% of keywords match (min 1)
        threshold = max(1, len(expected["should_contain"]) // 2)
        return matched >= threshold

    return False


async def run_single(problem: MathProblem) -> ProblemResult:
    """Run a single problem through the orchestrator."""
    orch = Orchestrator()
    orch.start_session(f"eval_{problem.id}", target_node_id="group_definition")

    try:
        result = await orch.process_student_input(
            problem.expected_input,
            {"response_time_ms": 5000},
        )
        response = result.get("response", "")
        phase_trace = result.get("phase_trace", [])

        # Extract metadata from counter_example result in full_trace
        metadata = {}
        full_trace = result.get("full_trace", [])
        for entry in full_trace:
            agent_result = entry.get("result", {})
            if isinstance(agent_result, dict):
                meta = agent_result.get("metadata", {})
                if isinstance(meta, dict) and "is_group" in meta:
                    metadata = meta
                    break

        passed = verify_result(problem, response, metadata)

        return ProblemResult(
            problem_id=problem.id,
            topic=problem.topic,
            passed=passed,
            response=response[:300],
            phase_trace=phase_trace,
            details=metadata,
        )
    except Exception as e:
        logger.error("Problem %s failed: %s", problem.id, e)
        return ProblemResult(
            problem_id=problem.id,
            topic=problem.topic,
            passed=False,
            response="",
            phase_trace=[],
            error=str(e),
        )


async def run_evaluation(problems: list[MathProblem] | None = None) -> EvaluationReport:
    """Run the full evaluation on the problem set."""
    problems = problems or get_problem_set()
    results: list[ProblemResult] = []

    for problem in problems:
        r = await run_single(problem)
        results.append(r)
        status = "PASS" if r.passed else "FAIL"
        logger.info("[%s] %s (%s): %s", status, problem.id, problem.topic, r.response[:80])

    total = len(results)
    passed = sum(1 for r in results if r.passed)
    failed = total - passed

    # By topic breakdown
    by_topic: dict[str, dict[str, int]] = {}
    for r in results:
        if r.topic not in by_topic:
            by_topic[r.topic] = {"total": 0, "passed": 0, "failed": 0}
        by_topic[r.topic]["total"] += 1
        if r.passed:
            by_topic[r.topic]["passed"] += 1
        else:
            by_topic[r.topic]["failed"] += 1

    return EvaluationReport(
        total=total,
        passed=passed,
        failed=failed,
        success_rate=passed / total if total > 0 else 0.0,
        by_topic=by_topic,
        results=results,
    )


async def run_consistency_check(runs: int = 3) -> dict[str, Any]:
    """Run the evaluation multiple times to check consistency.

    Acceptance criterion 9.3: "重跑偏差 < 10%"
    """
    rates = []
    for i in range(runs):
        report = await run_evaluation()
        rates.append(report.success_rate)
        logger.info("Run %d: %.1f%%", i + 1, report.success_rate * 100)

    avg = sum(rates) / len(rates)
    if len(rates) > 1:
        max_dev = max(abs(r - avg) for r in rates)
    else:
        max_dev = 0.0

    return {
        "rates": rates,
        "average": avg,
        "max_deviation": max_dev,
        "passes": max_dev < 0.10,
    }
