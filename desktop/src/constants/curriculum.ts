/**
 * Shared curriculum level definitions.
 *
 * Used by both GrillPanel (with a prepended "默认" option) and ProofPanel.
 * Keeping a single source of truth prevents label drift between panels.
 */

export interface CurriculumLevel {
  value: string
  label: string
}

/** Base curriculum levels (without the "默认" placeholder used by GrillPanel). */
export const CURRICULUM_LEVELS: CurriculumLevel[] = [
  { value: 'group_theory', label: '群论（大学）' },
  { value: 'linear_algebra', label: '线性代数（大学）' },
  { value: 'number_theory', label: '数论（大学）' },
  { value: 'discrete_math', label: '离散数学（大学）' },
  { value: 'calculus', label: '积分学（大学）' },
  { value: 'high_school', label: '高中' },
  { value: 'middle_school', label: '初中' },
  { value: 'elementary', label: '小学' },
  { value: 'physics', label: '物理（数学的延伸）' },
  { value: 'chemistry', label: '化学（数学的延伸）' },
]

/**
 * Curriculum levels with a leading "默认（群论）" option.
 * Used by GrillPanel which allows an unspecified default level.
 */
export const CURRICULUM_LEVELS_WITH_DEFAULT: CurriculumLevel[] = [
  { value: '', label: '默认（群论）' },
  ...CURRICULUM_LEVELS,
]
