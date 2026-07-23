"""Historical Agent: provides mathematical/historical context via RAG retrieval."""

from __future__ import annotations

import logging
from typing import Any

from ..models.state import AgentMessage, AgentRole
from ..rag.retriever import KnowledgeBase, build_default_kb
from .base import AgentContext, BaseAgent

logger = logging.getLogger(__name__)


class HistoricalAgent(BaseAgent):
    """Provides historical and conceptual context using BM25-based RAG retrieval.

    Tools:
    - retrieve_history: BM25 retrieval from knowledge base
    """

    def __init__(self, llm_client: Any = None, knowledge_base: KnowledgeBase | None = None) -> None:
        super().__init__(AgentRole.HISTORICAL, llm_client)
        self.kb = knowledge_base or build_default_kb()
        self.register_tool("retrieve_history", self._retrieve)

    def _retrieve(self, query: str, top_k: int = 3) -> list[dict[str, Any]]:
        """RAG retrieval wrapper for tool registration."""
        results = self.kb.search(query, top_k=top_k)
        return [
            {"id": r.entry.id, "title": r.entry.title, "content": r.entry.content,
             "score": r.score, "snippet": r.snippet}
            for r in results
        ]

    async def run(self, ctx: AgentContext) -> AgentMessage:
        self.call_count += 1
        state = ctx.four_field_state
        current_node = state.knowledge.current_node_id or "group_definition"

        # 3.5: RAG retrieval via call_tool (3.3: whitelist enforced)
        tool_results = self.call_tool("retrieve_history", ctx.student_input, top_k=3)
        if not tool_results:
            tool_results = self.call_tool("retrieve_history", current_node, top_k=3)

        if tool_results:
            top = tool_results[0]
            history_text = top["content"]
            retrieved_key = top["id"]
            results_for_llm = tool_results
        else:
            history_text = "暂无相关历史背景。"
            retrieved_key = None
            results_for_llm = []

        # Use LLM to enrich if available
        if self.llm_client is not None:
            context_parts = [f"当前概念: {current_node}"]
            for r in results_for_llm[:2]:
                context_parts.append(f"[{r['title']}] (score={r['score']:.2f}): {r['content']}")
            resp = await self.llm_client.chat(
                system_prompt=(
                    "将学生此刻的数学探索，放置在更广阔的历史脉络中。\n"
                    "你手边有检索到的数学史素材。从中选取与学生当前概念最相关的一段，"
                    "用两三句话讲述——不是百科条目，而是故事的一个片段。\n"
                    "让历史人物活起来：他们也曾困惑、也曾犯错、也曾从这个概念旁走过。"
                ),
                user_message="\n".join(context_parts) + f"\n学生输入: {ctx.student_input}",
            )
            history_text = resp.content

        return AgentMessage(
            role=self.role,
            content=history_text,
            field_updates={},
            tool_calls=[{"name": "retrieve_history", "result": tool_results}],
            confidence=0.7,
            metadata={
                "retrieved_key": retrieved_key,
                "rag_used": len(tool_results) > 0,
                "rag_scores": [r["score"] for r in tool_results],
                "rag_count": len(tool_results),
                "retrieval_method": "bm25",
            },
        )
