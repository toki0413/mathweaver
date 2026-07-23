"""Abstraction Agent: extracts formal structure from perception."""

from __future__ import annotations

import logging
from typing import Any

from ..models.state import AgentMessage, AgentRole
from .base import AgentContext, BaseAgent

logger = logging.getLogger(__name__)


class AbstractionAgent(BaseAgent):
    """Extracts formal mathematical structure from perceived input.

    For Cayley tables: identifies the binary operation structure.
    For natural language: uses LLM to identify mathematical concepts.
    """

    def __init__(self, llm_client: Any = None) -> None:
        super().__init__(AgentRole.ABSTRACTION, llm_client)

    async def run(self, ctx: AgentContext) -> AgentMessage:
        self.call_count += 1
        perception = ctx.prior_results.get("perception", {})
        input_type = perception.get("metadata", {}).get("input_type", "question")

        if input_type == "cayley_table":
            table = perception.get("metadata", {}).get("cayley_table", [])
            n = perception.get("metadata", {}).get("n", 0)
            return AgentMessage(
                role=self.role,
                content=f"辨认出 {n} 元集合上的二元运算结构",
                field_updates={},
                tool_calls=[],
                confidence=0.9,
                metadata={
                    "structure_type": "binary_operation",
                    "cayley_table": table,
                    "n": n,
                },
            )

        # Use LLM for abstraction if available
        if self.llm_client is not None:
            resp = await self.llm_client.chat(
                system_prompt=(
                    "从学生写下的文字中，蒸馏出形式化的数学骨架。\n"
                    "辨认其中涉及的概念、调用的公理、引用的定理。\n"
                    "像从矿石中提纯金属——保留结构，丢弃杂质。输出 JSON。"
                ),
                user_message=ctx.student_input,
            )
            return AgentMessage(
                role=self.role,
                content=resp.content,
                field_updates={},
                tool_calls=resp.tool_calls or [],
                confidence=0.7,
                metadata={"structure_type": "natural_language"},
            )

        return AgentMessage(
            role=self.role,
            content=ctx.student_input,
            field_updates={},
            tool_calls=[],
            confidence=0.5,
            metadata={"structure_type": "natural_language"},
        )
