"""Tests for the multi-tenant isolation manager (mathweaver/tenant/manager.py).

Verifies acceptance criterion 8.2: "租户 A 无法读取租户 B 状态" — each tenant
gets an isolated orchestrator, and the manager's lifecycle methods
(get/start/process/evict/verify_isolation/close) behave correctly.
"""

from __future__ import annotations

import asyncio

import pytest

from mathweaver.tenant.manager import TenantManager


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def manager():
    tm = TenantManager(db_path=":memory:")
    yield tm
    tm.close()


def test_get_orchestrator_creates_isolated_instances(manager):
    a = manager.get_orchestrator("tenant_a")
    b = manager.get_orchestrator("tenant_b")
    assert a is not b
    # Same tenant returns the same instance.
    assert manager.get_orchestrator("tenant_a") is a


def test_start_session_scopes_student_id(manager):
    info = manager.start_session("tenant_a", "stu1", student_name="Alice")
    assert info["session_id"].startswith("sess_tenant_a:stu1_")
    assert manager._active_sessions["tenant_a"] == info["session_id"]


def test_process_input_returns_response(manager):
    manager.start_session("tenant_a", "stu1")
    result = _run(manager.process_input("tenant_a", "什么是群？"))
    assert result["response"]
    assert result["grill_mode"] is False


def test_get_tenant_state(manager):
    assert manager.get_tenant_state("missing") is None
    manager.start_session("tenant_a", "stu1")
    snap = manager.get_tenant_state("tenant_a")
    assert snap is not None
    assert "phase" in snap


def test_list_tenants(manager):
    manager.start_session("tenant_a", "s1")
    manager.start_session("tenant_b", "s2")
    assert set(manager.list_tenants()) == {"tenant_a", "tenant_b"}


def test_evict_removes_orchestrator(manager):
    manager.start_session("tenant_a", "s1")
    assert "tenant_a" in manager._orchestrators
    manager.evict("tenant_a")
    assert "tenant_a" not in manager._orchestrators
    assert "tenant_a" not in manager._active_sessions


def test_verify_isolation_returns_true_for_distinct_tenants(manager):
    manager.start_session("tenant_a", "s1")
    manager.start_session("tenant_b", "s2")
    assert manager.verify_isolation("tenant_a", "tenant_b") is True


def test_verify_isolation_same_tenant_returns_false(manager):
    """Same tenant shares one orchestrator, so isolation check is False."""
    manager.start_session("tenant_a", "s1")
    assert manager.verify_isolation("tenant_a", "tenant_a") is False


def test_verify_isolation_false_when_sharing_instance(manager):
    # Force both tenants onto the same orchestrator instance.
    shared = manager.get_orchestrator("tenant_a")
    manager._orchestrators["tenant_b"] = shared
    assert manager.verify_isolation("tenant_a", "tenant_b") is False


def test_close_evicts_all(manager):
    manager.start_session("tenant_a", "s1")
    manager.start_session("tenant_b", "s2")
    manager.close()
    assert manager._orchestrators == {}
