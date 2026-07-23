"""Configurable agent topology (5.3).

The topology defines which agents exist, which can route to which,
and which is the entry/exit point. By swapping the TopologyConfig,
the orchestrator's routing graph changes without code modification.

Acceptance criterion 5.3: "拓扑可配：agent 拓扑可配置"
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class TopologyConfig:
    """Defines the agent routing topology.

    Attributes:
        agents: Ordered list of active agent names.
        connections: Adjacency dict — agent -> list of agents it may route to.
        entry_agent: First agent always called (usually "perception").
        exit_agent: Agent whose completion triggers delivery (usually "collaboration").
        max_iterations: Safety limit on agent calls per turn.
    """

    agents: list[str] = field(default_factory=lambda: [
        "perception",
        "abstraction",
        "counter_example",
        "epistemic",
        "historical",
        "collaboration",
    ])
    connections: dict[str, list[str]] = field(default_factory=lambda: {
        "perception": ["abstraction", "counter_example", "epistemic", "historical", "collaboration"],
        "abstraction": ["counter_example", "epistemic", "collaboration"],
        "counter_example": ["epistemic", "collaboration"],
        "epistemic": ["historical", "collaboration"],
        "historical": ["collaboration"],
        "collaboration": [],
    })
    entry_agent: str = "perception"
    exit_agent: str = "collaboration"
    max_iterations: int = 8

    @classmethod
    def default(cls) -> TopologyConfig:
        """Return the default topology (full graph)."""
        return cls()

    @classmethod
    def minimal(cls) -> TopologyConfig:
        """A minimal topology: perceive -> verify -> collaborate."""
        return cls(
            agents=["perception", "counter_example", "collaboration"],
            connections={
                "perception": ["counter_example", "collaboration"],
                "counter_example": ["collaboration"],
                "collaboration": [],
            },
            entry_agent="perception",
            exit_agent="collaboration",
            max_iterations=4,
        )

    @classmethod
    def linear(cls) -> TopologyConfig:
        """A strict linear pipeline: all agents in sequence."""
        agents = [
            "perception", "abstraction", "counter_example",
            "epistemic", "historical", "collaboration",
        ]
        connections = {
            agents[i]: [agents[i + 1]] for i in range(len(agents) - 1)
        }
        connections[agents[-1]] = []
        return cls(
            agents=agents,
            connections=connections,
            entry_agent="perception",
            exit_agent="collaboration",
            max_iterations=len(agents) + 2,
        )

    def can_route(self, from_agent: str, to_agent: str) -> bool:
        """Check if routing from one agent to another is allowed by the topology."""
        allowed = self.connections.get(from_agent, [])
        return to_agent in allowed

    def is_active(self, agent_name: str) -> bool:
        """Check if an agent is part of this topology."""
        return agent_name in self.agents

    def available_from(self, from_agent: str) -> list[str]:
        """Return the list of agents that can be routed to from the given agent."""
        return list(self.connections.get(from_agent, []))

    def validate(self) -> list[str]:
        """Validate the topology configuration. Returns list of error messages."""
        errors: list[str] = []
        if self.entry_agent not in self.agents:
            errors.append(f"entry_agent '{self.entry_agent}' not in agents list")
        if self.exit_agent not in self.agents:
            errors.append(f"exit_agent '{self.exit_agent}' not in agents list")
        for src, dsts in self.connections.items():
            if src not in self.agents:
                errors.append(f"connection source '{src}' not in agents list")
            for dst in dsts:
                if dst not in self.agents:
                    errors.append(f"connection target '{dst}' not in agents list")
        return errors

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TopologyConfig:
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})

    def to_json_file(self, path: str | Path) -> None:
        """Save topology to a JSON file."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)

    @classmethod
    def from_json_file(cls, path: str | Path) -> TopologyConfig:
        """Load topology from a JSON file."""
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))

    def describe(self) -> str:
        """Human-readable description of the topology."""
        lines = [f"Topology: {len(self.agents)} agents, entry={self.entry_agent}, exit={self.exit_agent}"]
        for src in self.agents:
            dsts = self.connections.get(src, [])
            lines.append(f"  {src} -> {', '.join(dsts) if dsts else '(terminal)'}")
        return "\n".join(lines)
