"""Grill Me mode: system interviews the student relentlessly.

Inspired by Matt Pocock's grill-me skill:
- Role inversion: system asks, student answers
- One question at a time
- Each question comes with a recommended answer
- Walk the concept DAG as the decision tree
- "Codebase-first": if answerable from prior Cayley tables, don't ask

Extended with:
- Adaptive difficulty: dynamically adjust based on performance signals
- Encouragement engine: growth-mindset language and emotional calibration
- Visual data: structured data for interactive UI rendering
"""

from .adaptive import AdaptiveDifficulty, PerformanceSignal
from .encouragement import EncouragementContext, EncouragementEngine
from .generator import GeneratedQuestion, QuestionGenerator
from .narrative import weave_for_conjecture_metadata, weave_narrative
from .session import GrillBranch, GrillQuestion, GrillSession
from .visual_data import VisualDataBuilder

__all__ = [
    "GrillSession",
    "GrillQuestion",
    "GrillBranch",
    "weave_narrative",
    "weave_for_conjecture_metadata",
    "AdaptiveDifficulty",
    "PerformanceSignal",
    "EncouragementEngine",
    "EncouragementContext",
    "VisualDataBuilder",
    "QuestionGenerator",
    "GeneratedQuestion",
]
