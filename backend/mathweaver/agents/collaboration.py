"""Collaboration Agent: Socratic guide that synthesizes discovery-oriented responses.

Design principle — response to the New Math movement (1958-1975):
The New Math imposed abstract structures from above, assuming students would
construct understanding through exposure to formal axioms. This agent takes
the opposite approach: it uses Socratic questioning to help the student
discover structures from within their own experience. It never gives the
answer directly, but guides through graduated hints that respect the
learner's cognitive readiness. The New Math's failure showed that
"understanding what you're doing" cannot be imposed — it must be grown.
See: docs/new-math-reflection.md

- Use graduated hints: hint_level 0 = question, 1 = hint, 2 = bigger hint, 3 = near-answer
- Adapt tone based on pedagogical decision:
  - reduce_abstraction → simplify language, fewer concepts per sentence
  - emotional_support → encouraging, acknowledge effort
  - advance → challenge, introduce complexity
  - guided_discovery → balanced Socratic questioning
- For conjectures: confirm/refute with Z3 evidence, then ask "why?"
- Grill Me mode: system interviews the student, one question at a time,
  with recommended answers, walking the concept DAG as a decision tree.
- Historical narrative: conjecture responses weave in math history,
  connecting the student's discovery to the tradition of mathematicians.
- Free exploration: when student submits a Cayley table, system grills
  them about its properties (identity, inverses, commutativity).
"""

from __future__ import annotations

import logging
from typing import Any

from ..grill.narrative import weave_for_conjecture_metadata
from ..llm.client import extract_content
from ..models.state import AgentMessage, AgentRole
from .base import AgentContext, BaseAgent

logger = logging.getLogger(__name__)


class CollaborationAgent(BaseAgent):
    """Socratic synthesis agent.

    Reads prior_results from all agents and the pedagogical decision
    from the orchestrator, then composes a response that:
    - Guides rather than tells
    - Uses the student's cognitive/emotional state to calibrate difficulty
    - Turns verification results into discovery prompts
    - Handles conjectures with Z3 evidence + "why?" follow-up
    - In Grill Me mode: interviews the student with one question at a time
    """

    def __init__(self, llm_client: Any = None) -> None:
        super().__init__(AgentRole.COLLABORATION, llm_client)

    async def run(self, ctx: AgentContext) -> AgentMessage:
        self.call_count += 1
        ce = ctx.prior_results.get("counter_example", {})
        epistemic = ctx.prior_results.get("epistemic", {})
        historical = ctx.prior_results.get("historical", {})

        ce_meta = ce.get("metadata", {})
        ep_meta = epistemic.get("metadata", {})
        hist_content = historical.get("content", "")

        is_group = ce_meta.get("is_group", False)
        is_abelian = ce_meta.get("is_abelian", False)
        in_zpd = ep_meta.get("in_zpd", True)
        is_struggling = ep_meta.get("is_struggling", False)
        emotional_state = ep_meta.get("emotional_state", "engaged")

        # Extract pedagogical decision from context
        decision = ctx.metadata.get("pedagogical_decision", {})
        action = decision.get("action", "continue")
        hint_level = decision.get("hint_level", 0)

        # --- Proof mode: student submitted a proof attempt ---
        # The orchestrator already ran the proof assistant and passed results.
        proof_data = ctx.metadata.get("proof_result")
        if proof_data:
            content = self._proof_response(proof_data, action, hint_level, ctx.student_input)
            return AgentMessage(
                role=self.role,
                content=content,
                field_updates={},
                tool_calls=[],
                confidence=0.85,
                metadata={
                    "llm_generated": False,
                    "socratic_style": True,
                    "proof_mode": True,
                    "proof_complete": proof_data.get("is_complete", False),
                    "proof_progress": proof_data.get("progress", "0/0"),
                    "pedagogical_action": action,
                    "hint_level": hint_level,
                },
            )

        # --- Grill Me mode: system interviews the student ---
        # Triggered by "考考我" / "grill me" or when grill session is active.
        # The system asks ONE question with a recommended answer,
        # walking the concept DAG as a decision tree.
        grill_data = ctx.metadata.get("grill_session")
        if grill_data and grill_data.get("active"):
            grill_question = grill_data.get("next_question")
            grill_summary = grill_data.get("summary", {})
            conjecture_history = grill_data.get("conjecture_history", [])

            # Check if this is a conjecture within an active grill session
            if ce_meta.get("is_conjecture") and "conjecture_verdict" in ce_meta:
                content = self._socratic_conjecture(
                    ce_meta, action, hint_level, emotional_state, hist_content,
                    conjecture_history=conjecture_history,
                )
                return AgentMessage(
                    role=self.role,
                    content=content,
                    field_updates={},
                    tool_calls=[],
                    confidence=0.85,
                    metadata={
                        "llm_generated": False,
                        "socratic_style": True,
                        "pedagogical_action": action,
                        "hint_level": hint_level,
                        "conjecture_handled": True,
                        "conjecture_verdict": ce_meta.get("conjecture_verdict"),
                        "grill_mode": True,
                    },
                )

            # Regular grill mode: ask a question with recommended answer
            if grill_question:
                content = self._grill_response(
                    grill_question, grill_summary, ctx.student_input,
                    emotional_state, hist_content,
                )
                return AgentMessage(
                    role=self.role,
                    content=content,
                    field_updates={},
                    tool_calls=[],
                    confidence=0.8,
                    metadata={
                        "llm_generated": False,
                        "socratic_style": True,
                        "grill_mode": True,
                        "grill_question_id": grill_question.get("qid"),
                        "grill_concept": grill_question.get("concept_name"),
                        "pedagogical_action": action,
                        "hint_level": hint_level,
                    },
                )

            # All grill branches resolved
            content = self._grill_complete(grill_summary, hist_content)
            return AgentMessage(
                role=self.role,
                content=content,
                field_updates={},
                tool_calls=[],
                confidence=0.9,
                metadata={
                    "llm_generated": False,
                    "grill_mode": True,
                    "grill_complete": True,
                    "pedagogical_action": action,
                },
            )

        # --- Conjecture path: counter_example agent already tested the conjecture ---
        # The collaboration agent must use that result, not generate its own answer.
        if ce_meta.get("is_conjecture") and "conjecture_verdict" in ce_meta:
            content = self._socratic_conjecture(
                ce_meta, action, hint_level, emotional_state, hist_content,
            )
            return AgentMessage(
                role=self.role,
                content=content,
                field_updates={},
                tool_calls=[],
                confidence=0.85,
                metadata={
                    "llm_generated": False,
                    "socratic_style": True,
                    "pedagogical_action": action,
                    "hint_level": hint_level,
                    "conjecture_handled": True,
                    "conjecture_verdict": ce_meta.get("conjecture_verdict"),
                },
            )

        # Use LLM for response synthesis if available
        if self.llm_client is not None:
            context_summary = self._build_context_summary(
                ce, epistemic, historical, is_group, is_abelian, action, hint_level
            )
            socratic_prompt = self._socratic_system_prompt(action, hint_level)
            resp = await self.llm_client.chat(
                system_prompt=socratic_prompt,
                user_message=context_summary,
            )
            content = extract_content(resp).replace("[DELIVER]", "").strip()
            return AgentMessage(
                role=self.role,
                content=content,
                field_updates={},
                tool_calls=[],
                confidence=0.8,
                metadata={
                    "llm_generated": True,
                    "socratic_style": True,
                    "pedagogical_action": action,
                    "hint_level": hint_level,
                },
            )

        # Template-based Socratic synthesis
        has_verification = "is_group" in ce_meta
        content = self._socratic_synthesis(
            is_group, is_abelian, in_zpd, is_struggling, emotional_state,
            hist_content,
            ce_meta.get("axiom_violation"),
            ce_meta.get("assoc_violation"),
            has_verification=has_verification,
            epistemic=epistemic,
            student_input=ctx.student_input,
            action=action,
            hint_level=hint_level,
        )

        return AgentMessage(
            role=self.role,
            content=content,
            field_updates={},
            tool_calls=[],
            confidence=0.7,
            metadata={
                "llm_generated": False,
                "socratic_style": True,
                "pedagogical_action": action,
                "hint_level": hint_level,
            },
        )

    def _socratic_system_prompt(self, action: str, hint_level: int) -> str:
        """Build a Socratic system prompt adapted to the pedagogical decision."""
        base = (
            "你是一位走在学生身旁的导师。你不替学生走路，而是在关键处伸出手。\n"
            "核心信条：永远不要直接说出答案。问一个问题，让学生自己迈出那一步。"
        )
        style_map = {
            "reduce_abstraction": "学生此刻负荷很重。把语言磨到最简，每次只放一个概念在桌上。",
            "emotional_support": "学生可能有些挫败。先认可他走过的路，再轻轻指向下一步。",
            "advance": "学生正处于心流中。给他一个值得攀登的坡度。",
            "guided_discovery": "学生站在最近发展区的中央。给足够的线索让他自己走到终点。",
            "provide_hint": f"学生遇到了障碍。给出第 {hint_level} 级提示——越来越接近答案，但永远不到达。",
        }
        style = style_map.get(action, "保持当前的教学节奏。")
        return f"{base}\n{style}\n用 [DELIVER] 标记回应完成。"

    def _build_context_summary(self, ce, epistemic, historical, is_group, is_abelian, action, hint_level):
        parts = [
            f"验证结果: {'群' if is_group else '非群'}, {'交换' if is_abelian else '非交换'}",
            f"教学决策: {action}, 提示等级: {hint_level}",
            f"认知状态: {epistemic.get('content', '未知')}",
            f"历史背景: {historical.get('content', '无')[:100]}",
        ]
        return "\n".join(parts)

    def _socratic_synthesis(
        self, is_group, is_abelian, in_zpd, is_struggling,
        emotional_state, hist_content, axiom_violation, assoc_violation,
        has_verification=False,
        epistemic=None,
        student_input="",
        action="continue",
        hint_level=0,
    ) -> str:
        """Socratic template synthesis — guides instead of tells.

        Hint levels:
        0: Ask a guiding question
        1: Point to the relevant property
        2: Give a concrete hint about what to look for
        3: Nearly state the answer, ask student to confirm
        """
        parts: list[str] = []

        # --- Emotional calibration based on pedagogical decision ---
        if action == "emotional_support" or emotional_state == "anxious":
            parts.append("你的思考方向很好。")
        elif emotional_state == "flow":
            parts.append("你今天状态不错。")

        if has_verification:
            # Cayley table verification — Socratic approach
            parts.extend(self._socratic_cayley(
                is_group, is_abelian, axiom_violation, assoc_violation,
                hint_level, action, in_zpd, is_struggling,
            ))
        else:
            # Text-based question — still guide rather than just state
            parts.extend(self._socratic_text(
                student_input, hist_content, epistemic, hint_level,
            ))

        # --- Historical context as discovery narrative ---
        if hist_content and hint_level <= 1:
            parts.append(f"\n背景：{hist_content[:150]}")

        # --- Next step prompt ---
        if action == "advance" and is_group:
            parts.append("\n下一步：试试非交换群的结构，比如 S₃ 的 Cayley 表。")
        elif is_struggling and hint_level < 3:
            parts.append("\n想一想：这个运算表里，哪个元素可能扮演单位元的角色？")

        return "\n".join(parts)

    def _socratic_cayley(
        self, is_group, is_abelian, axiom_violation, assoc_violation,
        hint_level, action, in_zpd, is_struggling,
    ) -> list[str]:
        """Generate Socratic prompts for Cayley table verification results."""
        parts: list[str] = []

        if is_group and is_abelian:
            if hint_level == 0:
                parts.append("观察这个运算表：每一行和每一列都包含了所有元素吗？这说明什么？")
                parts.append("再看看对称性——表关于对角线对称意味着什么？")
            elif hint_level == 1:
                parts.append("这个运算表满足封闭性和交换性。你能找到单位元吗？")
                parts.append("每个元素是否都有逆元？")
            elif hint_level == 2:
                parts.append("这是一个交换群。第一行和第一列相同，说明该元素是单位元。")
                parts.append("表关于对角线对称，说明运算满足交换律。")
            else:
                parts.append("这是一个交换群（Abel 群）：满足四条群公理且交换律成立。")

        elif is_group:
            if hint_level == 0:
                parts.append("这个运算表满足群公理。但注意看对角线两侧——它们对称吗？")
            elif hint_level == 1:
                parts.append("这是一个群但不是交换群。能找到交换律失效的那对元素吗？")
            elif hint_level == 2:
                parts.append("这是非交换群。表中存在 a,b 使得 a·b ≠ b·a。")
            else:
                parts.append("这是一个非交换群：满足群公理但不满足交换律。")

        else:
            # Not a group — guide to find which axiom fails
            if hint_level == 0:
                parts.append("这个运算表似乎有问题。你觉得哪个群公理可能不满足？")
            elif hint_level == 1:
                if axiom_violation:
                    parts.append(f"提示：注意{axiom_violation}。")
                else:
                    parts.append("提示：检查封闭性、结合律、单位元、逆元中哪个不满足。")
            elif hint_level == 2:
                if assoc_violation:
                    parts.append(f"结合律不成立。反例：{assoc_violation}")
                elif axiom_violation:
                    parts.append(f"违反的公理：{axiom_violation}")
                else:
                    parts.append("某个群公理不成立。逐一检查四条公理。")
            else:
                parts.append("这个运算表不满足群公理。")
                if axiom_violation:
                    parts.append(f"违反：{axiom_violation}")
                if assoc_violation:
                    parts.append(f"结合律反例：{assoc_violation}")

        # Socratic follow-up
        if hint_level <= 1 and in_zpd:
            parts.append("\n你的猜想是什么？可以用「我猜...」来描述。")

        return parts

    # -- Grill Me Mode Methods --

    def _grill_response(
        self,
        grill_question: dict[str, Any],
        grill_summary: dict[str, Any],
        student_input: str,
        emotional_state: str,
        hist_content: str,
    ) -> str:
        """Generate a grill-me response: ONE question with recommended answer.

        This is the core of the Grill Me pattern:
        - Present ONE question at a time
        - Include the system's recommended answer (so student can react)
        - Show progress through the decision tree
        - Acknowledge the student's previous answer if applicable
        - Integrate encouragement engine for growth-mindset language
        """
        parts: list[str] = []

        # --- Encouragement engine: generate contextual encouragement ---
        from ..grill.encouragement import EncouragementContext, EncouragementEngine
        enc_engine = EncouragementEngine()
        adaptive_data = grill_summary.get("adaptive", {})

        student_answer = student_input.strip()
        is_first_question = student_answer.startswith("[[") or len(student_answer) <= 3

        if not is_first_question and len(student_answer) > 3:
            # Student provided a text answer — generate encouragement
            # Heuristic: if student's answer contains keywords from recommended answer, consider correct
            # (In production, this would use LLM evaluation)
            enc_ctx = EncouragementContext(
                is_correct=True,  # optimistic default; LLM would evaluate
                streak_correct=adaptive_data.get("streak_correct", 0),
                streak_wrong=adaptive_data.get("streak_wrong", 0),
                total_answered=adaptive_data.get("total_questions", 0),
                emotional_state=emotional_state,
                difficulty_band=adaptive_data.get("difficulty_band", "standard"),
                trend=adaptive_data.get("trend", "stable"),
            )
            encouragement = enc_engine.generate(enc_ctx)
            if encouragement:
                parts.append(f"✨ {encouragement}")
            parts.append(f"\n你回答了：「{student_answer[:80]}」")
            parts.append("让我来考考你下一个问题。\n")
        else:
            parts.append("开始审问模式。我会一次问你一个问题，每个问题我都会给出我的参考答案。\n")

        # Show progress
        resolved = grill_summary.get("resolved_branches", 0)
        total = grill_summary.get("total_branches", 0)
        if total > 0:
            parts.append(f"📊 进度：{resolved}/{total} 个知识分支已探索\n")

        # Adaptive difficulty indicator
        diff_band = adaptive_data.get("difficulty_band", "standard")
        trend = adaptive_data.get("trend", "stable")
        trend_icon = "📈" if trend == "rising" else "📉" if trend == "falling" else "➡️"
        parts.append(f"🎯 难度：{diff_band} {trend_icon}\n")

        # The question
        question_text = grill_question.get("question", "")
        concept_name = grill_question.get("concept_name", "")
        recommended = grill_question.get("recommended_answer", "")
        branch_type = grill_question.get("branch_type", "concept")
        difficulty = grill_question.get("difficulty", 0.5)

        # Difficulty indicator
        diff_label = "基础" if difficulty < 0.4 else "进阶" if difficulty < 0.7 else "挑战"
        type_label = {"concept": "概念", "edge_case": "边界", "application": "应用"}.get(branch_type, "概念")

        parts.append(f"【{concept_name} · {type_label} · {diff_label}】")
        parts.append(f"\n❓ {question_text}")
        parts.append(f"\n💡 我的参考答案：{recommended}")
        parts.append("\n你的答案是什么？如果不确定，可以说「看看参考答案」或提出你自己的猜想。")

        return "\n".join(parts)

    def _grill_complete(
        self,
        grill_summary: dict[str, Any],
        hist_content: str,
    ) -> str:
        """Generate the grill session completion message."""
        total = grill_summary.get("total_branches", 0)
        resolved = grill_summary.get("resolved_branches", 0)
        correct = grill_summary.get("correct_answers", 0)
        conjecture_count = grill_summary.get("conjecture_count", 0)
        tables_seen = grill_summary.get("cayley_tables_seen", 0)

        parts: list[str] = []
        parts.append("🎉 审问模式完成！")
        parts.append("\n📊 回顾：")
        parts.append(f"   探索了 {resolved}/{total} 个知识分支")
        parts.append(f"   正确回答：{correct}")
        parts.append(f"   提出猜想：{conjecture_count} 个")
        parts.append(f"   提交 Cayley 表：{tables_seen} 个")

        # Adaptive difficulty summary
        adaptive = grill_summary.get("adaptive", {})
        if adaptive:
            accuracy = adaptive.get("accuracy_rate", 0)
            conj_rate = adaptive.get("conjecture_success_rate", 0)
            final_diff = adaptive.get("current_difficulty", 0.4)
            diff_band = adaptive.get("difficulty_band", "standard")
            parts.append("\n🎯 自适应难度：")
            parts.append(f"   最终难度：{diff_band} ({final_diff:.0%})")
            parts.append(f"   准确率：{accuracy:.0%}")
            parts.append(f"   猜想成功率：{conj_rate:.0%}")
            trend = adaptive.get("trend", "stable")
            if trend == "rising":
                parts.append("   趋势：📈 上升中")
            elif trend == "falling":
                parts.append("   趋势：📉 需要巩固")
            else:
                parts.append("   趋势：➡️ 稳定")

        if correct == resolved and resolved > 0:
            parts.append("\n✨ 你的理解很扎实。要不要尝试更难的概念？")
        elif correct < resolved // 2:
            parts.append("\n✨ 有几个概念需要再巩固——但这正是进步的开始。建议回到相关概念重新探索。")
        else:
            parts.append("\n✨ 整体不错，部分概念可以再深入。你的数学思维在成长。")

        if hist_content:
            parts.append(f"\n📖 {hist_content[:200]}")

        parts.append("\n输入「考考我」可以再来一轮，或者提出你自己的猜想。")

        return "\n".join(parts)

    def _socratic_conjecture(
        self, ce_meta: dict, action: str, hint_level: int,
        emotional_state: str, hist_content: str,
        conjecture_history: list[dict[str, Any]] | None = None,
    ) -> str:
        """Synthesize Socratic response from conjecture verification result.

        The counter_example agent already tested the conjecture with Z3.
        The collaboration agent wraps it in discovery-oriented language:

        - refuted: present the counter-example, then ask "why does it fail?"
        - confirmed: acknowledge, then ask "can you prove it?"
        - undecidable: ask the student to refine the statement
        - Historical narrative: weave in math history connecting to the student's discovery
        - Multi-turn memory: acknowledge if this is a refinement of a previous conjecture

        Hint levels modulate how much detail is given:
        0: minimal reveal, ask a guiding question
        1: present the result with brief explanation
        2: detailed explanation + counter-example specifics
        3: full explanation, ask student to confirm understanding
        """
        verdict = ce_meta.get("conjecture_verdict", "undecidable")
        counter_example = ce_meta.get("conjecture_counter_example")
        socratic_prompt = ce_meta.get("conjecture_socratic_prompt", "")
        result_dict = ce_meta.get("conjecture_result", {})
        explanation = result_dict.get("explanation", "")
        claim = result_dict.get("claim", "")

        parts: list[str] = []

        # --- Encouragement engine: conjecture-specific encouragement ---
        from ..grill.encouragement import EncouragementEngine
        enc_engine = EncouragementEngine()
        enc_text = enc_engine.generate_for_conjecture(
            verdict=verdict,
            conjecture_history=conjecture_history or [],
        )
        if enc_text:
            parts.append(f"✨ {enc_text}")

        # --- Multi-turn memory: acknowledge conjecture refinement ---
        if conjecture_history and len(conjecture_history) >= 2:
            prev = conjecture_history[-2]
            if prev.get("verdict") == "refuted" and verdict == "confirmed":
                parts.append("你修正了之前的猜想，这次对了。这种「猜想→反驳→修正」的循环正是数学发现的核心。")
            elif prev.get("verdict") == "refuted" and verdict == "refuted":
                parts.append("又找到一个反例。你在逐步逼近正确的命题边界。")

        # --- Emotional calibration ---
        if action == "emotional_support" or emotional_state == "anxious":
            parts.append("提出猜想本身就是很好的数学思维。")
        elif emotional_state == "flow":
            parts.append("很好的猜想！")

        # --- Verdict-based response ---
        if verdict == "refuted":
            if hint_level == 0:
                # Minimal: just say it's refuted, let student think about why
                parts.append(f"你的猜想「{claim[:50]}」被反驳了。")
                parts.append("想想看，什么样的群可能不满足这个性质？")
            elif hint_level == 1:
                parts.append(f"你的猜想被反驳了。反例是 {counter_example}。")
                parts.append("看看这个反例，你能找到具体是哪两个元素不交换吗？")
            elif hint_level == 2:
                parts.append(f"猜想被反驳。反例：{counter_example}。")
                parts.append(explanation)
            else:
                parts.append(f"猜想不成立。{counter_example} 就是一个反例。")
                parts.append(explanation)
                parts.append("你能构造另一个反例吗？")

        elif verdict == "confirmed":
            if hint_level == 0:
                parts.append(f"你的猜想「{claim[:50]}」是对的！")
                parts.append("你能说说为什么它成立吗？")
            elif hint_level == 1:
                parts.append("猜想了成立。")
                parts.append(explanation)
            else:
                parts.append("猜想正确。")
                parts.append(explanation)
                parts.append("你能把这个结论推广吗？")

        else:  # undecidable
            parts.append("你的猜想很有意思，但我暂时无法用已知结构验证它。")
            parts.append(socratic_prompt or "你能把猜想写得更具体一些吗？")

        # --- Socratic follow-up from the conjecture handler ---
        if socratic_prompt and hint_level <= 2:
            parts.append(f"\n{socratic_prompt}")

        # --- Historical narrative weaving ---
        # Connect the student's discovery to the mathematical tradition
        narrative = weave_for_conjecture_metadata(ce_meta)
        if narrative and hint_level <= 2:
            parts.append(narrative)
        elif hist_content and hint_level <= 1:
            # Fallback: use historical agent's content
            parts.append(f"\n背景：{hist_content[:150]}")

        return "\n".join(parts)

    def _socratic_text(
        self, student_input, hist_content, epistemic, hint_level,
    ) -> list[str]:
        """Generate Socratic responses for text-based questions."""
        parts: list[str] = []
        si = student_input.lower()

        if "什么是群" in student_input or "群的定义" in student_input:
            if hint_level == 0:
                parts.append("想象一个集合，上面有一种「运算」。")
                parts.append("要让这个结构成为「群」，你觉得需要哪些条件？")
            elif hint_level == 1:
                parts.append("群需要满足四条性质。想想看：运算结果还在集合里吗？运算顺序重要吗？")
            elif hint_level == 2:
                parts.append("四条公理：封闭性、结合律、单位元、逆元。你能用自己的话解释每一条吗？")
            else:
                parts.append("群 = 集合 + 运算，满足：封闭性、结合律、单位元、逆元。")

        elif "结合律" in student_input:
            if hint_level <= 1:
                parts.append("结合律说的是运算的顺序不影响结果。")
                parts.append("你能写出一个 (a·b)·c 和 a·(b·c) 的具体例子吗？")
            else:
                parts.append("结合律：(a·b)·c = a·(b·c)。不是所有运算都满足——比如减法就不满足。")

        elif "矩阵" in student_input and ("交换" in student_input or "不" in student_input or "非" in student_input):
            if hint_level == 0:
                parts.append("矩阵乘法有个有趣的性质。试试算 AB 和 BA，结果一样吗？")
            elif hint_level == 1:
                parts.append("矩阵乘法一般不满足交换律。你能找到 AB ≠ BA 的具体例子吗？")
            else:
                parts.append("矩阵乘法一般不交换：AB ≠ BA。这与一般群的非交换性一致。")

        elif "矩阵" in student_input and "逆" in student_input:
            if hint_level <= 1:
                parts.append("矩阵的逆和群的逆元是同一个概念。什么样的矩阵才有逆？")
            else:
                parts.append("可逆矩阵在 GL(n) 中构成群。逆矩阵对应群中的逆元。")

        elif "交换" in student_input or "abel" in si:
            if hint_level == 0:
                parts.append("交换群满足 a·b = b·a。你接触过哪些运算满足这个性质？")
            else:
                parts.append("交换群（Abel 群）：a·b = b·a。以 Abel 命名，他证明五次方程无根式解。")

        elif "lagrange" in si or "拉格朗日" in student_input:
            if hint_level == 0:
                parts.append("Lagrange 定理说的是子群大小和群大小的关系。你觉得是什么关系？")
            else:
                parts.append("Lagrange 定理：|H| 整除 |G|。子群的阶必然整除群的阶。")

        elif "线性变换" in student_input:
            if hint_level <= 1:
                parts.append("线性变换保持两种运算。想想看：加法和标量乘法。具体怎么「保持」？")
            else:
                parts.append("线性变换 T 满足 T(u+v)=T(u)+T(v) 和 T(cv)=cT(v)。")

        elif "向量空间" in student_input:
            if hint_level <= 1:
                parts.append("向量空间是加了运算的集合。它需要满足哪些公理？")
            else:
                parts.append("向量空间满足八条公理（加法四条+标量乘法四条）。")

        # Add epistemic diagnosis subtly (not as [诊断] label)
        if epistemic and epistemic.get("content") and hint_level <= 1:
            diag = epistemic["content"]
            # Only surface the diagnosis if it's actionable
            if "认知负荷较高" in diag:
                parts.append("\n（这个概念确实有点多，我们先只看一个性质。）")
            elif "心流" in diag:
                parts.append("\n（看来你掌握得不错，要不要试试更难的？）")

        return parts

    # -- Proof Mode Methods --

    def _proof_response(
        self,
        proof_data: dict[str, Any],
        action: str,
        hint_level: int,
        student_input: str,
    ) -> str:
        """Format proof verification results into a pedagogical response.

        The orchestrator already ran the proof assistant. This method
        wraps the results in discovery-oriented language:
        - Complete proofs: celebrate and ask for alternative approaches
        - Partial proofs: show progress, give Socratic hints for next step
        - No theorem matched: list available theorems
        - No steps provided: present theorem info and ask for first step
        """
        parts: list[str] = []

        theorem_name = proof_data.get("theorem_name")
        is_complete = proof_data.get("is_complete", False)
        progress = proof_data.get("progress", "0/0")
        overall = proof_data.get("overall_feedback", "")
        hint = proof_data.get("socratic_hint", "")
        steps = proof_data.get("steps", [])
        missing = proof_data.get("missing_steps", [])
        available = proof_data.get("available_theorems", [])

        # --- No theorem matched: show available theorems ---
        if theorem_name is None and available:
            parts.append("我可以帮你验证以下定理的证明：\n")
            for t in available:
                parts.append(
                    f"  • {t['description']}（{t['name']}）\n"
                    f"    已知：{', '.join(t['given'])}\n"
                    f"    求证：{t['to_prove']}\n"
                    f"    预期 {t['num_expected_steps']} 步\n"
                )
            parts.append("\n写出你的证明，每一步包含论断和理由。例如：")
            parts.append("  证明单位元唯一")
            parts.append("  第一步：e·f = f（因为 e 是单位元）")
            parts.append("  第二步：e·f = e（因为 f 是单位元）")
            parts.append("  第三步：e = f（传递性）")
            return "\n".join(parts)

        # --- Theorem matched but no steps: present theorem info ---
        if theorem_name and not steps:
            parts.append(f"📋 {overall}")
            if hint:
                parts.append(f"\n💡 提示：{hint}")
            parts.append("\n写出你的证明步骤，每一步用「第X步：」或「1. 2. 3.」编号。")
            return "\n".join(parts)

        # --- Proof with steps: show verification results ---
        parts.append(f"📊 证明验证结果：{progress}")
        parts.append("")

        # Show each step's verification
        for step in steps:
            num = step.get("step_number", 0)
            claim = step.get("claim", "")
            valid = step.get("is_valid", False)
            feedback = step.get("feedback", "")
            matched = step.get("matched_expected", "")
            implicit = step.get("implicit_steps", [])

            icon = "✓" if valid else "✗"
            parts.append(f"第 {num} 步 {icon}: {claim}")
            if implicit:
                parts.append(f"    （隐含覆盖：{', '.join(implicit)}）")
            parts.append(f"    {feedback}")
            if not valid and matched:
                parts.append(f"    期望：{matched}")
            parts.append("")

        # Overall result
        if is_complete:
            parts.append("🎉 证明完整且正确！")
            parts.append("每一步都符合逻辑，证明结构清晰。")
            parts.append("\n你能用不同的方法证明这个定理吗？")
            parts.append("或者，你能把结论推广到更一般的情形吗？")
        else:
            parts.append(f"📝 {overall}")
            if missing:
                parts.append("\n还需完成：")
                for i, m in enumerate(missing):
                    parts.append(f"  {i+1}. {m}")
            if hint:
                parts.append(f"\n💡 苏格拉底提示：{hint}")

        # Socratic follow-up
        if not is_complete and hint_level <= 1:
            parts.append("\n想想下一步该怎么推导？")

        return "\n".join(parts)
