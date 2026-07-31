"""Manim animation pipeline.

Defines mathematical animations as frame-based data that can be:
1. Rendered to video via Manim (high quality, requires Manim + LaTeX)
2. Rendered as SVG frames (lightweight, works everywhere)

Each animation is a sequence of frames, where each frame is an SVG
string with a duration. The frontend plays these frames sequentially,
or plays the pre-rendered video if available.

This module also contains the Manim scene source code as strings,
so that the actual rendering can be done in a proper environment
by running: ``python -m mathweaver.animation.pipeline --render``
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class AnimationFrame:
    """A single frame of an animation."""

    svg: str  # SVG content for this frame
    duration_ms: int  # how long to display this frame
    caption: str = ""  # optional caption/narration


@dataclass
class AnimationDefinition:
    """A complete animation definition."""

    id: str
    title: str
    description: str
    concept: str  # e.g. "group_theory", "linear_algebra"
    duration_s: float
    manim_source: str  # Manim scene source code (for real rendering)
    frames: list[AnimationFrame] = field(default_factory=list)
    video_path: str | None = None  # path to pre-rendered video (if available)


@dataclass
class AnimationCatalog:
    """Catalog of all available animations."""

    animations: list[AnimationDefinition] = field(default_factory=list)

    def get(self, anim_id: str) -> AnimationDefinition | None:
        for a in self.animations:
            if a.id == anim_id:
                return a
        return None

    def list_ids(self) -> list[dict[str, Any]]:
        return [
            {
                "id": a.id,
                "title": a.title,
                "description": a.description,
                "concept": a.concept,
                "duration_s": a.duration_s,
                "has_video": a.video_path is not None,
                "frame_count": len(a.frames),
            }
            for a in self.animations
        ]


# ---------------------------------------------------------------------------
# SVG frame generators (fallback when Manim is unavailable)
# ---------------------------------------------------------------------------

# Color palette matching the app's dark theme
_COLORS = {
    "bg": "#1a1a2e",
    "card": "#23234a",
    "border": "#3a3a5c",
    "ink": "#e0e0f0",
    "muted": "#8888aa",
    "accent": "#c878dd",
    "ok": "#98c379",
    "warn": "#e5c07b",
    "err": "#e06c75",
    "blue": "#61afef",
    "cyan": "#56b6c2",
}

def _svg_header(width: int = 640, height: int = 360) -> str:
    return f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">'
    # Bg rect will be added by caller


def _svg_footer() -> str:
    return "</svg>"


def _text(x: float, y: float, text: str, size: int = 16, color: str | None = None,
          bold: bool = False, anchor: str = "middle") -> str:
    c = color or _COLORS["ink"]
    weight = "bold" if bold else "normal"
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{c}" font-weight="{weight}" text-anchor="{anchor}" font-family="monospace">{text}</text>'


def _rect(x: float, y: float, w: float, h: float, fill: str = "none",
          stroke: str | None = None, sw: float = 1, rx: float = 4) -> str:
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"{s} rx="{rx}"/>'


def _circle(cx: float, cy: float, r: float, fill: str = "none",
            stroke: str | None = None, sw: float = 1) -> str:
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"{s}/>'


def _line(x1: float, y1: float, x2: float, y2: float, stroke: str = "#3a3a5c",
          sw: float = 1.5, dash: str | None = None) -> str:
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}"{d}/>'


def _arrow(x1: float, y1: float, x2: float, y2: float, stroke: str = "#c878dd",
           sw: float = 2) -> str:
    return (f'<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" '
            f'orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="{stroke}"/></marker></defs>'
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" '
            f'stroke-width="{sw}" marker-end="url(#arr)"/>')


# ---------------------------------------------------------------------------
# Animation 1: Group Operation (Cayley table highlight)
# ---------------------------------------------------------------------------

def _gen_group_operation_frames() -> list[AnimationFrame]:
    """Generate frames showing how a*b is computed from a Cayley table."""
    W, H = 640, 360
    table = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]  # Z3
    n = 3
    cell = 50
    ox, oy = 180, 80

    def draw_table(highlight_a: int | None = None, highlight_b: int | None = None,
                   highlight_result: int | None = None, show_result: bool = False) -> str:
        svg = _svg_header(W, H)
        svg += f'<rect width="{W}" height="{H}" fill="{_COLORS["bg"]}"/>'
        svg += _text(W / 2, 35, "Z₃ 的 Cayley 表 · 群运算", 18, _COLORS["ink"], bold=True)

        # Column headers (b values)
        for j in range(n):
            color = _COLORS["blue"] if highlight_b == j else _COLORS["muted"]
            svg += _text(ox + cell * j + cell / 2, oy - 10, str(j), 16, color, bold=True)

        # Row headers (a values)
        for i in range(n):
            color = _COLORS["warn"] if highlight_a == i else _COLORS["muted"]
            svg += _text(ox - 20, oy + cell * i + cell / 2 + 5, str(i), 16, color, bold=True)

        # Cells
        for i in range(n):
            for j in range(n):
                cx = ox + cell * j
                cy = oy + cell * i
                fill = _COLORS["card"]
                if highlight_a == i and highlight_b == j:
                    fill = _COLORS["accent"]
                elif show_result and highlight_a is not None and highlight_b is not None and i == highlight_a and j == highlight_b:
                    fill = _COLORS["ok"]
                svg += _rect(cx, cy, cell, cell, fill, _COLORS["border"])
                val_color = _COLORS["ink"]
                if highlight_a == i and highlight_b == j:
                    val_color = "#ffffff"
                svg += _text(cx + cell / 2, cy + cell / 2 + 5, str(table[i][j]), 16, val_color, bold=True)

        # Result text
        if show_result and highlight_a is not None and highlight_b is not None:
            result = table[highlight_a][highlight_b]
            svg += _text(W / 2, H - 30, f"结果: {highlight_a} * {highlight_b} = {result}",
                        18, _COLORS["ok"], bold=True)

        svg += _svg_footer()
        return svg

    return [
        AnimationFrame(svg=draw_table(), duration_ms=1500, caption="这是 Z₃ 的 Cayley 运算表"),
        AnimationFrame(svg=draw_table(highlight_a=1), duration_ms=1000, caption="选择行 a = 1"),
        AnimationFrame(svg=draw_table(highlight_a=1, highlight_b=2), duration_ms=1000, caption="选择列 b = 2"),
        AnimationFrame(svg=draw_table(highlight_a=1, highlight_b=2, show_result=True), duration_ms=2000,
                       caption="交叉处即为 a * b = 0"),
    ]


# ---------------------------------------------------------------------------
# Animation 2: Associativity (a*b)*c = a*(b*c)
# ---------------------------------------------------------------------------

def _gen_associativity_frames() -> list[AnimationFrame]:
    """Generate frames demonstrating associativity with color-coded paths."""
    W, H = 640, 360
    table = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]  # Z3
    a, b, c = 1, 2, 0

    def draw_step(step: int) -> str:
        svg = _svg_header(W, H)
        svg += f'<rect width="{W}" height="{H}" fill="{_COLORS["bg"]}"/>'
        svg += _text(W / 2, 35, "结合律验证: (a·b)·c = a·(b·c)", 16, _COLORS["ink"], bold=True)

        # Compute intermediates
        ab = table[a][b]
        bc = table[b][c]
        left = table[ab][c]  # (a*b)*c
        right = table[a][bc]  # a*(b*c)

        # Left side: (a·b)·c
        lx = 100
        ly = 80
        svg += _text(lx, ly, "左侧: (a·b)·c", 14, _COLORS["blue"], bold=True)

        if step >= 1:
            svg += _text(lx, ly + 30, f"a = {a},  b = {b},  c = {c}", 14, _COLORS["muted"])
        if step >= 2:
            svg += _text(lx, ly + 55, f"a·b = {a}·{b} = {ab}", 14, _COLORS["warn"])
        if step >= 3:
            svg += _text(lx, ly + 80, f"(a·b)·c = {ab}·{c} = {left}", 14, _COLORS["ok"], bold=True)

        # Right side: a·(b·c)
        rx = 400
        ry = 80
        svg += _text(rx, ry, "右侧: a·(b·c)", 14, _COLORS["cyan"], bold=True)

        if step >= 1:
            svg += _text(rx, ry + 30, f"a = {a},  b = {b},  c = {c}", 14, _COLORS["muted"])
        if step >= 2:
            svg += _text(rx, ry + 55, f"b·c = {b}·{c} = {bc}", 14, _COLORS["warn"])
        if step >= 3:
            svg += _text(rx, ry + 80, f"a·(b·c) = {a}·{bc} = {right}", 14, _COLORS["ok"], bold=True)

        # Result comparison
        if step >= 3:
            svg += _rect(W / 2 - 120, H - 60, 240, 35, _COLORS["card"], _COLORS["border"], 1, 8)
            if left == right:
                svg += _text(W / 2, H - 37, f"✓ {left} = {right}  结合律成立!", 16, _COLORS["ok"], bold=True)
            else:
                svg += _text(W / 2, H - 37, f"✗ {left} ≠ {right}  结合律不成立!", 16, _COLORS["err"], bold=True)

        svg += _svg_footer()
        return svg

    return [
        AnimationFrame(svg=draw_step(0), duration_ms=1200, caption="验证 Z₃ 上的结合律"),
        AnimationFrame(svg=draw_step(1), duration_ms=1500, caption="设 a=1, b=2, c=0"),
        AnimationFrame(svg=draw_step(2), duration_ms=1500, caption="分别计算中间值 a·b 和 b·c"),
        AnimationFrame(svg=draw_step(3), duration_ms=2500, caption="两侧结果相等，结合律成立"),
    ]


# ---------------------------------------------------------------------------
# Animation 3: Identity Element Discovery
# ---------------------------------------------------------------------------

def _gen_identity_frames() -> list[AnimationFrame]:
    """Generate frames showing identity element discovery."""
    W, H = 640, 360
    table = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]  # Z3
    n = 3
    cell = 50
    ox, oy = 180, 80

    def draw(identity: int | None = None, checking: int | None = None) -> str:
        svg = _svg_header(W, H)
        svg += f'<rect width="{W}" height="{H}" fill="{_COLORS["bg"]}"/>'
        svg += _text(W / 2, 35, "寻找单位元", 18, _COLORS["ink"], bold=True)

        # Check each row as potential identity
        for i in range(n):
            cy = oy + cell * i
            is_identity_row = identity == i
            is_checking = checking == i

            # Highlight row and column
            if is_identity_row:
                svg += _rect(ox - cell, cy, cell * (n + 1), cell, _COLORS["ok"] + "33")
                svg += _rect(ox + cell * i, oy - cell, cell, cell * (n + 1), _COLORS["ok"] + "33")
            elif is_checking:
                svg += _rect(ox - cell, cy, cell * (n + 1), cell, _COLORS["warn"] + "22")

        # Table
        for j in range(n):
            svg += _text(ox + cell * j + cell / 2, oy - 10, str(j), 16, _COLORS["muted"], bold=True)
        for i in range(n):
            svg += _text(ox - 20, oy + cell * i + cell / 2 + 5, str(i), 16, _COLORS["muted"], bold=True)

        for i in range(n):
            for j in range(n):
                cx = ox + cell * j
                cy = oy + cell * i
                fill = _COLORS["card"]
                if identity == i:
                    fill = _COLORS["ok"] + "44"
                svg += _rect(cx, cy, cell, cell, fill, _COLORS["border"])
                color = _COLORS["ink"]
                if identity == i:
                    color = _COLORS["ok"]
                svg += _text(cx + cell / 2, cy + cell / 2 + 5, str(table[i][j]), 16, color, bold=(identity == i))

        # Caption
        if identity is not None:
            svg += _text(W / 2, H - 25, f"✓ 单位元是 e = {identity}  (行和列都等于 {identity})",
                        16, _COLORS["ok"], bold=True)
        elif checking is not None:
            is_id = all(table[checking][j] == j for j in range(n))
            svg += _text(W / 2, H - 25, f"检查 e = {checking}... {'通过 ✓' if is_id else '不通过 ✗'}",
                        16, _COLORS["warn"])

        svg += _svg_footer()
        return svg

    return [
        AnimationFrame(svg=draw(), duration_ms=1200, caption="在 Z₃ 中寻找单位元"),
        AnimationFrame(svg=draw(checking=0), duration_ms=1500, caption="检查 e=0: 第 0 行 = [0,1,2]，等于元素本身 → 通过"),
        AnimationFrame(svg=draw(identity=0), duration_ms=2000, caption="单位元 e = 0 找到了!"),
    ]


# ---------------------------------------------------------------------------
# Animation 4: Inverse Element Pairing
# ---------------------------------------------------------------------------

def _gen_inverse_frames() -> list[AnimationFrame]:
    """Generate frames showing inverse element pairing."""
    W, H = 640, 360
    table = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]  # Z3
    n = 3
    cell = 50
    ox, oy = 160, 80
    identity = 0

    # Find inverse pairs
    inverses = {}
    for a in range(n):
        for b in range(n):
            if table[a][b] == identity:
                inverses[a] = b
                break

    def draw(highlight_a: int | None = None, show_all: bool = False) -> str:
        svg = _svg_header(W, H)
        svg += f'<rect width="{W}" height="{H}" fill="{_COLORS["bg"]}"/>'
        svg += _text(W / 2, 35, "逆元的寻找", 18, _COLORS["ink"], bold=True)

        # Table
        for j in range(n):
            svg += _text(ox + cell * j + cell / 2, oy - 10, str(j), 16, _COLORS["muted"], bold=True)
        for i in range(n):
            svg += _text(ox - 20, oy + cell * i + cell / 2 + 5, str(i), 16, _COLORS["muted"], bold=True)

        for i in range(n):
            for j in range(n):
                cx = ox + cell * j
                cy = oy + cell * i
                fill = _COLORS["card"]
                # Highlight identity column
                if j == identity:
                    fill = _COLORS["blue"] + "22"
                # Highlight the inverse pair
                if show_all and table[i][j] == identity:
                    fill = _COLORS["ok"] + "55"
                elif highlight_a == i and table[i][j] == identity:
                    fill = _COLORS["ok"] + "55"

                svg += _rect(cx, cy, cell, cell, fill, _COLORS["border"])
                color = _COLORS["ink"]
                if (show_all or highlight_a == i) and table[i][j] == identity:
                    color = _COLORS["ok"]
                svg += _text(cx + cell / 2, cy + cell / 2 + 5, str(table[i][j]), 16, color, bold=True)

        # Show pairs
        pair_y = oy + cell * n + 30
        if show_all:
            svg += _text(W / 2, pair_y, "逆元配对:", 14, _COLORS["muted"])
            pairs_text = "  ".join(f"{a}⁻¹ = {inverses[a]}" for a in range(n))
            svg += _text(W / 2, pair_y + 25, pairs_text, 16, _COLORS["ok"], bold=True)
            svg += _text(W / 2, H - 20, "每个元素都有唯一的逆元，且 (a⁻¹)⁻¹ = a", 14, _COLORS["muted"])
        elif highlight_a is not None:
            inv = inverses[highlight_a]
            svg += _text(W / 2, pair_y, f"找 {highlight_a} 的逆元: 在第 {highlight_a} 行中找值为 0 (单位元) 的列",
                        14, _COLORS["warn"])
            svg += _text(W / 2, pair_y + 25, f"→ {highlight_a}⁻¹ = {inv}", 16, _COLORS["ok"], bold=True)

        svg += _svg_footer()
        return svg

    return [
        AnimationFrame(svg=draw(), duration_ms=1200, caption="在 Z₃ 中寻找每个元素的逆元"),
        AnimationFrame(svg=draw(highlight_a=0), duration_ms=1500, caption="0 的逆元: 第 0 行中 0 在第 0 列 → 0⁻¹ = 0"),
        AnimationFrame(svg=draw(highlight_a=1), duration_ms=1500, caption="1 的逆元: 第 1 行中 0 在第 2 列 → 1⁻¹ = 2"),
        AnimationFrame(svg=draw(highlight_a=2), duration_ms=1500, caption="2 的逆元: 第 2 行中 0 在第 1 列 → 2⁻¹ = 1"),
        AnimationFrame(svg=draw(show_all=True), duration_ms=2500, caption="所有逆元配对完成!"),
    ]


# ---------------------------------------------------------------------------
# Animation 5: Commutativity Check (S₃ counter-example)
# ---------------------------------------------------------------------------

def _gen_commutativity_frames() -> list[AnimationFrame]:
    """Generate frames showing S₃ is non-commutative."""
    W, H = 640, 360
    # S3 Cayley table (simplified 6x6)
    table = [
        [0, 1, 2, 3, 4, 5],
        [1, 0, 3, 2, 5, 4],
        [2, 4, 0, 5, 1, 3],
        [3, 5, 1, 4, 0, 2],
        [4, 2, 5, 0, 3, 1],
        [5, 3, 4, 1, 2, 0],
    ]
    n = 6
    cell = 36
    ox, oy = 150, 70

    def draw(highlight: tuple[int, int] | None = None, show_result: bool = False) -> str:
        svg = _svg_header(W, H)
        svg += f'<rect width="{W}" height="{H}" fill="{_COLORS["bg"]}"/>'
        svg += _text(W / 2, 30, "S₃ 的 Cayley 表 · 交换律检查", 16, _COLORS["ink"], bold=True)

        for j in range(n):
            svg += _text(ox + cell * j + cell / 2, oy - 8, str(j), 12, _COLORS["muted"], bold=True)
        for i in range(n):
            svg += _text(ox - 15, oy + cell * i + cell / 2 + 4, str(i), 12, _COLORS["muted"], bold=True)

        for i in range(n):
            for j in range(n):
                cx = ox + cell * j
                cy = oy + cell * i
                fill = _COLORS["card"]
                if highlight:
                    a, b = highlight
                    if (i, j) == (a, b):
                        fill = _COLORS["err"] + "55"
                    elif (i, j) == (b, a):
                        fill = _COLORS["warn"] + "55"
                svg += _rect(cx, cy, cell, cell, fill, _COLORS["border"], 0.5, 2)
                color = _COLORS["ink"]
                if highlight and ((i, j) == highlight[0:2] or (i, j) == (highlight[1], highlight[0])):
                    color = "#ffffff"
                svg += _text(cx + cell / 2, cy + cell / 2 + 4, str(table[i][j]), 12, color, bold=False)

        if show_result and highlight:
            a, b = highlight
            ab = table[a][b]
            ba = table[b][a]
            svg += _text(W / 2, H - 35, f"{a}·{b} = {ab},  {b}·{a} = {ba}", 16, _COLORS["ink"], bold=True)
            if ab != ba:
                svg += _text(W / 2, H - 15, f"✗ {ab} ≠ {ba}  S₃ 不交换!", 16, _COLORS["err"], bold=True)
            else:
                svg += _text(W / 2, H - 15, f"✓ 这对交换，但其他对不交换", 14, _COLORS["warn"])

        svg += _svg_footer()
        return svg

    return [
        AnimationFrame(svg=draw(), duration_ms=1500, caption="这是 S₃ (6阶对称群) 的 Cayley 表"),
        AnimationFrame(svg=draw(highlight=(1, 2)), duration_ms=1500, caption="检查 1·2 和 2·1..."),
        AnimationFrame(svg=draw(highlight=(1, 2), show_result=True), duration_ms=2500,
                       caption="1·2 = 3 但 2·1 = 4 → S₃ 不是交换群!"),
    ]


# ---------------------------------------------------------------------------
# Manim scene source code (for real rendering)
# ---------------------------------------------------------------------------

_MANIM_GROUP_OPERATION_SOURCE = '''
from manim import *

class GroupOperationScene(Scene):
    """Demonstrate group operation on Z3."""
    def construct(self):
        # Title
        title = Text("Z₃ 的群运算", font_size=36)
        title.to_edge(UP)
        self.play(Write(title))
        self.wait(0.5)

        # Create Cayley table
        table_data = [["*", "0", "1", "2"],
                      ["0", "0", "1", "2"],
                      ["1", "1", "2", "0"],
                      ["2", "2", "0", "1"]]

        table = Table(table_data, include_outer_lines=True)
        table.scale(0.7)
        self.play(Create(table))
        self.wait(1)

        # Highlight row a=1
        row = table.get_rows()[2]
        row_highlight = row.copy().set_fill(YELLOW, opacity=0.3)
        self.play(FadeIn(row_highlight))
        self.wait(0.5)

        # Highlight column b=2
        col = table.get_columns()[3]
        col_highlight = col.copy().set_fill(BLUE, opacity=0.3)
        self.play(FadeIn(col_highlight))
        self.wait(0.5)

        # Show result
        result = Text("1 * 2 = 0", font_size=36, color=GREEN)
        result.to_edge(DOWN)
        self.play(Write(result))
        self.wait(2)
'''

_MANIM_ASSOCIATIVITY_SOURCE = '''
from manim import *

class AssociativityScene(Scene):
    """Demonstrate associativity: (a*b)*c = a*(b*c)."""
    def construct(self):
        title = Text("结合律: (a·b)·c = a·(b·c)", font_size=32)
        title.to_edge(UP)
        self.play(Write(title))

        # Left side
        left = MathTex(r"(1 \cdot 2) \cdot 0", font_size=48)
        left.shift(LEFT * 3)
        self.play(Write(left))
        self.wait(0.5)

        # Compute step by step
        left2 = MathTex(r"= 0 \cdot 0", font_size=48, color=YELLOW)
        left2.next_to(left, DOWN)
        self.play(Transform(left, left2))
        self.wait(0.5)

        left3 = MathTex(r"= 0", font_size=48, color=GREEN)
        left3.next_to(left2, DOWN)
        self.play(Transform(left, left3))
        self.wait(1)

        # Right side
        right = MathTex(r"1 \cdot (2 \cdot 0)", font_size=48)
        right.shift(RIGHT * 3)
        self.play(Write(right))
        self.wait(0.5)

        right2 = MathTex(r"= 1 \cdot 0", font_size=48, color=YELLOW)
        right2.next_to(right, DOWN)
        self.play(Transform(right, right2))
        self.wait(0.5)

        right3 = MathTex(r"= 0", font_size=48, color=GREEN)
        right3.next_to(right2, DOWN)
        self.play(Transform(right, right3))
        self.wait(1)

        # Conclusion
        result = MathTex(r"0 = 0 \\ \\text{结合律成立!}", font_size=36, color=GREEN)
        result.to_edge(DOWN)
        self.play(Write(result))
        self.wait(2)
'''

_MANIM_IDENTITY_SOURCE = '''
from manim import *

class IdentityScene(Scene):
    """Discover the identity element."""
    def construct(self):
        title = Text("寻找单位元", font_size=36)
        title.to_edge(UP)
        self.play(Write(title))

        table = MathTex(r"\\begin{pmatrix} 0 & 1 & 2 \\\\ 1 & 2 & 0 \\\\ 2 & 0 & 1 \\end{pmatrix}",
                       font_size=48)
        self.play(Write(table))
        self.wait(1)

        highlight = Text("第 0 行 = [0, 1, 2] = 元素本身", font_size=28, color=YELLOW)
        highlight.next_to(table, DOWN)
        self.play(Write(highlight))
        self.wait(1)

        result = Text("单位元 e = 0", font_size=36, color=GREEN)
        result.to_edge(DOWN)
        self.play(Write(result))
        self.wait(2)
'''

_MANIM_COMMUTATIVITY_SOURCE = '''
from manim import *

class CommutativityScene(Scene):
    """Show S3 is non-commutative."""
    def construct(self):
        title = Text("S₃ 不是交换群", font_size=36)
        title.to_edge(UP)
        self.play(Write(title))

        eq = MathTex(r"1 \\cdot 2 = 3 \\\\', r'2 \\cdot 1 = 4 \\\\', r'3 \\neq 4',
                     font_size=48)
        self.play(Write(eq))
        self.wait(1)

        box = SurroundingRectangle(eq, color=RED)
        self.play(Create(box))
        self.wait(2)
'''


# ---------------------------------------------------------------------------
# Build catalog
# ---------------------------------------------------------------------------

def _build_catalog() -> AnimationCatalog:
    """Build the animation catalog with all definitions."""
    animations = [
        AnimationDefinition(
            id="group_operation",
            title="群运算可视化",
            description="在 Z₃ 的 Cayley 表中选择两个元素，观察运算结果如何从表格交叉处产生",
            concept="group_theory",
            duration_s=5.5,
            manim_source=_MANIM_GROUP_OPERATION_SOURCE,
            frames=_gen_group_operation_frames(),
        ),
        AnimationDefinition(
            id="associativity",
            title="结合律验证",
            description="通过具体计算 (a·b)·c 和 a·(b·c)，展示两侧结果相等",
            concept="group_theory",
            duration_s=6.7,
            manim_source=_MANIM_ASSOCIATIVITY_SOURCE,
            frames=_gen_associativity_frames(),
        ),
        AnimationDefinition(
            id="identity_element",
            title="单位元发现",
            description="逐行检查 Cayley 表，找到满足 e·a = a 的单位元",
            concept="group_theory",
            duration_s=4.7,
            manim_source=_MANIM_IDENTITY_SOURCE,
            frames=_gen_identity_frames(),
        ),
        AnimationDefinition(
            id="inverse_pairs",
            title="逆元配对",
            description="为每个元素寻找逆元，验证 a·a⁻¹ = e",
            concept="group_theory",
            duration_s=8.2,
            manim_source="",  # uses identity source as template
            frames=_gen_inverse_frames(),
        ),
        AnimationDefinition(
            id="commutativity_s3",
            title="S₃ 交换律反例",
            description="在 S₃ 中找到 a·b ≠ b·a，证明对称群不交换",
            concept="group_theory",
            duration_s=5.5,
            manim_source=_MANIM_COMMUTATIVITY_SOURCE,
            frames=_gen_commutativity_frames(),
        ),
    ]

    # Check for pre-rendered videos
    video_dir = Path(__file__).parent / "videos"
    for anim in animations:
        video_file = video_dir / f"{anim.id}.mp4"
        if video_file.exists():
            anim.video_path = str(video_file)

    return AnimationCatalog(animations=animations)


# Singleton
_catalog: AnimationCatalog | None = None


def get_animation_catalog() -> AnimationCatalog:
    """Get the singleton animation catalog."""
    global _catalog
    if _catalog is None:
        _catalog = _build_catalog()
    return _catalog


# ---------------------------------------------------------------------------
# Manim rendering (requires manim installed)
# ---------------------------------------------------------------------------

class AnimationPipeline:
    """Pipeline for rendering animations via Manim."""

    def __init__(self, output_dir: str | Path | None = None) -> None:
        self.output_dir = Path(output_dir) if output_dir else Path(__file__).parent / "videos"
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def render_animation(self, anim: AnimationDefinition) -> str | None:
        """Render a single animation using Manim.

        Writes the Manim source to a temp file, runs manim, and
        returns the path to the rendered video.
        Returns None if Manim is not available.
        """
        if not anim.manim_source:
            logger.warning("No Manim source for animation %s", anim.id)
            return None

        # Check if manim is available
        try:
            result = subprocess.run(
                [sys.executable, "-c", "import manim; print(manim.__version__)"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                logger.info("Manim not available, skipping video render for %s", anim.id)
                return None
        except Exception:
            logger.info("Manim not available, skipping video render for %s", anim.id)
            return None

        # Write scene source to temp file
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, dir=str(self.output_dir)
        ) as f:
            f.write(anim.manim_source)
            scene_file = f.name

        try:
            # Run manim render
            class_name = self._extract_class_name(anim.manim_source)
            result = subprocess.run(
                [
                    sys.executable, "-m", "manim", "render",
                    "-pqk",  # preview, quality 1080p
                    "--format", "mp4",
                    "-o", f"{anim.id}.mp4",
                    scene_file,
                    class_name,
                ],
                capture_output=True, text=True, timeout=120,
                cwd=str(self.output_dir),
            )

            if result.returncode == 0:
                video_path = self.output_dir / f"{anim.id}.mp4"
                if video_path.exists():
                    anim.video_path = str(video_path)
                    logger.info("Rendered %s -> %s", anim.id, video_path)
                    return str(video_path)
            else:
                logger.error("Manim render failed for %s: %s", anim.id, result.stderr[:500])

        except Exception:
            logger.error("Failed to render %s", anim.id, exc_info=True)
        finally:
            Path(scene_file).unlink(missing_ok=True)

        return None

    @staticmethod
    def _extract_class_name(source: str) -> str:
        """Extract the Scene class name from Manim source."""
        import re
        m = re.search(r"class\s+(\w+)\s*\(", source)
        return m.group(1) if m else "Scene"

    def render_all(self) -> dict[str, str | None]:
        """Render all animations in the catalog."""
        catalog = get_animation_catalog()
        results = {}
        for anim in catalog.animations:
            results[anim.id] = self.render_animation(anim)
        return results


def render_all_animations() -> dict[str, str | None]:
    """Render all animations (convenience function)."""
    pipeline = AnimationPipeline()
    return pipeline.render_all()


# ---------------------------------------------------------------------------
# CLI entry point for rendering
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Render MathWeaver animations")
    parser.add_argument("--render", action="store_true", help="Render all animations via Manim")
    parser.add_argument("--list", action="store_true", help="List all animations")
    args = parser.parse_args()

    if args.list:
        catalog = get_animation_catalog()
        for info in catalog.list_ids():
            media = "video" if info["has_video"] else str(info["frame_count"]) + " frames"
            print(f"  {info['id']}: {info['title']} ({info['duration_s']}s, {media})")

    if args.render:
        print("Rendering all animations...")
        results = render_all_animations()
        for anim_id, path in results.items():
            if path:
                print(f"  ✓ {anim_id} -> {path}")
            else:
                print(f"  ✗ {anim_id} (rendering failed or Manim not available)")
