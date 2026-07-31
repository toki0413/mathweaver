"""Math concept DAG with multi-level curriculum support.

Loads concept dependency graphs from JSON data files. Supports ten
curriculum levels:
  - elementary (小学, grades 1-6)
  - middle_school (初中, grades 7-9)
  - high_school (高中, grades 10-12)
  - calculus (积分学, university year 1)
  - linear_algebra (线性代数, university year 1)
  - discrete_math (离散数学, university year 1-2)
  - number_theory (数论, university year 2)
  - group_theory (大学抽象代数, university year 2-3)
  - physics (物理 — 数学的延伸, university year 1-3)
  - chemistry (化学 — 数学的延伸, university year 1-3)

Design philosophy:
  Physics, chemistry, and computer science are extensions of mathematics.
  Each concept in these fields is grounded in a mathematical foundation:
    - Physics: calculus (derivatives/integrals), ODEs, vector analysis
    - Chemistry: linear algebra (LCAO), group theory (symmetry),
      differential equations (kinetics), thermodynamics (multivariable calc)
    - Computer science: discrete math (graphs, combinatorics, complexity)

Each level is a separate JSON file in the data/ directory.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from ..models.state import ConceptNode

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Supported curriculum levels, ordered by progression.
# Physics and chemistry come after the math foundations — they ARE math
# applied to the natural world.
CURRICULUM_LEVELS = [
    "elementary",
    "middle_school",
    "high_school",
    "calculus",
    "linear_algebra",
    "discrete_math",
    "number_theory",
    "group_theory",
    "physics",
    "chemistry",
]

# Human-readable labels for each level
CURRICULUM_LABELS = {
    "elementary": "小学数学",
    "middle_school": "初中数学",
    "high_school": "高中数学",
    "calculus": "积分学（大学）",
    "linear_algebra": "线性代数（大学）",
    "discrete_math": "离散数学（大学）",
    "number_theory": "数论（大学）",
    "group_theory": "群论（大学）",
    "physics": "物理（数学的延伸）",
    "chemistry": "化学（数学的延伸）",
}


def _load_curriculum(level: str = "group_theory") -> list[dict]:
    """Load curriculum from JSON file for the given level.

    Falls back to built-in GROUP_THEORY_SEED only for the group_theory level.
    """
    curriculum_path = DATA_DIR / f"{level}_curriculum.json"
    if curriculum_path.exists():
        try:
            with open(curriculum_path, encoding="utf-8") as f:
                data = json.load(f)
            logger.info(
                "Loaded curriculum [%s]: %d concepts from %s",
                level, len(data), curriculum_path,
            )
            return data
        except Exception as e:
            logger.warning(
                "Failed to load curriculum JSON [%s]: %s, using fallback",
                level, e,
            )

    # Fallback: built-in seed (only exists for group_theory)
    if level == "group_theory":
        return GROUP_THEORY_SEED

    # For other levels, no fallback — raise to surface the error
    raise FileNotFoundError(
        f"Curriculum file not found for level '{level}': {curriculum_path}"
    )


def get_available_curricula() -> list[dict]:
    """List all available curriculum levels with metadata.

    Returns a list of dicts with keys: level, label, concept_count, file_exists.
    """
    result = []
    for level in CURRICULUM_LEVELS:
        path = DATA_DIR / f"{level}_curriculum.json"
        entry: dict = {
            "level": level,
            "label": CURRICULUM_LABELS.get(level, level),
            "file": str(path),
            "file_exists": path.exists(),
        }
        if path.exists():
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                entry["concept_count"] = len(data)
                # Extract domains
                domains = set()
                for c in data:
                    domains.add(c.get("domain", "general"))
                entry["domains"] = sorted(domains)
            except Exception:
                entry["concept_count"] = 0
                entry["domains"] = []
        else:
            entry["concept_count"] = 0
            entry["domains"] = []
        result.append(entry)
    return result


# Group theory concept seed (fallback when JSON file is unavailable)
GROUP_THEORY_SEED: list[dict] = [
    {
        "id": "set_basics",
        "name": "集合基础",
        "description": "集合的概念、运算（并、交、补）与映射",
        "prerequisites": [],
        "abstraction_level": 0,
        "domain": "foundations",
        "difficulty": 0.2,
        "is_milestone": True,
    },
    {
        "id": "binary_operation",
        "name": "二元运算",
        "description": "集合上的封闭二元运算，运算表（Cayley 表）",
        "prerequisites": ["set_basics"],
        "abstraction_level": 1,
        "domain": "algebra",
        "difficulty": 0.3,
        "is_milestone": False,
    },
    {
        "id": "associativity",
        "name": "结合律",
        "description": "运算的结合性质，与运算顺序无关",
        "prerequisites": ["binary_operation"],
        "abstraction_level": 1,
        "domain": "algebra",
        "difficulty": 0.35,
        "is_milestone": False,
    },
    {
        "id": "identity_element",
        "name": "单位元",
        "description": "使运算保持不变的元素 e：e·a = a·e = a",
        "prerequisites": ["binary_operation", "associativity"],
        "abstraction_level": 2,
        "domain": "algebra",
        "difficulty": 0.4,
        "is_milestone": True,
    },
    {
        "id": "inverse_element",
        "name": "逆元",
        "description": "对每个元素 a，存在 a⁻¹ 使 a·a⁻¹ = a⁻¹·a = e",
        "prerequisites": ["identity_element", "associativity"],
        "abstraction_level": 2,
        "domain": "algebra",
        "difficulty": 0.45,
        "is_milestone": True,
    },
    {
        "id": "group_definition",
        "name": "群的定义",
        "description": "封闭性 + 结合律 + 单位元 + 逆元 = 群",
        "prerequisites": ["binary_operation", "associativity", "identity_element", "inverse_element"],
        "abstraction_level": 3,
        "domain": "algebra",
        "difficulty": 0.55,
        "is_milestone": True,
    },
    {
        "id": "abelian_group",
        "name": "交换群（Abel 群）",
        "description": "满足交换律 a·b = b·a 的群",
        "prerequisites": ["group_definition"],
        "abstraction_level": 3,
        "domain": "algebra",
        "difficulty": 0.5,
        "is_milestone": False,
    },
    {
        "id": "cyclic_group",
        "name": "循环群",
        "description": "由单个元素生成的群：⟨g⟩ = {gⁿ | n ∈ ℤ}",
        "prerequisites": ["group_definition"],
        "abstraction_level": 4,
        "domain": "algebra",
        "difficulty": 0.6,
        "is_milestone": False,
    },
    {
        "id": "subgroup",
        "name": "子群",
        "description": "群的子集自身构成群",
        "prerequisites": ["group_definition"],
        "abstraction_level": 4,
        "domain": "algebra",
        "difficulty": 0.6,
        "is_milestone": True,
    },
    {
        "id": "lagrange_theorem",
        "name": "拉格朗日定理",
        "description": "子群的阶整除群的阶",
        "prerequisites": ["subgroup", "cosets", "group_order"],
        "abstraction_level": 5,
        "domain": "algebra",
        "difficulty": 0.75,
        "is_milestone": True,
    },
]


class ConceptDAG:
    """In-memory concept dependency graph.

    Supports loading from any curriculum level. The level is stored
    for introspection and UI display.
    """

    def __init__(
        self,
        seed_data: list[dict] | None = None,
        level: str = "group_theory",
    ) -> None:
        self.level = level
        self._nodes: dict[str, ConceptNode] = {}
        self._adjacency: dict[str, list[str]] = {}
        data = seed_data if seed_data is not None else _load_curriculum(level)
        for entry in data:
            node = ConceptNode(**entry)
            self._nodes[node.id] = node
            self._adjacency[node.id] = list(node.prerequisites)

    def get_node(self, node_id: str) -> ConceptNode | None:
        return self._nodes.get(node_id)

    def get_prerequisites(self, node_id: str) -> list[str]:
        return self._adjacency.get(node_id, [])

    def get_dependents(self, node_id: str) -> list[str]:
        return [nid for nid, prereqs in self._adjacency.items() if node_id in prereqs]

    def check_prerequisites(self, node_id: str, mastery: dict[str, float]) -> list[str]:
        """Return list of unmet prerequisite node IDs."""
        gaps = []
        for prereq in self.get_prerequisites(node_id):
            if mastery.get(prereq, 0.0) < 0.6:
                gaps.append(prereq)
        return gaps

    def get_learning_path(self, target_node_id: str, mastery: dict[str, float]) -> list[str]:
        """Compute a learning path to reach target_node, filling gaps."""
        path: list[str] = []
        visited: set[str] = set()

        def visit(nid: str) -> None:
            if nid in visited:
                return
            visited.add(nid)
            for prereq in self.get_prerequisites(nid):
                if mastery.get(prereq, 0.0) < 0.6:
                    visit(prereq)
            if mastery.get(nid, 0.0) < 0.6:
                path.append(nid)

        visit(target_node_id)
        return path

    def get_all_nodes(self) -> list[ConceptNode]:
        return list(self._nodes.values())

    def get_milestone_nodes(self) -> list[ConceptNode]:
        return [n for n in self._nodes.values() if n.is_milestone]

    def search_nodes_by_keyword(self, keyword: str) -> list[ConceptNode]:
        """Search for nodes whose name or description contains a keyword.

        The search is case-insensitive and matches substrings, so
        ``"isomorphism"`` matches a node named "Group Isomorphism" and
        ``"同构"`` matches a node whose description mentions "同构".

        Args:
            keyword: The search term (matched against ``node.name`` and
                ``node.description``, case-insensitively).

        Returns:
            A list of matching ``ConceptNode`` objects (possibly empty).
        """
        kw = keyword.lower()
        return [
            node for node in self._nodes.values()
            if kw in node.name.lower()
            or kw in node.description.lower()
        ]

    def get_node_count(self) -> int:
        return len(self._nodes)

    def get_curriculum_summary(self) -> dict:
        """Return a summary of the curriculum for visualization."""
        return {
            "level": self.level,
            "label": CURRICULUM_LABELS.get(self.level, self.level),
            "total_concepts": len(self._nodes),
            "milestones": len(self.get_milestone_nodes()),
            "max_abstraction_level": max((n.abstraction_level for n in self._nodes.values()), default=0),
            "total_estimated_minutes": sum(n.estimated_minutes for n in self._nodes.values()),
            "domains": sorted(set(n.domain for n in self._nodes.values())),
        }

    def get_level(self) -> str:
        """Return the curriculum level of this DAG."""
        return self.level


# ---------------------------------------------------------------------------
# Multi-level singleton management
# ---------------------------------------------------------------------------

# Each curriculum level gets its own singleton DAG.
_dags: dict[str, ConceptDAG] = {}

# The "default" level for backward compatibility.
# Existing code calls get_dag() without arguments → uses this level.
DEFAULT_LEVEL = "group_theory"


def get_dag(level: str | None = None) -> ConceptDAG:
    """Get the singleton DAG for a curriculum level.

    Args:
        level: Curriculum level. If None, uses the default level
               (group_theory for backward compatibility).

    Returns:
        The ConceptDAG singleton for the requested level.
    """
    lvl = level or DEFAULT_LEVEL
    if lvl not in _dags:
        _dags[lvl] = ConceptDAG(level=lvl)
    return _dags[lvl]


def reset_dag(level: str | None = None) -> None:
    """Reset the singleton DAG(s).

    Args:
        level: If specified, only reset that level's DAG.
               If None, reset all cached DAGs.
    """
    global _dags
    if level is not None:
        _dags.pop(level, None)
    else:
        _dags.clear()


def set_default_level(level: str) -> None:
    """Change the default curriculum level.

    After calling this, get_dag() without arguments returns
    the DAG for the new default level.
    """
    global DEFAULT_LEVEL
    if level not in CURRICULUM_LEVELS:
        raise ValueError(
            f"Unknown curriculum level: {level}. "
            f"Available: {CURRICULUM_LEVELS}"
        )
    DEFAULT_LEVEL = level
    logger.info("Default curriculum level set to: %s", level)
