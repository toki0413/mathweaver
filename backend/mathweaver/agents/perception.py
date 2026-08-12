"""Perception Agent: parses student input, detects math content."""

from __future__ import annotations

import json
import logging
from typing import Any

from ..intent import CONJECTURE_TRIGGER_KEYWORDS, PROOF_TRIGGER_KEYWORDS
from ..llm.client import extract_content
from ..models.state import AgentMessage, AgentRole
from .base import AgentContext, BaseAgent

logger = logging.getLogger(__name__)


class PerceptionAgent(BaseAgent):
    """Parses raw student input into structured form.

    Detects:
    - Cayley table JSON input
    - Conjecture statements (universal quantifiers)
    - Free-form questions
    """

    def __init__(self, llm_client: Any = None) -> None:
        super().__init__(AgentRole.PERCEPTION, llm_client)

    async def run(self, ctx: AgentContext) -> AgentMessage:
        self.call_count += 1
        text = ctx.student_input.strip()

        # Try Cayley table parsing
        if text.startswith("[") and text.endswith("]"):
            try:
                table = json.loads(text)
                if isinstance(table, list) and all(isinstance(r, list) for r in table):
                    n = len(table)
                    if all(isinstance(v, int) and 0 <= v < n for r in table for v in r):
                        return AgentMessage(
                            role=self.role,
                            content=f"检测到 {n}x{n} 运算表",
                            field_updates={},
                            tool_calls=[],
                            confidence=0.95,
                            metadata={
                                "input_type": "cayley_table",
                                "cayley_table": table,
                                "n": n,
                            },
                        )
            except (json.JSONDecodeError, ValueError):
                pass

        # Use LLM for complex perception if available
        llm_input_type = None
        if self.llm_client is not None:
            try:
                resp = await self.llm_client.chat(
                    system_prompt=(
                        "你正在审阅一位学生写下的数学笔记。辨认学生正在进行哪种数学活动：\n"
                        "提交了一张运算表（cayley_table）——学生在做结构实验；\n"
                        "提出了一个猜想（conjecture）——学生在试探命题的边界；\n"
                        "给出了一段证明（proof_attempt）——学生在构建逻辑链；\n"
                        "提出了一个问题（question）——学生在寻找方向。\n"
                        "只回复标签本身，不加任何修饰。"
                    ),
                    user_message=text,
                )
                # Extract content from LLM response
                llm_text = extract_content(resp)
                llm_text_lower = llm_text.lower().strip()
                if "conjecture" in llm_text_lower:
                    llm_input_type = "conjecture"
                elif "proof" in llm_text_lower or "证明" in llm_text_lower:
                    llm_input_type = "proof_attempt"
                elif "question" in llm_text_lower:
                    llm_input_type = "question"
            except Exception:
                logger.debug("LLM perception failed, falling back to keywords")

        # Proof attempt detection: LLM result takes priority, then keywords
        proof_keywords = PROOF_TRIGGER_KEYWORDS
        is_proof = llm_input_type == "proof_attempt" or any(kw in text.lower() for kw in proof_keywords)

        if is_proof:
            return AgentMessage(
                role=self.role,
                content=text,
                field_updates={},
                tool_calls=[],
                confidence=0.9,
                metadata={
                    "input_type": "proof_attempt",
                    "is_proof": True,
                    "is_conjecture": False,
                    "raw_text": text,
                },
            )

        # Conjecture detection: LLM result takes priority, then keywords
        conjecture_keywords = CONJECTURE_TRIGGER_KEYWORDS
        is_conjecture = llm_input_type == "conjecture" or any(kw in text.lower() for kw in conjecture_keywords)
        input_type = "conjecture" if is_conjecture else "question"

        return AgentMessage(
            role=self.role,
            content=text,
            field_updates={},
            tool_calls=[],
            confidence=0.8,
            metadata={
                "input_type": input_type,
                "is_conjecture": is_conjecture,
                "raw_text": text,
            },
        )
