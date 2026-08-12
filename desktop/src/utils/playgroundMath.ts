/**
 * playgroundMath — 学生游戏场的纯数学工具函数。
 *
 * 这些函数从 StudentPlayground 的三个子组件（Bump / Match / Color）中
 * 提取而来，原逻辑在三个组件中重复实现。集中到纯函数模块后可以：
 *   1. 消除三处重复代码（单位元查找、配对键、逆元映射、对称性检测）；
 *   2. 用单元测试直接覆盖表结构运算的边界条件，无需依赖组件渲染。
 *
 * 所有函数都是纯的（不依赖 React / DOM / 音效），便于确定性测试。
 */

/**
 * 在执行运算表上查找单位元 e。
 *
 * 单位元满足 e∗a = a 对所有 a 成立（在本实现中检查行首/列首）。
 * 返回 -1 表示未找到单位元。
 *
 * @param table 二维运算表，table[a][b] 表示 a∗b 的结果
 * @param size  阶数（元素个数）
 */
export function findIdentity(table: number[][], size: number): number {
  for (let e = 0; e < size; e++) {
    let ok = true
    for (let j = 0; j < size; j++) {
      if (table[e]?.[j] !== j) {
        ok = false
        break
      }
    }
    if (ok) return e
  }
  return -1
}

/**
 * 越界安全地执行查询 a∗b。
 *
 * 返回 null 表示结果缺失或越界（即表未闭合或索引非法）。
 *
 * @param table 二维运算表
 * @param size  阶数
 * @param a     左操作数
 * @param b     右操作数
 */
export function lookupValue(table: number[][], size: number, a: number, b: number): number | null {
  const v = table[a]?.[b]
  if (typeof v !== 'number' || v < 0 || v > size - 1) return null
  return v
}

/**
 * 生成无序元素对 (a, b) 的规范键，用于 DAG-free 的记录去重。
 *
 * 交换律检测中 a∗b 与 b∗a 被视为同一"对"，因此键与顺序无关。
 */
export function getPairKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`
}

/**
 * 计算逆元映射：a -> b，其中 a∗b = b∗a = identity。
 *
 * 若未找到单位元，返回空 Map。每个元素只保留第一个满足条件的搭档。
 * 注意：对于自逆元（a∗a = e），映射 a -> a。
 *
 * @param table    二维运算表
 * @param size     阶数
 * @param identity 单位元（可由 findIdentity 得到）
 */
export function getInverseMap(
  table: number[][],
  size: number,
  identity: number,
): Map<number, number> {
  const map = new Map<number, number>()
  if (identity === -1) return map

  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      if (table[a]?.[b] === identity && table[b]?.[a] === identity) {
        map.set(a, b)
        break
      }
    }
  }
  return map
}

/**
 * 判断运算表是否满足交换律（对称性）。
 *
 * 对任意 i < j，要求 table[i][j] === table[j][i]。
 */
export function isTableSymmetric(table: number[][], size: number): boolean {
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      if (table[i]?.[j] !== table[j]?.[i]) return false
    }
  }
  return true
}

/**
 * 判断两个元素是否互为逆元（用于翻牌配对游戏）。
 *
 * helperCt 语义：仅当 inverseMap 中存在 a -> b 的映射时判定成立。
 */
export function areInverses(inverseMap: Map<number, number>, a: number, b: number): boolean {
  return inverseMap.get(a) === b
}
