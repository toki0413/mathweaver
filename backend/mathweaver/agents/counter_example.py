"""Counter-Example Agent: uses Z3 to verify or find counter-examples.

Handles two input modes:
1. Cayley table: direct Z3 axiom verification
2. Conjecture: uses ConjectureHandler to test claims against known structures
"""

from __future__ import annotations

import logging
from typing import Any

from ..conjecture.handler import ConjectureHandler
from ..counterexample.forge import CounterExampleForge
from ..llm.client import extract_content
from ..models.state import AgentMessage, AgentRole
from .base import AgentContext, BaseAgent

logger = logging.getLogger(__name__)


class CounterExampleAgent(BaseAgent):
    """Verifies mathematical structures using Z3 and the counter-example forge.

    This agent has Z3 as a registered tool and uses it to:
    - Verify group axioms (closure, associativity, identity, inverse)
    - Check commutativity
    - Find non-associative operations
    - Test student conjectures against known structures
    """

    def __init__(self, forge: CounterExampleForge | None = None, llm_client: Any = None) -> None:
        super().__init__(AgentRole.COUNTER_EXAMPLE, llm_client)
        self.forge = forge or CounterExampleForge(llm_client=llm_client)
        self.conjecture_handler = ConjectureHandler(forge=self.forge)
        # Register Z3 forge as a tool
        self.register_tool("z3_verify_group", self.forge.check_group_axioms)
        self.register_tool("z3_verify_associativity", self.forge.verify_associativity)
        self.register_tool("z3_check_commutativity", self.forge.check_commutativity)
        self.register_tool("test_conjecture", self.conjecture_handler.test_conjecture)

    async def run(self, ctx: AgentContext) -> AgentMessage:
        self.call_count += 1
        abstraction = ctx.prior_results.get("abstraction", {})
        perception = ctx.prior_results.get("perception", {})
        meta = abstraction.get("metadata", abstraction)

        # Check if this is a conjecture input
        perc_meta = perception.get("metadata", {})
        if perc_meta.get("is_conjecture") or perc_meta.get("input_type") == "conjecture":
            return await self._handle_conjecture(ctx, perc_meta)

        if meta.get("structure_type") == "binary_operation":
            table = meta.get("cayley_table", [])
            if not table:
                return AgentMessage(
                    role=self.role,
                    content="未检测到运算表",
                    field_updates={},
                    confidence=0.3,
                )

            # 3.1: LLM-driven tool selection
            # The agent decides which tools to use based on context
            tool_calls_made: list[dict[str, Any]] = []
            n = len(table)

            if self.llm_client is not None:
                # Ask LLM which verification tools to use
                tool_defs = [
                    {"name": "z3_verify_group", "description": "Verify all 4 group axioms"},
                    {"name": "z3_verify_associativity", "description": "Check associativity only"},
                    {"name": "z3_check_commutativity", "description": "Check Abelian property"},
                ]
                tool_resp = await self.llm_client.chat(
                    system_prompt=(
                        "面前是一张 n×n 运算表。作为一位严谨的代数学家，"
                        "判断哪些性质值得检验。\n"
                        "可选的验证手段：\n"
                        "  z3_verify_group —— 检验四条群公理\n"
                        "  z3_verify_associativity —— 单独检验结合律\n"
                        "  z3_check_commutativity —— 检验交换律\n"
                        "返回需要执行的工具名，用逗号分隔。"
                    ),
                    user_message=f"这是一张 {n}×{n} 运算表。哪些性质需要检验？",
                )

                # Parse LLM decision
                selected_tools = set()
                for tool_def in tool_defs:
                    if tool_def["name"] in extract_content(tool_resp):
                        selected_tools.add(tool_def["name"])
                if not selected_tools:
                    # LLM chose no tools — just report the table
                    selected_tools = {"z3_verify_group"}
            else:
                # Fallback: use all tools for Cayley tables
                selected_tools = {"z3_verify_group", "z3_verify_associativity", "z3_check_commutativity"}

            # Execute selected tools (3.3: via call_tool for whitelist enforcement)
            axioms_result = None
            assoc_result = None
            comm_result = None

            if "z3_verify_group" in selected_tools:
                axioms_result = self.call_tool("z3_verify_group", table)
                tool_calls_made.append({
                    "name": "z3_verify_group",
                    "result": {"is_group": not axioms_result.success},
                    "selected_by": "llm" if self.llm_client else "default",
                })

            if "z3_verify_associativity" in selected_tools:
                assoc_result = self.call_tool("z3_verify_associativity", table)
                tool_calls_made.append({
                    "name": "z3_verify_associativity",
                    "result": {"satisfied": not assoc_result.success},
                    "selected_by": "llm" if self.llm_client else "default",
                })

            if "z3_check_commutativity" in selected_tools:
                comm_result = self.call_tool("z3_check_commutativity", table)
                tool_calls_made.append({
                    "name": "z3_check_commutativity",
                    "result": {"satisfied": not comm_result.success},
                    "selected_by": "llm" if self.llm_client else "default",
                })

            # Determine result from available data
            if axioms_result:
                is_group = not axioms_result.success
            elif assoc_result:
                # If only associativity was checked, infer group status
                is_group = not assoc_result.success
            else:
                is_group = False  # No verification done

            is_abelian = is_group and comm_result and not comm_result.success

            content = self._format_result(
                axioms_result, assoc_result, comm_result, is_group, is_abelian
            )

            # Propose field updates based on verification
            field_updates: dict[str, dict[str, Any]] = {}
            if not is_group:
                field_updates["interaction"] = {
                    "consecutive_correct": ctx.four_field_state.interaction.consecutive_correct + 1,
                }
            else:
                field_updates["cognitive"] = {
                    "backtrack_count": ctx.four_field_state.cognitive.backtrack_count + 1,
                }

            return AgentMessage(
                role=self.role,
                content=content,
                field_updates=field_updates,
                tool_calls=tool_calls_made,
                confidence=0.95,
                metadata={
                    "is_group": is_group,
                    "is_abelian": is_abelian,
                    "axiom_violation": axioms_result.counter_example if axioms_result and axioms_result.success else None,
                    "assoc_violation": assoc_result.counter_example if assoc_result and assoc_result.success else None,
                    "comm_violation": comm_result.counter_example if comm_result and comm_result.success else None,
                    "z3_level": axioms_result.level.value if axioms_result else "none",
                    "tools_selected_by": "llm" if self.llm_client else "default",
                    "selected_tools": list(selected_tools),
                },
            )

        return AgentMessage(
            role=self.role,
            content="未发现可验证的形式化结构",
            field_updates={},
            confidence=0.3,
        )

    def _format_result(self, axioms, assoc, comm, is_group, is_abelian) -> str:
        if is_group and is_abelian:
            return "四条公理悉数通过，运算可交换——这是一个交换群。"
        elif is_group:
            ce = comm.counter_example if comm else "N/A"
            return f"群公理成立，但交换律被打破。反例：{ce}"
        else:
            explanation = axioms.explanation if axioms else "未执行验证"
            return f"群公理未通过。{explanation}"

    async def _handle_conjecture(self, ctx: AgentContext, perc_meta: dict) -> AgentMessage:
        """Handle student conjectures via ConjectureHandler + Z3.

        The discovery loop: student conjectures → Z3 tests → counter-example or confirmation → Socratic prompt.
        """
        raw_text = perc_meta.get("raw_text", ctx.student_input)

        # Use call_tool for whitelist enforcement (3.3)
        result = self.call_tool("test_conjecture", raw_text)

        # Build content for collaboration agent
        verdict_map = {
            "confirmed": "猜想成立",
            "refuted": "猜想被反驳",
            "undecidable": "无法判定",
        }

        content_parts = [f"{verdict_map.get(result.verdict, '未知')}：{result.explanation}"]
        if result.counter_example:
            content_parts.append(f"反例：{result.counter_example}")
        if result.socratic_prompt:
            content_parts.append(result.socratic_prompt)

        content = "\n".join(content_parts)

        # Field updates based on conjecture result
        field_updates: dict[str, dict[str, Any]] = {}
        if result.verdict == "refuted":
            field_updates["interaction"] = {
                "consecutive_correct": ctx.four_field_state.interaction.consecutive_correct,
            }
        elif result.verdict == "confirmed":
            field_updates["interaction"] = {
                "consecutive_correct": ctx.four_field_state.interaction.consecutive_correct + 1,
            }

        return AgentMessage(
            role=self.role,
            content=content,
            field_updates=field_updates,
            tool_calls=[{"name": "test_conjecture", "result": result.to_dict()}],
            confidence=0.9,
            metadata={
                "conjecture_result": result.to_dict(),
                "conjecture_verdict": result.verdict,
                "conjecture_counter_example": result.counter_example,
                "conjecture_socratic_prompt": result.socratic_prompt,
                "is_conjecture": True,
            },
        )
