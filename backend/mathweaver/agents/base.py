"""Base agent class: defines the contract for all agents.

Agents are independent units that:
- Receive a context (read-only state + task info)
- Produce an AgentMessage with results and proposed field updates
- Can optionally use tools (Z3, RAG, LLM) registered with them
- Cannot directly mutate the FourFieldState (single-writer pattern)

3.3: Tool whitelist — agents can only call tools they have registered.
6.3: Permission delegation — child agents inherit a subset of parent's tools.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from ..models.state import AgentMessage, AgentRole, FourFieldState

logger = logging.getLogger(__name__)


@dataclass
class AgentContext:
    """Read-only context passed to an agent.

    Contains the current four-field state, student input,
    and results from previous agents in this turn.
    """

    student_input: str
    four_field_state: FourFieldState
    prior_results: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    # 6.3: Delegation chain for permission tracking
    permission_chain: list[str] = field(default_factory=list)


class BaseAgent(ABC):
    """Base class for all agents.

    Each agent has:
    - role: its AgentRole identity
    - tools: dict of callable tools it can use (3.3: whitelist enforced)
    - llm_client: optional LLM client for reasoning
    - local_state: agent-private state (not shared with other agents)
    - parent_agent: optional parent for permission delegation (6.3)
    """

    def __init__(self, role: AgentRole, llm_client: Any = None) -> None:
        self.role = role
        self.llm_client = llm_client
        self.tools: dict[str, Any] = {}
        self.local_state: dict[str, Any] = {}
        self.call_count: int = 0
        # 6.3: Parent agent for permission delegation
        self._parent: BaseAgent | None = None

    def register_tool(self, name: str, tool: Any) -> None:
        """Register a tool this agent can use (3.3: adds to whitelist)."""
        self.tools[name] = tool

    def call_tool(self, name: str, *args: Any, **kwargs: Any) -> Any:
        """Call a registered tool by name (3.3: whitelist enforced).

        Raises:
            PermissionError: If the tool is not in this agent's whitelist.
        """
        if name not in self.tools:
            logger.warning(
                "Agent %s attempted to call unregistered tool '%s' (3.3 violation)",
                self.role.value, name,
            )
            raise PermissionError(
                f"Agent {self.role.value} cannot call tool '{name}': "
                f"not in whitelist {list(self.tools.keys())}"
            )
        return self.tools[name](*args, **kwargs)

    def can_call_tool(self, name: str) -> bool:
        """Check if this agent is permitted to call a tool (3.3)."""
        return name in self.tools

    def tool_whitelist(self) -> list[str]:
        """Return the list of tools this agent is permitted to call (3.3)."""
        return list(self.tools.keys())

    def delegate_to(
        self,
        child: BaseAgent,
        allowed_tools: list[str] | None = None,
    ) -> BaseAgent:
        """Delegate to a child agent with a subset of tools (6.3: permission递减).

        Args:
            child: The child agent to delegate to.
            allowed_tools: Tools from this agent's whitelist that the child may use.
                          If None, child keeps its own registered tools but cannot
                          access parent's tools.

        Returns:
            The child agent (for chaining).
        """
        child._parent = self
        if allowed_tools is not None:
            # 6.3: Child can only use tools that parent also has (permission递减)
            parent_tools = set(self.tools.keys())
            child_allowed = set(allowed_tools) & parent_tools
            # Remove any tools from child that parent doesn't have
            for tool_name in list(child.tools.keys()):
                if tool_name not in child_allowed:
                    del child.tools[tool_name]
            # Copy allowed tools from parent to child
            for tool_name in child_allowed:
                if tool_name not in child.tools:
                    child.tools[tool_name] = self.tools[tool_name]
        return child

    def permission_chain(self) -> list[str]:
        """Return the delegation chain from root to this agent (6.3)."""
        chain = []
        current = self
        while current is not None:
            chain.append(current.role.value)
            current = current._parent
        return list(reversed(chain))

    @abstractmethod
    async def run(self, ctx: AgentContext) -> AgentMessage:
        """Execute the agent's task.

        Args:
            ctx: Read-only context with state, input, and prior results.

        Returns:
            AgentMessage with content, proposed field updates, and tool calls.
        """
        ...

    def can_handle(self, ctx: AgentContext) -> bool:
        """Check if this agent can handle the given context.

        Default: always True. Override for conditional activation.
        """
        return True

    def describe(self) -> dict[str, Any]:
        """Return a description of this agent for the orchestrator/LLM."""
        return {
            "role": self.role.value,
            "tools": self.tool_whitelist(),
            "has_llm": self.llm_client is not None,
            "calls": self.call_count,
            "parent": self._parent.role.value if self._parent else None,
            "permission_chain": self.permission_chain(),
        }
