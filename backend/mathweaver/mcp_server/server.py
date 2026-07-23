"""MCP (Model Context Protocol) server for MathWeaver.

A lightweight, dependency-free implementation of the Model Context Protocol
that exposes the CounterExampleForge Z3 verification tools to MCP-compatible
clients (LLM hosts, other agents, etc.).

The implementation follows JSON-RPC 2.0 semantics and supports two transports:

* **In-process mode** -- an :class:`MCPClient` wraps an :class:`MCPServer`
  instance and calls its methods directly. Zero IPC overhead; ideal for
  testing and tight coupling.
* **stdio mode** -- the server is spawned as a subprocess and communicates
  using newline-delimited JSON over stdin/stdout. Matches the canonical MCP
  stdio transport, allowing the server to be consumed by external hosts.

Only the Python standard library is used (``json``, ``sys``, ``subprocess``,
``threading``, ``dataclasses``, ``enum``, ``typing``).  No external MCP SDK.

Protocol methods implemented
----------------------------
``initialize``
    Capability handshake. Returns protocol version, server capabilities and
    server info.
``notifications/initialized``
    One-way notification from client signalling initialization is complete.
``tools/list``
    Returns the list of registered tool descriptors.
``tools/call``
    Invokes a named tool with the supplied arguments.

Example -- in-process usage
---------------------------
>>> from mathweaver.mcp_server.server import build_default_server, MCPClient
>>> server = build_default_server()
>>> client = MCPClient(server=server)
>>> tools = client.discover_tools()
>>> result = client.call_tool("verify_associativity", {"table": [[0,1,2],[1,1,0],[2,0,2]]})
>>> result["success"]
True

Example -- stdio usage
----------------------
>>> from mathweaver.mcp_server.server import MCPClient
>>> client = MCPClient(command=["python", "-m", "mathweaver.mcp_server.server"])
>>> tools = client.discover_tools()
>>> client.close()
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import asdict, is_dataclass
from enum import Enum
from typing import Any

# ---------------------------------------------------------------------------
# Protocol constants
# ---------------------------------------------------------------------------

JSONRPC_VERSION = "2.0"
# MCP protocol version this server speaks.
PROTOCOL_VERSION = "2024-11-05"

# JSON-RPC 2.0 standard error codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def _serialize(obj: Any) -> Any:
    """Recursively convert dataclasses / enums to JSON-serializable values.

    Handles nested structures (dicts, lists, tuples) and converts any
    :class:`enum.Enum` to its ``.value`` so the result can be passed to
    :func:`json.dumps` without a custom encoder.
    """
    if isinstance(obj, Enum):
        return obj.value
    if is_dataclass(obj) and not isinstance(obj, type):
        # ``asdict`` recurses into nested dataclasses; enums survive as-is and
        # are converted by the recursive call below.
        return {k: _serialize(v) for k, v in asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_serialize(v) for v in obj]
    return obj


def _error_response(
    req_id: Any, code: int, message: str, data: Any = None
) -> dict[str, Any]:
    """Build a JSON-RPC 2.0 error response."""
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": JSONRPC_VERSION, "error": error, "id": req_id}


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class MCPError(Exception):
    """Base error carrying a JSON-RPC error code."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


class ToolNotFoundError(MCPError):
    """Raised when a requested tool is not registered."""

    def __init__(self, name: str) -> None:
        super().__init__(METHOD_NOT_FOUND, f"Tool not found: {name}")
        self.tool_name = name


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

class MCPServer:
    """A lightweight MCP server backed by in-process tool handlers.

    Tools are plain Python callables registered with an optional JSON Schema
    describing their input.  The server speaks JSON-RPC 2.0 via
    :meth:`handle_request` and can be exposed over stdio with
    :meth:`serve_stdio`.
    """

    def __init__(
        self,
        name: str = "mathweaver-mcp",
        version: str = "0.1.0",
        description: str = "MathWeaver MCP server exposing Z3 verification tools",
    ) -> None:
        self.name = name
        self.version = version
        self.description = description
        # name -> tool descriptor (name, description, inputSchema)
        self._tools: dict[str, dict[str, Any]] = {}
        # name -> handler callable
        self._handlers: dict[str, Callable[[dict[str, Any]], Any]] = {}

    # -- registration -------------------------------------------------------

    def register_tool(
        self,
        name: str,
        description: str,
        handler: Callable[[dict[str, Any]], Any],
        input_schema: dict[str, Any] | None = None,
    ) -> None:
        """Register a tool with the server.

        Parameters
        ----------
        name:
            Unique tool name (e.g. ``"verify_associativity"``).
        description:
            Human-readable description of what the tool does.
        handler:
            Callable invoked as ``handler(arguments_dict)``.  It may return a
            dataclass, dict, or any JSON-serializable value; the result is
            normalized by :func:`_serialize`.
        input_schema:
            Optional JSON Schema describing the expected ``arguments`` object.
            Defaults to an empty object schema.
        """
        if not name:
            raise ValueError("Tool name must be a non-empty string")
        if not callable(handler):
            raise TypeError("handler must be callable")
        self._tools[name] = {
            "name": name,
            "description": description,
            "inputSchema": input_schema or {"type": "object", "properties": {}},
        }
        self._handlers[name] = handler

    # -- introspection / invocation ----------------------------------------

    def list_tools(self) -> list[dict[str, Any]]:
        """Return the list of registered tool descriptors."""
        return [dict(desc) for desc in self._tools.values()]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Invoke ``name`` with ``arguments`` and return a JSON-serializable dict.

        Raises :class:`ToolNotFoundError` if the tool is not registered.
        """
        if name not in self._handlers:
            raise ToolNotFoundError(name)
        handler = self._handlers[name]
        result = handler(arguments or {})
        serialized = _serialize(result)
        if not isinstance(serialized, dict):
            # Wrap non-dict results so callers always receive a dict.
            serialized = {"result": serialized}
        return serialized

    # -- JSON-RPC dispatch --------------------------------------------------

    def _handle_initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": self.name, "version": self.version},
        }

    def _handle_tools_call(self, params: dict[str, Any]) -> dict[str, Any]:
        tool_name = params.get("name")
        arguments = params.get("arguments", {}) or {}
        try:
            tool_result = self.call_tool(tool_name, arguments)
        except ToolNotFoundError:
            # Protocol-level error: the tool itself does not exist.
            raise
        except Exception as exc:  # noqa: BLE001 - surface as tool error
            # Tool-execution errors are reported with ``isError`` per MCP.
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {"error": str(exc)}, ensure_ascii=False
                        ),
                    }
                ],
                "isError": True,
            }
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(tool_result, ensure_ascii=False),
                }
            ],
            "isError": False,
        }

    def handle_request(self, request: dict[str, Any]) -> dict[str, Any] | None:
        """Handle a single JSON-RPC 2.0 request.

        Returns the response dict, or ``None`` for notifications (requests
        without an ``id``) which require no response.
        """
        if not isinstance(request, dict):
            return _error_response(None, INVALID_REQUEST, "Request must be an object")

        method = request.get("method")
        req_id = request.get("id")
        is_notification = "id" not in request

        try:
            if method == "initialize":
                result: Any = self._handle_initialize(request.get("params", {}))
            elif method == "notifications/initialized":
                return None  # one-way notification
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": self.list_tools()}
            elif method == "tools/call":
                result = self._handle_tools_call(request.get("params", {}))
            else:
                if is_notification:
                    return None
                return _error_response(
                    req_id, METHOD_NOT_FOUND, f"Method not found: {method}"
                )

            if is_notification:
                return None
            return {"jsonrpc": JSONRPC_VERSION, "result": result, "id": req_id}
        except MCPError as exc:
            return _error_response(req_id, exc.code, str(exc), exc.data)
        except Exception as exc:  # noqa: BLE001
            return _error_response(
                req_id, INTERNAL_ERROR, f"Internal error: {exc}"
            )

    # -- stdio transport ----------------------------------------------------

    def serve_stdio(self) -> None:
        """Run the server reading newline-delimited JSON from stdin.

        Each line is parsed as a JSON-RPC request.  Responses (if any) are
        written as a single JSON line to stdout and flushed immediately.  This
        is the canonical MCP stdio transport used for subprocess servers.

        The loop terminates when stdin reaches EOF.
        """
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as exc:
                response = _error_response(None, PARSE_ERROR, f"Parse error: {exc}")
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
                continue

            response = self.handle_request(request)
            if response is not None:
                sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
                sys.stdout.flush()


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class MCPClient:
    """Client for an MCP server.

    Two operating modes are supported:

    * **In-process** -- pass an :class:`MCPServer` instance as ``server``.
      Method calls are dispatched directly with no IPC.
    * **stdio** -- pass a ``command`` list (e.g.
      ``["python", "-m", "mathweaver.mcp_server.server"]``).  The server is
      spawned as a subprocess and spoken to over newline-delimited JSON on
      stdin/stdout.
    """

    def __init__(
        self,
        server: MCPServer | None = None,
        command: list[str] | None = None,
        client_name: str = "mathweaver-mcp-client",
        client_version: str = "0.1.0",
    ) -> None:
        if server is None and command is None:
            raise ValueError("MCPClient requires either a 'server' or a 'command'")
        self._server = server
        self._command = command
        self._client_name = client_name
        self._client_version = client_version
        self._proc: subprocess.Popen[str] | None = None
        self._id_counter = 0
        self._lock = threading.Lock()
        self._initialized = False

    # -- low-level stdio plumbing ------------------------------------------

    def _next_id(self) -> int:
        self._id_counter += 1
        return self._id_counter

    def _ensure_connected(self) -> None:
        """Spawn the subprocess (stdio mode) and perform the handshake."""
        if self._server is not None or self._initialized:
            return
        if self._command is None:
            raise RuntimeError("No server or command configured")

        self._proc = subprocess.Popen(
            self._command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # line-buffered
        )
        self._initialize()

    def _initialize(self) -> None:
        """Perform the MCP ``initialize`` handshake."""
        response = self._send_request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": self._client_name,
                    "version": self._client_version,
                },
            },
        )
        if "error" in response:
            raise RuntimeError(
                f"initialize failed: {response['error'].get('message')}"
            )
        # Notify the server that initialization is complete.
        self._send_notification("notifications/initialized", {})
        self._initialized = True

    def _write_line(self, obj: dict[str, Any]) -> None:
        assert self._proc is not None and self._proc.stdin is not None
        data = json.dumps(obj, ensure_ascii=False) + "\n"
        self._proc.stdin.write(data)
        self._proc.stdin.flush()

    def _send_notification(self, method: str, params: dict[str, Any]) -> None:
        request: dict[str, Any] = {"jsonrpc": JSONRPC_VERSION, "method": method}
        if params:
            request["params"] = params
        # Notifications carry no id and expect no response.
        with self._lock:
            self._write_line(request)

    def _send_request(
        self, method: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        request: dict[str, Any] = {
            "jsonrpc": JSONRPC_VERSION,
            "method": method,
            "id": self._next_id(),
        }
        if params is not None:
            request["params"] = params

        with self._lock:
            assert self._proc is not None and self._proc.stdout is not None
            self._write_line(request)
            # Read lines until we receive the response matching our id.
            # (Notifications emitted by the server are skipped.)
            while True:
                raw = self._proc.stdout.readline()
                if not raw:
                    raise ConnectionError("MCP server closed the connection")
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("id") == request["id"]:
                    return msg
                # Otherwise it is an unsolicited notification; ignore it.

    # -- public API ---------------------------------------------------------

    def discover_tools(self) -> list[dict[str, Any]]:
        """Discover the list of tools exposed by the server."""
        if self._server is not None:
            return self._server.list_tools()
        self._ensure_connected()
        response = self._send_request("tools/list")
        if "error" in response:
            raise RuntimeError(
                f"tools/list failed: {response['error'].get('message')}"
            )
        return response.get("result", {}).get("tools", [])

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call a tool by name.

        In in-process mode the raw handler result is returned.  In stdio mode
        the textual ``content`` payload is parsed back into a dict so both
        modes yield an equivalent structure.
        """
        if self._server is not None:
            return self._server.call_tool(name, arguments)
        self._ensure_connected()
        response = self._send_request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )
        if "error" in response:
            raise RuntimeError(
                f"tools/call failed: {response['error'].get('message')}"
            )
        result = response.get("result", {})
        for item in result.get("content", []):
            if item.get("type") == "text":
                try:
                    return json.loads(item["text"])
                except (json.JSONDecodeError, KeyError):
                    return {"text": item.get("text", "")}
        return result

    def close(self) -> None:
        """Terminate the subprocess if running in stdio mode."""
        if self._proc is not None:
            try:
                if self._proc.stdin is not None:
                    self._proc.stdin.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except Exception:  # noqa: BLE001
                try:
                    self._proc.kill()
                except Exception:  # noqa: BLE001
                    pass
            self._proc = None
            self._initialized = False

    # context-manager convenience

    def __enter__(self) -> MCPClient:
        self._ensure_connected()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Default server factory
# ---------------------------------------------------------------------------

# Shared JSON Schema for tools that accept a Cayley table.
_CAYLEY_TABLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "table": {
            "type": "array",
            "items": {
                "type": "array",
                "items": {"type": "integer", "minimum": 0},
            },
            "description": (
                "Cayley table: an n x n matrix of integers, each entry in "
                "the range [0, n). Row i, column j gives the result of the "
                "binary operation applied to (i, j)."
            ),
        }
    },
    "required": ["table"],
}


def build_default_server() -> MCPServer:
    """Build an :class:`MCPServer` preloaded with Z3 verification tools.

    The following tools are registered, each backed by
    :class:`~mathweaver.counterexample.forge.CounterExampleForge`:

    ``check_group_axioms``
        Verify closure, associativity, identity and inverses.
    ``verify_associativity``
        Verify associativity of the binary operation.
    ``check_commutativity``
        Verify the Abelian (commutative) property.

    Each tool returns a serialized ``CounterExampleResult`` dict where
    ``success`` is ``True`` when a counter-example was found (i.e. the
    property *fails*).
    """
    # Imported lazily so the module is importable without z3 installed and
    # works both as a package module and a standalone script.
    try:
        from ..counterexample.forge import CounterExampleForge
    except ImportError:  # pragma: no cover - script-mode fallback
        from mathweaver.counterexample.forge import CounterExampleForge  # type: ignore

    server = MCPServer(
        name="mathweaver-mcp",
        version="0.1.0",
        description="MathWeaver MCP server exposing Z3 verification tools",
    )
    forge = CounterExampleForge()

    def _check_group_axioms(args: dict[str, Any]):
        return forge.check_group_axioms(args["table"])

    def _verify_associativity(args: dict[str, Any]):
        return forge.verify_associativity(args["table"])

    def _check_commutativity(args: dict[str, Any]):
        return forge.check_commutativity(args["table"])

    server.register_tool(
        "check_group_axioms",
        (
            "Check whether a Cayley table defines a group using Z3. Verifies "
            "closure, associativity, identity element and inverses. Returns "
            "success=True with a counter-example when any axiom is violated."
        ),
        _check_group_axioms,
        input_schema=_CAYLEY_TABLE_SCHEMA,
    )
    server.register_tool(
        "verify_associativity",
        (
            "Verify associativity of a binary operation given as a Cayley "
            "table using Z3. Returns success=True with the violating triple "
            "when associativity fails."
        ),
        _verify_associativity,
        input_schema=_CAYLEY_TABLE_SCHEMA,
    )
    server.register_tool(
        "check_commutativity",
        (
            "Check commutativity (Abelian property) of a binary operation "
            "given as a Cayley table using Z3. Returns success=True with the "
            "violating pair when commutativity fails."
        ),
        _check_commutativity,
        input_schema=_CAYLEY_TABLE_SCHEMA,
    )

    return server


# ---------------------------------------------------------------------------
# Script entry point (stdio server)
# ---------------------------------------------------------------------------

if __name__ == "__main__":  # pragma: no cover
    # Allow running as ``python -m mathweaver.mcp_server.server`` or directly.
    # Ensure the backend package root is importable when invoked as a script.
    _backend_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    if _backend_root not in sys.path:
        sys.path.insert(0, _backend_root)
    build_default_server().serve_stdio()
