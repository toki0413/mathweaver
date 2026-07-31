"""Manim animation pipeline for MathWeaver.

Provides pre-rendered mathematical animations that can be played on demand.
Uses Manim for high-quality rendering when available; falls back to
SVG frame generation for environments without Manim/LaTeX.

Pipeline:
    1. Scene definitions (Python/Manim source)
    2. Frame generation (Manim → video, or SVG → frames)
    3. API serving (video file or frame data)
    4. Frontend playback (HTML5 video or SVG animation)
"""

from .pipeline import (
    AnimationCatalog,
    AnimationPipeline,
    get_animation_catalog,
    render_all_animations,
)
