"""Independent agent implementations.

Each agent is a self-contained class with:
- Independent state (agent-local context)
- A callable run() entry point
- Well-defined input/output schema
- No direct access to other agents' internals
"""

from .abstraction import AbstractionAgent
from .base import AgentContext, BaseAgent
from .collaboration import CollaborationAgent
from .counter_example import CounterExampleAgent
from .epistemic import EpistemicAgent
from .historical import HistoricalAgent
from .meta import MetaEvolutionAgent
from .perception import PerceptionAgent

__all__ = [
    "AgentContext",
    "BaseAgent",
    "PerceptionAgent",
    "AbstractionAgent",
    "CounterExampleAgent",
    "EpistemicAgent",
    "HistoricalAgent",
    "CollaborationAgent",
    "MetaEvolutionAgent",
]
