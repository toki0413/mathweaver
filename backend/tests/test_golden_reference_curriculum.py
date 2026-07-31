"""Golden-reference tests: verify ALL curriculum data across 10 levels.

Extends the group-theory golden tests to cover the FULL teaching content:
  - Concept DAG structural integrity (acyclic, valid prerequisites)
  - Abstraction level consistency (node >= its prerequisites)
  - Difficulty range validation
  - Theorem proof step mathematical correctness

This is the "whole codebase" data audit — not just group theory.
Covers: elementary, middle_school, high_school, calculus, linear_algebra,
discrete_math, number_theory, group_theory, physics, chemistry.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mathweaver.dag.concept_dag import CURRICULUM_LEVELS, DATA_DIR

# ---------------------------------------------------------------------------
# Curriculum loader
# ---------------------------------------------------------------------------

def _load_curriculum(level: str) -> list[dict]:
    path = DATA_DIR / f"{level}_curriculum.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# DAG structural integrity tests
# ---------------------------------------------------------------------------

class TestCurriculumDAGStructure:
    """Verify every curriculum level has a valid DAG structure."""

    @pytest.mark.parametrize("level", CURRICULUM_LEVELS)
    def test_dag_is_acyclic(self, level):
        """No circular prerequisite chains allowed."""
        nodes = _load_curriculum(level)
        node_ids = {n["id"] for n in nodes}
        edges = defaultdict(list)
        in_degree = {n["id"]: 0 for n in nodes}

        for node in nodes:
            for prereq in node.get("prerequisites", []):
                if prereq in node_ids:
                    edges[prereq].append(node["id"])
                    in_degree[node["id"]] += 1

        queue = [nid for nid, deg in in_degree.items() if deg == 0]
        visited = 0
        while queue:
            current = queue.pop(0)
            visited += 1
            for neighbor in edges[current]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        assert visited == len(nodes), (
            f"{level}: DAG has a cycle — only {visited}/{len(nodes)} "
            f"nodes reachable in topological order"
        )

    @pytest.mark.parametrize("level", CURRICULUM_LEVELS)
    def test_all_prerequisites_exist(self, level):
        """Every prerequisite ID must exist as a node."""
        nodes = _load_curriculum(level)
        node_ids = {n["id"] for n in nodes}
        missing = []
        for node in nodes:
            for prereq in node.get("prerequisites", []):
                if prereq not in node_ids:
                    missing.append(f"{node['id']} → missing '{prereq}'")
        assert not missing, f"{level}: dangling prerequisites:\n" + "\n".join(missing)

    @pytest.mark.parametrize("level", CURRICULUM_LEVELS)
    def test_no_duplicate_node_ids(self, level):
        """No duplicate node IDs within a single level."""
        nodes = _load_curriculum(level)
        ids = [n["id"] for n in nodes]
        dupes = [nid for nid in ids if ids.count(nid) > 1]
        assert not dupes, f"{level}: duplicate node IDs: {set(dupes)}"

    @pytest.mark.parametrize("level", CURRICULUM_LEVELS)
    def test_required_fields_present(self, level):
        """Every node must have all required fields."""
        nodes = _load_curriculum(level)
        required = ["id", "name", "description", "prerequisites",
                     "abstraction_level", "domain", "difficulty", "is_milestone"]
        missing = []
        for node in nodes:
            for field in required:
                if field not in node:
                    missing.append(f"{node.get('id', '???')}: missing '{field}'")
        assert not missing, f"{level}: missing fields:\n" + "\n".join(missing)


# ---------------------------------------------------------------------------
# Abstraction level consistency
# ---------------------------------------------------------------------------

class TestAbstractionConsistency:
    """A node's abstraction_level should be >= its prerequisites' levels.

    Rationale: a concept should not be less abstract than the concepts it
    depends on. If this fails, the curriculum has a conceptual ordering error.
    """

    @pytest.mark.parametrize("level", CURRICULUM_LEVELS)
    def test_abstraction_level_not_below_prerequisites(self, level):
        nodes = _load_curriculum(level)
        node_map = {n["id"]: n for n in nodes}
        violations = []
        for node in nodes:
            for prereq_id in node.get("prerequisites", []):
                if prereq_id in node_map:
                    prereq = node_map[prereq_id]
                    if node["abstraction_level"] < prereq["abstraction_level"]:
                        violations.append(
                            f"{node['id']} (level={node['abstraction_level']}) "
                            f"< {prereq_id} (level={prereq['abstraction_level']})"
                        )
        assert not violations, f"{level}: abstraction violations:\n" + "\n".join(violations)


# ---------------------------------------------------------------------------
# Difficulty range validation
# ---------------------------------------------------------------------------

class TestDifficultyRange:
    """difficulty must be a float in [0, 1]."""

    @pytest.mark.parametrize("level", CURRICULUM_LEVELS)
    def test_difficulty_in_valid_range(self, level):
        nodes = _load_curriculum(level)
        for node in nodes:
            d = node.get("difficulty", 0)
            assert isinstance(d, (int, float)), (
                f"{level}/{node['id']}: difficulty is {type(d).__name__}, not number"
            )
            assert 0 <= d <= 1, f"{level}/{node['id']}: difficulty={d} out of [0,1]"


# ---------------------------------------------------------------------------
# Theorem proof step verification
# ---------------------------------------------------------------------------

class TestTheoremProofSteps:
    """Verify that proof templates have mathematically correct steps.

    Each test checks a specific property of a theorem's proof steps,
    such as correct angle labels, correct algebraic identities, etc.
    """

    def _get_all_templates(self):
        """Load all proof templates from the assistant."""
        from mathweaver.proof.assistant import ProofAssistant
        pa = ProofAssistant()
        return pa._templates

    def test_sss_proof_has_correct_isosceles_base_angles(self):
        """SSS proof: isosceles triangle base angles must be at the BASE.

        The original bug: △ABD (AB=DB) had base angles labeled as
        ∠BAD = ∠DAC (wrong — mixes angle from different triangle).
        Correct: ∠BAD = ∠BDA (both at base AD).
        """
        templates = self._get_all_templates()
        sss = templates["congruent_sss"]
        steps = " ".join(sss.expected_steps)

        # The correct base angles for isosceles △ABD (AB=DB) are ∠BAD and ∠BDA
        assert "∠BAD = ∠BDA" in steps, (
            "SSS proof must state ∠BAD = ∠BDA (base angles of isosceles △ABD)"
        )
        # The correct base angles for isosceles △ACD (AC=DC) are ∠CAD and ∠CDA
        assert "∠CAD = ∠CDA" in steps, (
            "SSS proof must state ∠CAD = ∠CDA (base angles of isosceles △ACD)"
        )

    def test_sss_proof_no_nonexistent_angle_labels(self):
        """SSS proof must not reference ∠DAE (point E merges into B)."""
        templates = self._get_all_templates()
        sss = templates["congruent_sss"]
        steps = " ".join(sss.expected_steps)
        assert "∠DAE" not in steps, (
            "SSS proof references ∠DAE but E merges into B after "
            "placing triangles — this angle doesn't exist"
        )

    def test_pythagorean_proof_has_correct_similarity(self):
        """Pythagorean proof: △ACD ∽ △ABC gives b² = pc, not a² = pc."""
        templates = self._get_all_templates()
        pyt = templates["pythagorean_theorem"]
        steps = " ".join(pyt.expected_steps)

        # b² = pc (side AC² = AD × AB) is correct for △ACD ∽ △ABC
        assert "b² = p·c" in steps or "b² = pc" in steps, (
            "Pythagorean proof must derive b² = pc from △ACD ∽ △ABC"
        )
        assert "a² = q·c" in steps or "a² = qc" in steps, (
            "Pythagorean proof must derive a² = qc from △BCD ∽ △ABC"
        )

    def test_cos_double_angle_correct_identity(self):
        """cos2α = cos²α - sin²α = 2cos²α - 1."""
        templates = self._get_all_templates()
        cos2 = templates["cos_double_angle"]
        steps = " ".join(cos2.expected_steps)

        assert "cos²α - sin²α" in steps, (
            "cos double angle must start from cos²α - sin²α"
        )
        assert "2cos²α - 1" in steps, (
            "cos double angle must conclude with 2cos²α - 1"
        )

    def test_quadratic_formula_correct_discriminant(self):
        """x = (-b ± √(b²-4ac)) / 2a — discriminant must be b²-4ac."""
        templates = self._get_all_templates()
        qf = templates["quadratic_formula"]
        steps = " ".join(qf.expected_steps)

        assert "b² - 4ac" in steps or "b²-4ac" in steps, (
            "Quadratic formula must contain discriminant b²-4ac"
        )

    def test_am_gm_uses_correct_construction(self):
        """AM-GM proof: (√a - √b)² ≥ 0 → a + b ≥ 2√(ab)."""
        templates = self._get_all_templates()
        amgm = templates["am_gm_inequality"]
        steps = " ".join(amgm.expected_steps)

        assert "√a" in steps and "√b" in steps, (
            "AM-GM proof must construct (√a - √b)²"
        )

    def test_group_identity_proof_uses_ef(self):
        """Identity uniqueness: e·f = f (e is identity) AND e·f = e (f is identity)."""
        templates = self._get_all_templates()
        idu = templates["identity_unique"]
        steps = " ".join(idu.expected_steps)

        assert "e·f = f" in steps or "e·f = e" in steps, (
            "Identity uniqueness proof must evaluate e·f two ways"
        )

    def test_inverse_unique_proof_chain(self):
        """Inverse uniqueness: b = b·e → b·(a·c) → (b·a)·c → e·c → c."""
        templates = self._get_all_templates()
        inv = templates["inverse_unique"]
        steps = " ".join(inv.expected_steps)

        assert "结合律" in steps, (
            "Inverse uniqueness proof must use associativity"
        )
        assert "b·a" in steps or "b·a" in steps, (
            "Inverse uniqueness proof must reference b·a = e"
        )

    # -------------------------------------------------------------------
    # Calculus proofs
    # -------------------------------------------------------------------

    def test_power_rule_uses_binomial_theorem(self):
        """Power rule: must use binomial expansion of (x+h)^n."""
        templates = self._get_all_templates()
        pr = templates["power_rule"]
        steps = " ".join(pr.expected_steps)

        assert "二项式" in steps or "binomial" in steps.lower(), (
            "Power rule proof must use binomial theorem"
        )
        assert "n·xⁿ⁻¹" in steps, (
            "Power rule must conclude with n·xⁿ⁻¹"
        )

    def test_ftc_uses_mean_value_theorem(self):
        """FTC Part 1: must use the integral mean value theorem."""
        templates = self._get_all_templates()
        ftc = templates["ftc_part1"]
        steps = " ".join(ftc.expected_steps)

        assert "中值定理" in steps or "mean value" in steps.lower(), (
            "FTC Part 1 must use the integral mean value theorem"
        )
        assert "f(c)·h" in steps or "f(c)" in steps, (
            "FTC Part 1 must express integral as f(c)·h"
        )

    def test_chain_rule_introduces_delta_g(self):
        """Chain rule: must introduce Δg as intermediate variable."""
        templates = self._get_all_templates()
        cr = templates["chain_rule"]
        steps = " ".join(cr.expected_steps)

        assert "Δg" in steps or "Δg" in steps, (
            "Chain rule proof must introduce Δg as intermediate variable"
        )
        assert "f'(g(x))" in steps, (
            "Chain rule must conclude with f'(g(x))·g'(x)"
        )

    # -------------------------------------------------------------------
    # Linear Algebra proofs
    # -------------------------------------------------------------------

    def test_rank_nullity_uses_basis_extension(self):
        """Rank-Nullity: must extend ker basis to full V basis."""
        templates = self._get_all_templates()
        rn = templates["rank_nullity"]
        steps = " ".join(rn.expected_steps)

        assert "扩充" in steps, (
            "Rank-Nullity proof must extend ker(T) basis to V basis"
        )
        assert "n - k" in steps or "n-k" in steps, (
            "Rank-Nullity must conclude with rank = n - k"
        )

    def test_dim_invariance_uses_replacement_theorem(self):
        """Dimension invariance: must use Steinitz replacement theorem."""
        templates = self._get_all_templates()
        di = templates["dim_invariance"]
        steps = " ".join(di.expected_steps)

        assert "替换定理" in steps, (
            "Dimension invariance must use the replacement theorem"
        )
        assert "n = m" in steps, (
            "Dimension invariance must conclude n = m"
        )

    # -------------------------------------------------------------------
    # Discrete Math proofs
    # -------------------------------------------------------------------

    def test_handshake_lemma_uses_double_counting(self):
        """Handshake lemma: must use double counting argument."""
        templates = self._get_all_templates()
        hl = templates["handshake_lemma"]
        steps = " ".join(hl.expected_steps)

        assert "2|E|" in steps, (
            "Handshake lemma must conclude with 2|E|"
        )

    def test_tree_edges_uses_induction(self):
        """Tree edges: must use mathematical induction."""
        templates = self._get_all_templates()
        te = templates["tree_n_minus_1_edges"]
        steps = " ".join(te.expected_steps)

        assert "归纳" in steps, (
            "Tree edges proof must use mathematical induction"
        )
        assert "叶子" in steps or "度数为 1" in steps, (
            "Tree edges proof must identify leaf nodes (degree 1)"
        )

    def test_bfs_uses_induction_on_layers(self):
        """BFS correctness: must use induction on BFS layers."""
        templates = self._get_all_templates()
        bfs = templates["bfs_shortest_path"]
        steps = " ".join(bfs.expected_steps)

        assert "归纳" in steps, (
            "BFS correctness proof must use induction"
        )
        assert "δ(v)" in steps or "最短" in steps, (
            "BFS proof must reference shortest path distance"
        )

    # -------------------------------------------------------------------
    # Number Theory proofs
    # -------------------------------------------------------------------

    def test_euclid_primes_uses_contradiction(self):
        """Euclid's infinite primes: must use proof by contradiction."""
        templates = self._get_all_templates()
        ep = templates["euclid_infinite_primes"]
        steps = " ".join(ep.expected_steps)

        assert "p₁ × p₂" in steps or "p₁×p₂" in steps, (
            "Euclid's proof must construct N = product + 1"
        )
        assert "矛盾" in steps, (
            "Euclid's proof must reach a contradiction"
        )

    def test_euclid_lemma_uses_bezout(self):
        """Euclid's lemma: must use Bezout's identity."""
        templates = self._get_all_templates()
        el = templates["euclid_lemma"]
        steps = " ".join(el.expected_steps)

        assert "Bezout" in steps or "bezout" in steps.lower(), (
            "Euclid's lemma must use Bezout's theorem"
        )
        assert "px + ay = 1" in steps, (
            "Euclid's lemma must use the Bezout identity px + ay = 1"
        )

    def test_fermat_little_uses_permutation(self):
        """Fermat's little theorem: must use permutation argument."""
        templates = self._get_all_templates()
        flt = templates["fermat_little_theorem"]
        steps = " ".join(flt.expected_steps)

        assert "排列" in steps or "permutation" in steps.lower(), (
            "Fermat's little theorem must use permutation argument"
        )
        assert "a^{p-1}" in steps or "a^(p-1)" in steps, (
            "Fermat's little theorem must reference a^{p-1}"
        )

    # -------------------------------------------------------------------
    # Physics proofs (math applied to nature)
    # -------------------------------------------------------------------

    def test_kinematic_equations_from_ode(self):
        """Kinematic equations: must derive from differential equations."""
        templates = self._get_all_templates()
        ke = templates["kinematic_equations"]
        steps = " ".join(ke.expected_steps)

        assert "dv/dt" in steps, (
            "Kinematic equations must start from a = dv/dt"
        )
        assert "v₀ + at" in steps, (
            "Kinematic equations must derive v(t) = v₀ + at"
        )
        assert "½at²" in steps, (
            "Kinematic equations must derive x(t) with ½at² term"
        )

    def test_work_energy_uses_chain_rule(self):
        """Work-energy theorem: must use chain rule dv/dt = v·dv/dx."""
        templates = self._get_all_templates()
        we = templates["work_energy_theorem"]
        steps = " ".join(we.expected_steps)

        assert "链式法则" in steps or "chain rule" in steps.lower(), (
            "Work-energy theorem must use chain rule"
        )
        assert "½mv₂²" in steps or "½mv" in steps, (
            "Work-energy theorem must conclude with kinetic energy expression"
        )

    def test_shm_uses_characteristic_equation(self):
        """SHM: must solve via characteristic equation of ODE."""
        templates = self._get_all_templates()
        shm = templates["shm_equation"]
        steps = " ".join(shm.expected_steps)

        assert "特征方程" in steps, (
            "SHM proof must use characteristic equation"
        )
        assert "√(k/m)" in steps or "√(m/k)" in steps, (
            "SHM proof must reference angular frequency √(k/m)"
        )

    # -------------------------------------------------------------------
    # Chemistry proofs (math applied to molecules)
    # -------------------------------------------------------------------

    def test_half_life_concentration_independence(self):
        """First-order half-life: must show C₀ cancels out."""
        templates = self._get_all_templates()
        hl = templates["half_life_first_order"]
        steps = " ".join(hl.expected_steps)

        assert "分离变量" in steps, (
            "Half-life proof must use separation of variables"
        )
        assert "ln2/k" in steps, (
            "Half-life proof must conclude with t₁/₂ = ln2/k"
        )
        assert "C₀" in steps and "消去" in steps, (
            "Half-life proof must show C₀ being cancelled"
        )

    def test_equilibrium_constant_uses_arrhenius(self):
        """Equilibrium constant: must connect Arrhenius equation to ΔG°."""
        templates = self._get_all_templates()
        ec = templates["equilibrium_constant"]
        steps = " ".join(ec.expected_steps)

        assert "Arrhenius" in steps, (
            "Equilibrium constant proof must use Arrhenius equation"
        )
        assert "e^(-ΔG°/RT)" in steps, (
            "Equilibrium constant must conclude with K = e^(-ΔG°/RT)"
        )

    def test_huckel_benzene_uses_circulant_matrix(self):
        """Hückel benzene: must use circulant matrix / DFT for eigenvalues."""
        templates = self._get_all_templates()
        hb = templates["huckel_benzene"]
        steps = " ".join(hb.expected_steps)

        assert "循环矩阵" in steps or "DFT" in steps, (
            "Hückel benzene proof must use circulant matrix / DFT"
        )
        assert "α + 2β" in steps, (
            "Hückel benzene must give lowest energy level α + 2β"
        )
        assert "简并" in steps, (
            "Hückel benzene proof must mention degeneracy"
        )

    # -------------------------------------------------------------------
    # Cross-domain: verify all new templates load correctly
    # -------------------------------------------------------------------

    def test_all_new_theorems_exist(self):
        """All new theorem templates must be registered."""
        templates = self._get_all_templates()
        expected_new = [
            # Calculus
            "power_rule", "ftc_part1", "chain_rule",
            # Linear algebra
            "rank_nullity", "dim_invariance", "independence_implies_unique",
            # Discrete math
            "handshake_lemma", "tree_n_minus_1_edges", "bfs_shortest_path",
            # Number theory
            "euclid_infinite_primes", "euclid_lemma", "fermat_little_theorem",
            # Physics
            "kinematic_equations", "work_energy_theorem", "shm_equation",
            # Chemistry
            "half_life_first_order", "equilibrium_constant", "huckel_benzene",
        ]
        missing = [t for t in expected_new if t not in templates]
        assert not missing, f"Missing theorem templates: {missing}"

    def test_get_theorems_by_level_covers_all_levels(self):
        """get_theorems_by_level must return theorems for every curriculum level."""
        from mathweaver.proof.assistant import ProofAssistant
        pa = ProofAssistant()
        for level in CURRICULUM_LEVELS:
            theorems = pa.get_theorems_by_level(level)
            assert len(theorems) > 0, (
                f"Level '{level}' has no theorems in get_theorems_by_level"
            )
