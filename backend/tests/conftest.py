"""Pytest configuration shared across the MathWeaver test suite.

This module is auto-loaded by pytest before any test module in this
directory runs. It:

1. Inserts the backend package root onto ``sys.path`` so that every
   test can ``import mathweaver.*`` without repeating a path hack.
2. Provides an autouse fixture that resets the global DAG singleton
   cache and default level between tests, so tests that mutate global
   curriculum state (``set_default_level``, ``reset_dag``) never leak
   into one another.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the backend root importable: ``import mathweaver`` works everywhere.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


import pytest  # noqa: E402  (import after sys.path tweak)


@pytest.fixture(autouse=True)
def _reset_global_dag_state():
    """Reset global curriculum state before and after every test.

    Several modules under test (``concept_dag``, ``orchestrator``) keep
    module-level singletons (``_dags`` cache, ``DEFAULT_LEVEL``). Tests
    freely call ``set_default_level`` / ``reset_dag`` and we must ensure
    a clean slate so test ordering does not matter.
    """
    from mathweaver.dag import concept_dag as _cd

    saved_default = _cd.DEFAULT_LEVEL
    _cd.reset_dag()  # clear all cached DAGs
    _cd.DEFAULT_LEVEL = "group_theory"
    yield
    _cd.reset_dag()
    _cd.DEFAULT_LEVEL = saved_default
