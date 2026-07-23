"""Explicit agent communication channel (5.1).

The MessageBus is the single source of truth for inter-agent communication.
Agents publish AgentMessages to the bus instead of directly reading shared
state. The orchestrator publishes ContextMessages to the bus when dispatching
tasks to agents.

This replaces implicit shared-state reading with an explicit
publish/subscribe transport layer. Every message is timestamped, sequenced,
and serializable for full auditability and traceability.

Relationship to ContextMessage:
    The bus wraps and supplements the existing ContextMessage system.
    - When the orchestrator sends a ContextMessage to an agent, it also
      publishes it to the bus via ``publish_context()``.
    - When an agent produces an AgentMessage, it goes to the bus via
      ``publish()``.
    - The bus is the transport layer; ContextMessage remains the schema
      for orchestrator-to-agent dispatch.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ..context import ContextMessage
from ..models.state import AgentMessage

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Bus Entry
# ---------------------------------------------------------------------------

@dataclass
class BusEntry:
    """Internal storage entry on the message bus.

    Wraps either an :class:`AgentMessage` (agent output) or a
    :class:`ContextMessage` (orchestrator dispatch) with routing metadata
    and a monotonically increasing sequence number for audit ordering.

    Attributes:
        sequence: 0-based sequence number (monotonic within a bus lifetime).
        timestamp: ISO 8601 UTC string.
        message_type: ``"agent"`` for AgentMessage, ``"context"`` for
            ContextMessage.
        from_agent: Name of the producing/dispatching agent.
        to_agent: Name of the target agent. ``"*"`` means broadcast.
        agent_message: The AgentMessage, if ``message_type == "agent"``.
        context_message: The ContextMessage, if ``message_type == "context"``.
        metadata: Extra routing/audit metadata.
    """

    sequence: int
    timestamp: str
    message_type: str  # "agent" or "context"
    from_agent: str
    to_agent: str  # "*" for broadcast
    agent_message: AgentMessage | None = None
    context_message: ContextMessage | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this entry for audit/export."""
        d: dict[str, Any] = {
            "sequence": self.sequence,
            "timestamp": self.timestamp,
            "message_type": self.message_type,
            "from_agent": self.from_agent,
            "to_agent": self.to_agent,
            "metadata": self.metadata,
        }
        if self.agent_message is not None:
            d["payload"] = self.agent_message.model_dump()
            d["payload_type"] = "AgentMessage"
        elif self.context_message is not None:
            d["payload"] = self.context_message.to_dict()
            d["payload_type"] = "ContextMessage"
        else:
            d["payload"] = {}
            d["payload_type"] = "none"
        return d


# ---------------------------------------------------------------------------
# Message Bus
# ---------------------------------------------------------------------------

class MessageBus:
    """The explicit communication channel between agents.

    This is the transport layer for the MathWeaver agent system. It wraps
    and supplements the existing ContextMessage system:

    - When the orchestrator sends a ContextMessage to an agent, it also
      publishes it to the bus via :meth:`publish_context`.
    - When an agent produces an AgentMessage, it goes to the bus via
      :meth:`publish`.
    - The bus is the single source of truth for inter-agent communication.

    All messages are stored with a timestamp and monotonically increasing
    sequence number for full auditability and traceability.

    Example::

        bus = MessageBus()
        bus.subscribe("perception", my_callback)
        bus.publish(agent_message)          # from an agent
        bus.publish_context(ctx_msg)        # from orchestrator
        msgs = bus.get_messages_for("perception")
        audit = bus.export()
    """

    #: Wildcard target indicating a broadcast message.
    BROADCAST = "*"

    def __init__(self) -> None:
        self._entries: list[BusEntry] = []
        self._subscribers: dict[str, list[Callable[[BusEntry], None]]] = {}
        self._seq: int = 0

    # ------------------------------------------------------------------
    # Publishing
    # ------------------------------------------------------------------

    def publish(
        self,
        message: AgentMessage,
        from_agent: str = "",
        to_agent: str = BROADCAST,
    ) -> BusEntry:
        """Publish an :class:`AgentMessage` to the bus.

        Agents call this to publish their output. The orchestrator may
        also use it to forward an agent's result to other agents.

        Args:
            message: The AgentMessage produced by an agent.
            from_agent: Name of the producing agent. If empty, it is
                derived from ``message.role.value``.
            to_agent: Target agent name. ``"*"`` (default) means broadcast
                to all subscribers.

        Returns:
            The created :class:`BusEntry`.
        """
        source = from_agent or message.role.value
        entry = BusEntry(
            sequence=self._seq,
            timestamp=datetime.now(timezone.utc).isoformat(),
            message_type="agent",
            from_agent=source,
            to_agent=to_agent,
            agent_message=message,
            metadata={
                "role": message.role.value,
                "confidence": message.confidence,
                "has_field_updates": bool(message.field_updates),
                "has_tool_calls": bool(message.tool_calls),
            },
        )
        self._entries.append(entry)
        self._seq += 1

        self._notify(entry)
        logger.debug(
            "Bus #%d: agent message from %s to %s: %s",
            entry.sequence, source, to_agent, message.content[:80],
        )
        return entry

    def publish_context(self, ctx_message: ContextMessage) -> BusEntry:
        """Publish a :class:`ContextMessage` (orchestrator dispatch) to the bus.

        When the orchestrator sends a ContextMessage to an agent, it should
        also publish it here so the bus is the single source of truth.

        Args:
            ctx_message: The ContextMessage being dispatched.

        Returns:
            The created :class:`BusEntry`.
        """
        entry = BusEntry(
            sequence=self._seq,
            timestamp=datetime.now(timezone.utc).isoformat(),
            message_type="context",
            from_agent=ctx_message.from_agent,
            to_agent=ctx_message.to_agent,
            context_message=ctx_message,
            metadata={
                "session_id": ctx_message.session_id,
                "message_id": ctx_message.message_id,
                "student_input_length": len(ctx_message.student_input),
            },
        )
        self._entries.append(entry)
        self._seq += 1

        self._notify(entry)
        logger.debug(
            "Bus #%d: context message from %s to %s (session=%s)",
            entry.sequence,
            ctx_message.from_agent,
            ctx_message.to_agent,
            ctx_message.session_id,
        )
        return entry

    # ------------------------------------------------------------------
    # Subscription
    # ------------------------------------------------------------------

    def subscribe(
        self,
        agent_name: str,
        callback: Callable[[BusEntry], None],
    ) -> None:
        """Subscribe an agent to receive messages from the bus.

        The callback is invoked whenever a message addressed to the agent
        (or a broadcast) is published. Callbacks are invoked synchronously
        in sequence order. Exceptions in callbacks are logged but do not
        interrupt message flow.

        Args:
            agent_name: Name of the subscribing agent.
            callback: Callable invoked with the :class:`BusEntry` on
                relevant messages.
        """
        if agent_name not in self._subscribers:
            self._subscribers[agent_name] = []
        self._subscribers[agent_name].append(callback)
        logger.debug(
            "Subscribed %s to message bus (callback #%d)",
            agent_name, len(self._subscribers[agent_name]),
        )

    def unsubscribe(
        self,
        agent_name: str,
        callback: Callable[[BusEntry], None] | None = None,
    ) -> None:
        """Unsubscribe an agent (or a specific callback) from the bus.

        Args:
            agent_name: Name of the agent to unsubscribe.
            callback: If given, remove only this callback. If ``None``,
                remove all callbacks for the agent.
        """
        if agent_name not in self._subscribers:
            return
        if callback is None:
            self._subscribers[agent_name] = []
        else:
            self._subscribers[agent_name] = [
                cb for cb in self._subscribers[agent_name] if cb is not callback
            ]
        if not self._subscribers[agent_name]:
            del self._subscribers[agent_name]

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    def get_messages_for(self, agent_name: str) -> list[AgentMessage]:
        """Get all AgentMessages addressed to an agent.

        Returns AgentMessages where ``to_agent`` matches the given agent
        name or is a broadcast (``"*"``). ContextMessages are not included;
        use :meth:`get_context_for` for those.

        Args:
            agent_name: The target agent name.

        Returns:
            List of AgentMessages addressed to the agent, in sequence
            order.
        """
        results: list[AgentMessage] = []
        for entry in self._entries:
            if entry.message_type != "agent":
                continue
            if entry.agent_message is None:
                continue
            if entry.to_agent == self.BROADCAST or entry.to_agent == agent_name:
                results.append(entry.agent_message)
        return results

    def get_context_for(self, agent_name: str) -> list[ContextMessage]:
        """Get all ContextMessages addressed to an agent.

        Args:
            agent_name: The target agent name.

        Returns:
            List of ContextMessages addressed to the agent, in sequence
            order.
        """
        results: list[ContextMessage] = []
        for entry in self._entries:
            if entry.message_type != "context":
                continue
            if entry.context_message is None:
                continue
            if entry.to_agent == agent_name:
                results.append(entry.context_message)
        return results

    def get_all_messages(self) -> list[AgentMessage]:
        """Get all AgentMessages on the bus (for audit).

        Returns:
            List of all AgentMessages, in sequence order.
        """
        return [
            entry.agent_message
            for entry in self._entries
            if entry.message_type == "agent" and entry.agent_message is not None
        ]

    def get_all_entries(self) -> list[BusEntry]:
        """Get all entries (both agent and context) on the bus.

        Returns:
            List of all :class:`BusEntry` objects, in sequence order.
        """
        return list(self._entries)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def clear(self) -> None:
        """Clear all message history (start a new turn).

        Resets the sequence counter to zero. Subscribers are preserved.
        """
        count = len(self._entries)
        self._entries.clear()
        self._seq = 0
        logger.debug("Message bus cleared (%d entries removed)", count)

    def export(self) -> list[dict[str, Any]]:
        """Serialize all messages for audit/trace.

        Returns:
            List of serializable dicts representing all bus entries
            (both agent and context messages), in sequence order.
        """
        return [entry.to_dict() for entry in self._entries]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _notify(self, entry: BusEntry) -> None:
        """Notify relevant subscribers about a new entry.

        Broadcast messages (``to_agent == "*"``) are delivered to all
        subscribers. Targeted messages are delivered only to the matching
        subscriber.
        """
        if entry.to_agent == self.BROADCAST:
            targets = list(self._subscribers.keys())
        else:
            targets = [entry.to_agent]

        for name in targets:
            for callback in self._subscribers.get(name, []):
                try:
                    callback(entry)
                except Exception:
                    logger.exception(
                        "Subscriber callback for %s failed on bus entry #%d",
                        name, entry.sequence,
                    )

    # ------------------------------------------------------------------
    # Dunder
    # ------------------------------------------------------------------

    def __len__(self) -> int:
        return len(self._entries)

    def __repr__(self) -> str:
        return (
            f"MessageBus(entries={len(self._entries)}, "
            f"subscribers={list(self._subscribers.keys())})"
        )
