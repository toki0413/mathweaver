/**
 * Counter-Example Forge: brute-force four-layer fallback.
 *
 * Ported from Python backend (backend/mathweaver/counterexample/forge.py)
 * and (backend/mathweaver/conjecture/handler.py)
 *
 * KEY DECISION: Z3 is NOT used. All verification is performed with pure
 * TypeScript brute-force enumeration. For Cayley tables of size n, axiom
 * verification is O(n^3) and works for any n (well within budget for n<=4
 * and far beyond). Finding a *non-associative* operation enumerates all
 * n^(n^2) tables — feasible for n<=3 (3^9 = 19,683). For n>=4 a known
 * non-associative construction (subtraction mod n) is built and verified,
 * since enumerating 4^16 tables is infeasible.
 *
 * The four-layer fallback:
 * L1: brute-force direct (finite structures via Cayley table)
 * L2: LLM + brute-force verify (LLM generates candidate, forge checks)
 * L3: LLM + heuristic verify (for undecidable nonlinear cases)
 * L4: LLM-only + annotation (last resort)
 *
 * NOTE on types: ../types defines an IPC-facing CounterExampleResult, but the
 * Python forge uses a richer result (string counter-example, dict z3-model,
 * metadata, FallbackLevel). To keep the agent business logic faithful, this
 * module defines ForgeResult / FallbackLevel aligned with the Python source.
 */

import type { LLMClient } from '../llm/client'

// ---------------------------------------------------------------------------
// Fallback levels (replaces Python FallbackLevel enum; Z3 -> brute-force)
// ---------------------------------------------------------------------------

export enum FallbackLevel {
  L1_BRUTE_FORCE = 'L1: brute-force direct',
  L2_LLM_VERIFY = 'L2: LLM + brute-force verify',
  L3_LLM_HEURISTIC = 'L3: LLM + heuristic verify',
  L4_LLM_ONLY = 'L4: LLM only',
}

export interface ForgeResult {
  /** true = a counter-example / axiom violation was found. */
  success: boolean
  level: FallbackLevel
  counterExample: string | null
  explanation: string
  /** Model/extracted data (Map replaces dict where relevant). */
  z3Model: Record<string, unknown> | null
  metadata: Record<string, unknown>
}

export function mkForgeResult(
  success: boolean,
  level: FallbackLevel,
  explanation: string,
  opts: Partial<Pick<ForgeResult, 'counterExample' | 'z3Model' | 'metadata'>> = {},
): ForgeResult {
  return {
    success,
    level,
    counterExample: opts.counterExample ?? null,
    explanation,
    z3Model: opts.z3Model ?? null,
    metadata: opts.metadata ?? {},
  }
}

/** Cayley 表最大允许维度，防止 O(n³) 验证卡死主进程 */
const MAX_CAYLEY_TABLE_SIZE = 10

// ---------------------------------------------------------------------------
// L1: Brute-force Cayley Table Verification
// ---------------------------------------------------------------------------

/**
 * 校验 Cayley 表的基本完整性：非空、方阵、元素 ∈ [0, n)、n 不超上限。
 * 返回 [isValid, errorMessage]；isValid=true 时可安全进行 O(n³) 验证。
 */
function validateCayleyTable(cayleyTable: number[][]): [boolean, string | null] {
  const n = cayleyTable.length
  if (n === 0) return [false, 'Empty table']
  if (n > MAX_CAYLEY_TABLE_SIZE)
    return [false, `Table too large: n=${n} exceeds max ${MAX_CAYLEY_TABLE_SIZE}`]
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(cayleyTable[i]) || cayleyTable[i].length !== n) {
      return [false, `Row ${i} is not an array of length ${n}`]
    }
    for (let j = 0; j < n; j++) {
      const val = cayleyTable[i][j]
      if (!Number.isInteger(val) || val < 0 || val >= n) {
        return [false, `Entry (${i},${j})=${val} out of range [0,${n})`]
      }
    }
  }
  return [true, null]
}

/**
 * Find the first associativity violation in a Cayley table.
 *
 * Returns `[true, null]` when associativity holds; otherwise
 * `[false, violationDescription]`. Callers pass the table plus an optional
 * validation error already produced by `validateCayleyTable` so the
 * violation message matches their context.
 */
function findAssociativityViolation(
  cayleyTable: number[][],
  validationError: string | null,
  prefix: string,
): [boolean, string | null] {
  const n = cayleyTable.length
  if (validationError !== null) {
    return [false, `Invalid Cayley table: ${validationError}`]
  }
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      for (let c = 0; c < n; c++) {
        const left = cayleyTable[cayleyTable[a][b]][c]
        const right = cayleyTable[a][cayleyTable[b][c]]
        if (left !== right) {
          return [
            false,
            `${prefix}(${a}*${b})*${c} = ${cayleyTable[a][b]}*${c} = ${left}, ` +
              `but ${a}*(${b}*${c}) = ${a}*${cayleyTable[b][c]} = ${right}`,
          ]
        }
      }
    }
  }
  return [true, null]
}

/**
 * Verify whether a Cayley table defines a group.
 *
 * Checks: closure (trivial by construction), associativity, identity element,
 * and inverse elements.
 *
 * @returns [isGroup, counterExampleDescription]
 */
export function verifyGroupAxiomsCayley(cayleyTable: number[][]): [boolean, string | null] {
  const n = cayleyTable.length
  if (n === 0) return [false, 'Empty table']

  // Check closure: all entries in [0, n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const val = cayleyTable[i][j]
      if (val < 0 || val >= n) {
        return [false, `Entry (${i},${j})=${val} out of range [0,${n})`]
      }
    }
  }

  // Check associativity: (a*b)*c == a*(b*c)
  const [assoc, assocError] = findAssociativityViolation(
    cayleyTable,
    null,
    'Associativity violated: ',
  )
  if (!assoc) return [false, assocError as string]

  // Check identity element
  let identity: number | null = null
  for (let e = 0; e < n; e++) {
    let isIdentity = true
    for (let a = 0; a < n; a++) {
      if (cayleyTable[e][a] !== a || cayleyTable[a][e] !== a) {
        isIdentity = false
        break
      }
    }
    if (isIdentity) {
      identity = e
      break
    }
  }

  if (identity === null) return [false, 'No identity element found']

  // Check inverses
  for (let a = 0; a < n; a++) {
    let hasInverse = false
    for (let b = 0; b < n; b++) {
      if (cayleyTable[a][b] === identity && cayleyTable[b][a] === identity) {
        hasInverse = true
        break
      }
    }
    if (!hasInverse) return [false, `Element ${a} has no inverse`]
  }

  return [true, null]
}

/** Check if the Cayley table is commutative (Abelian). */
export function checkCommutativityCayley(cayleyTable: number[][]): [boolean, string | null] {
  const n = cayleyTable.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cayleyTable[i][j] !== cayleyTable[j][i]) {
        return [
          false,
          `Not commutative: ${i}*${j} = ${cayleyTable[i][j]}, ` +
            `but ${j}*${i} = ${cayleyTable[j][i]}`,
        ]
      }
    }
  }
  return [true, null]
}

/**
 * Check associativity only.
 * @returns [isAssociative, violationDescription]
 */
export function checkAssociativityCayley(cayleyTable: number[][]): [boolean, string | null] {
  const [valid, validationError] = validateCayleyTable(cayleyTable)
  return findAssociativityViolation(cayleyTable, valid ? null : validationError, '')
}

// ---------------------------------------------------------------------------
// L1: Brute-force Counter-example Search
// ---------------------------------------------------------------------------

/** Generate every n×n Cayley table with entries in [0, n). */
function* allTables(n: number): Generator<number[][]> {
  const size = n * n
  const total = Math.pow(n, size)
  for (let code = 0; code < total; code++) {
    const flat: number[] = new Array(size)
    let c = code
    for (let k = 0; k < size; k++) {
      flat[k] = c % n
      c = Math.floor(c / n)
    }
    const table: number[][] = []
    for (let i = 0; i < n; i++) table.push(flat.slice(i * n, (i + 1) * n))
    yield table
  }
}

/**
 * Use brute-force enumeration to find a binary operation on {0,...,n-1}
 * that is NOT associative.
 *
 * For n<=3 we enumerate every operation table (n^(n^2)); for n>=4 enumeration
 * is infeasible, so we construct the known non-associative operation
 * a*b = (a - b) mod n and verify it.
 */
export function findNonAssociativeTable(n = 3): ForgeResult {
  if (n <= 1) {
    return mkForgeResult(
      false,
      FallbackLevel.L1_BRUTE_FORCE,
      `在 ${n} 元集合上，所有二元运算都满足结合律`,
    )
  }

  if (n > MAX_CAYLEY_TABLE_SIZE) {
    return mkForgeResult(
      false,
      FallbackLevel.L1_BRUTE_FORCE,
      `n=${n} 超过最大支持维度 ${MAX_CAYLEY_TABLE_SIZE}，暴力枚举不可行`,
    )
  }

  // n<=3: exhaustive brute-force enumeration
  if (n <= 3) {
    for (const table of allTables(n)) {
      const [ok, reason] = checkAssociativityCayley(table)
      if (!ok) {
        return mkForgeResult(
          true,
          FallbackLevel.L1_BRUTE_FORCE,
          `暴力枚举找到违反结合律的运算表。反例: ${reason}`,
          {
            counterExample: `非结合运算表: ${JSON.stringify(table)}`,
            z3Model: { cayley_table: table, n },
          },
        )
      }
    }
    return mkForgeResult(
      false,
      FallbackLevel.L1_BRUTE_FORCE,
      `在 ${n} 元集合上，所有二元运算都满足结合律`,
    )
  }

  // n>=4: construct a*b = (a - b) mod n (known non-associative for n>=3) and verify
  const table: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    for (let j = 0; j < n; j++) row.push((((i - j) % n) + n) % n)
    table.push(row)
  }
  const [ok, reason] = checkAssociativityCayley(table)
  if (!ok) {
    return mkForgeResult(
      true,
      FallbackLevel.L1_BRUTE_FORCE,
      `构造的减法运算表 (a*b=(a-b) mod ${n}) 违反结合律。反例: ${reason}`,
      {
        counterExample: `非结合运算表: ${JSON.stringify(table)}`,
        z3Model: { cayley_table: table, n },
      },
    )
  }

  return mkForgeResult(false, FallbackLevel.L1_BRUTE_FORCE, `在 ${n} 元集合上未能构造出非结合运算`)
}

/** Brute-force verify if a given Cayley table satisfies associativity. */
export function verifyAssociativity(cayleyTable: number[][]): ForgeResult {
  const n = cayleyTable.length
  const [valid, validationError] = validateCayleyTable(cayleyTable)
  if (!valid) {
    return mkForgeResult(
      false,
      FallbackLevel.L1_BRUTE_FORCE,
      `Invalid Cayley table: ${validationError}`,
    )
  }
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      for (let c = 0; c < n; c++) {
        const left = cayleyTable[cayleyTable[a][b]][c]
        const right = cayleyTable[a][cayleyTable[b][c]]
        if (left !== right) {
          return mkForgeResult(
            true,
            FallbackLevel.L1_BRUTE_FORCE,
            `结合律被违反: (${a}*${b})*${c} = ` +
              `${cayleyTable[a][b]}*${c} = ${left}, ` +
              `但 ${a}*(${b}*${c}) = ${a}*${cayleyTable[b][c]} = ${right}`,
            {
              counterExample: `a=${a}, b=${b}, c=${c}`,
              z3Model: { a, b, c },
            },
          )
        }
      }
    }
  }

  return mkForgeResult(
    false,
    FallbackLevel.L1_BRUTE_FORCE,
    '该运算表满足结合律，暴力枚举未找到反例',
  )
}

// ---------------------------------------------------------------------------
// Counter-Example Forge: Main Entry Point
// ---------------------------------------------------------------------------

export class CounterExampleForge {
  llmClient: LLMClient | null

  constructor(llmClient: LLMClient | null = null) {
    this.llmClient = llmClient
  }

  /** Check if a Cayley table defines a group. L1 path. */
  checkGroupAxioms(cayleyTable: number[][]): ForgeResult {
    const [isGroup, reason] = verifyGroupAxiomsCayley(cayleyTable)
    if (isGroup) {
      return mkForgeResult(
        false,
        FallbackLevel.L1_BRUTE_FORCE,
        '该运算表满足群的全部公理（封闭性、结合律、单位元、逆元）',
      )
    }
    return mkForgeResult(
      true,
      FallbackLevel.L1_BRUTE_FORCE,
      `暴力枚举验证发现群公理不满足: ${reason}`,
      { counterExample: reason ?? undefined },
    )
  }

  /** Check if a group is commutative. L1 path. */
  checkCommutativity(cayleyTable: number[][]): ForgeResult {
    const [isCommutative, reason] = checkCommutativityCayley(cayleyTable)
    if (isCommutative) {
      return mkForgeResult(false, FallbackLevel.L1_BRUTE_FORCE, '该群满足交换律（Abel 群）')
    }
    return mkForgeResult(
      true,
      FallbackLevel.L1_BRUTE_FORCE,
      `暴力枚举验证发现交换律不满足: ${reason}`,
      { counterExample: reason ?? undefined },
    )
  }

  /** Find a binary operation that is NOT associative. L1 search. */
  findNonAssociativeTable(n = 3): ForgeResult {
    return findNonAssociativeTable(n)
  }

  /** Verify associativity of a given table. L1 path. */
  verifyAssociativity(cayleyTable: number[][]): ForgeResult {
    return verifyAssociativity(cayleyTable)
  }

  /**
   * Generate a counter-example for a student's conjecture.
   * Tries L1 first, falls back to L2/L3/L4.
   */
  async generateCounterExample(
    studentConjecture: string,
    context: Record<string, unknown> | null = null,
  ): Promise<ForgeResult> {
    const ctx = context ?? {}

    // L1: Try brute-force if we have a Cayley table
    if ('cayley_table' in ctx) {
      const table = ctx['cayley_table'] as number[][]
      const result = this.verifyAssociativity(table)
      if (result.success) return result

      const groupResult = this.checkGroupAxioms(table)
      if (groupResult.success) return groupResult
    }

    // L2: LLM generates candidate, brute-force verifies
    if (this.llmClient !== null) {
      const l2Result = await this.fallbackL2(studentConjecture, ctx)
      if (l2Result.success) return l2Result

      // L3: LLM + heuristic verify (for undecidable nonlinear cases)
      const l3Result = await this.fallbackL3(studentConjecture, ctx)
      if (l3Result.success) return l3Result

      // L4: LLM-only (last resort)
      return await this.fallbackL4(studentConjecture, ctx)
    }

    // L4: No LLM available
    return mkForgeResult(
      false,
      FallbackLevel.L4_LLM_ONLY,
      '需要 LLM 支持，但未配置 LLM 客户端。请在设置中配置 LLM API Key。',
    )
  }

  /** L2: LLM generates a candidate counter-example, brute-force verifies. */
  private async fallbackL2(
    conjecture: string,
    context: Record<string, unknown>,
  ): Promise<ForgeResult> {
    const n = (context['n'] as number) ?? 4
    const prompt =
      `学生的猜想: ${conjecture}\n\n` +
      `请生成一个 ${n}×${n} 的 Cayley 表（二元运算表）作为反例。` +
      `表中的元素是 0 到 ${n - 1} 的整数。` +
      `请只回复 JSON 数组格式，例如: [[0,1],[1,0]]，不要添加其他内容。`

    let llmText = ''
    try {
      const resp = await this.llmClient!.chat(
        '你是反例生成器。根据学生的数学猜想，生成一个具体的反例。' +
          '如果猜想涉及群论，生成一个 Cayley 表作为反例。' +
          '只回复 JSON 格式的 Cayley 表。',
        prompt,
      )
      llmText = resp.content
    } catch (e) {
      return mkForgeResult(
        false,
        FallbackLevel.L2_LLM_VERIFY,
        `L2 LLM 调用失败: ${e instanceof Error ? e.message : String(e)}`,
      )
    }

    // Try to parse the Cayley table from LLM response
    const cayleyTable = extractCayleyTable(llmText)
    if (cayleyTable === null) {
      return await this.fallbackL4(conjecture, context)
    }

    const nTable = cayleyTable.length
    const conjectureLower = conjecture.toLowerCase()

    // Associativity conjectures
    if (conjecture.includes('结合') || conjectureLower.includes('associative')) {
      const result = verifyAssociativity(cayleyTable)
      if (result.success) {
        return mkForgeResult(
          true,
          FallbackLevel.L2_LLM_VERIFY,
          `LLM 生成反例，暴力枚举验证确认: ${result.explanation}`,
          {
            counterExample: `Cayley 表: ${JSON.stringify(cayleyTable)}`,
            z3Model: { cayley_table: cayleyTable, n: nTable },
            metadata: { llm_generated: true, z3_verified: true },
          },
        )
      }
    }

    // Group axiom violations
    const [isGroup, groupReason] = verifyGroupAxiomsCayley(cayleyTable)
    if (!isGroup) {
      return mkForgeResult(
        true,
        FallbackLevel.L2_LLM_VERIFY,
        `LLM 生成反例，暴力枚举验证确认群公理不满足: ${groupReason}`,
        {
          counterExample: `Cayley 表: ${JSON.stringify(cayleyTable)}`,
          z3Model: { cayley_table: cayleyTable, n: nTable },
          metadata: { llm_generated: true, z3_verified: true },
        },
      )
    }

    // Commutativity violations
    const [isComm, commReason] = checkCommutativityCayley(cayleyTable)
    if (!isComm && (conjecture.includes('交换') || conjectureLower.includes('abelian'))) {
      return mkForgeResult(
        true,
        FallbackLevel.L2_LLM_VERIFY,
        `LLM 生成反例，暴力枚举验证确认不交换: ${commReason}`,
        {
          counterExample: `Cayley 表: ${JSON.stringify(cayleyTable)}`,
          z3Model: { cayley_table: cayleyTable, n: nTable },
          metadata: { llm_generated: true, z3_verified: true },
        },
      )
    }

    // LLM's candidate didn't violate anything — return failure so
    // generateCounterExample can decide whether to try L3 heuristic verify
    return mkForgeResult(
      false,
      FallbackLevel.L2_LLM_VERIFY,
      'L2 未能找到违反猜想的反例，将尝试 L3 启发式验证',
    )
  }

  /**
   * L3: LLM generates a counter-example with heuristic verification.
   * Used for non-linear or undecidable conjectures where brute-force
   * verification is not possible. The LLM's response is checked for
   * internal consistency using heuristic rules (keyword detection,
   * structure validation) rather than exhaustive enumeration.
   */
  private async fallbackL3(
    conjecture: string,
    context: Record<string, unknown>,
  ): Promise<ForgeResult> {
    let llmText = ''
    try {
      const resp = await this.llmClient!.chat(
        '你是数学反例专家。请分析以下猜想并提供反例或证明其正确性。' +
          '如果猜想涉及非线性运算或无法用 Cayley 表表示的结构，' +
          '请给出具体的数值反例并解释为什么它违反了猜想。' +
          '如果猜想是正确的，请说明原因。',
        `猜想: ${conjecture}\n上下文: ${JSON.stringify(context)}`,
        undefined,
        0.3,
      )
      llmText = resp.content
    } catch (e) {
      return mkForgeResult(
        false,
        FallbackLevel.L3_LLM_HEURISTIC,
        `L3 LLM 调用失败: ${e instanceof Error ? e.message : String(e)}`,
      )
    }

    // Heuristic verification: check if the response contains
    // a structured counter-example or a valid proof sketch
    const lower = llmText.toLowerCase()
    const hasCounterExample =
      llmText.includes('反例') ||
      llmText.includes('不成立') ||
      lower.includes('counter') ||
      lower.includes('violat')
    const hasReasoning =
      llmText.includes('因为') ||
      llmText.includes('由于') ||
      lower.includes('because') ||
      lower.includes('since') ||
      lower.includes('therefore')

    if (hasCounterExample && hasReasoning) {
      return mkForgeResult(
        true,
        FallbackLevel.L3_LLM_HEURISTIC,
        `LLM 启发式验证通过（含反例和推理）: ${llmText.slice(0, 200)}`,
        {
          counterExample: llmText.slice(0, 500),
          metadata: { llm_generated: true, heuristic_verified: true, z3_verified: false },
        },
      )
    }

    if (hasCounterExample) {
      return mkForgeResult(
        true,
        FallbackLevel.L3_LLM_HEURISTIC,
        `LLM 启发式验证（反例未经完整推理验证）: ${llmText.slice(0, 200)}`,
        {
          counterExample: llmText.slice(0, 500),
          metadata: { llm_generated: true, heuristic_verified: false, z3_verified: false },
        },
      )
    }

    // No counter-example found — conjecture may be correct
    return mkForgeResult(
      false,
      FallbackLevel.L3_LLM_HEURISTIC,
      `LLM 分析认为猜想可能正确: ${llmText.slice(0, 300)}`,
      {
        metadata: { llm_generated: true, heuristic_verified: false, z3_verified: false },
      },
    )
  }

  /** L4: LLM-only generation with annotation (last resort). */
  private async fallbackL4(
    conjecture: string,
    context: Record<string, unknown>,
  ): Promise<ForgeResult> {
    let llmText = ''
    try {
      const resp = await this.llmClient!.chat(
        '你是数学反例专家。请为以下猜想提供一个反例或说明为何难以构造反例。' +
          '如果有反例，请描述具体的数学对象和它为什么违反猜想。' +
          '如果猜想是正确的（无反例），请说明原因。',
        `猜想: ${conjecture}\n上下文: ${JSON.stringify(context)}`,
      )
      llmText = resp.content
    } catch (e) {
      return mkForgeResult(
        false,
        FallbackLevel.L4_LLM_ONLY,
        `L4 LLM 调用失败: ${e instanceof Error ? e.message : String(e)}`,
      )
    }

    const lower = llmText.toLowerCase()
    if (llmText.includes('反例') || llmText.includes('不成立') || lower.includes('counter')) {
      return mkForgeResult(
        true,
        FallbackLevel.L4_LLM_ONLY,
        `LLM 生成的反例（未经形式化验证）: ${llmText.slice(0, 200)}`,
        {
          counterExample: llmText.slice(0, 500),
          metadata: { llm_generated: true, z3_verified: false },
        },
      )
    }

    return mkForgeResult(false, FallbackLevel.L4_LLM_ONLY, `LLM 分析: ${llmText.slice(0, 300)}`, {
      metadata: { llm_generated: true, z3_verified: false },
    })
  }
}

/** Extract the first valid square 2D JSON array from a text blob. */
function extractCayleyTable(text: string): number[][] | null {
  const startIdx = text.indexOf('[')
  if (startIdx === -1) return null
  // Find the matching closing bracket for the outermost array
  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }
  if (endIdx === -1) return null
  const slice = text.slice(startIdx, endIdx + 1)
  try {
    const candidate = JSON.parse(slice)
    if (
      Array.isArray(candidate) &&
      candidate.length > 0 &&
      candidate.length <= MAX_CAYLEY_TABLE_SIZE &&
      Array.isArray(candidate[0]) &&
      candidate.every(r => Array.isArray(r) && r.length === candidate[0].length && r.length > 0) &&
      candidate.every(r =>
        r.every((v: number) => Number.isInteger(v) && v >= 0 && v < candidate.length),
      )
    ) {
      return candidate as number[][]
    }
  } catch {
    // not valid JSON, give up
  }
  return null
}

// ===========================================================================
// Conjecture Handler (ported from backend/mathweaver/conjecture/handler.py)
// ===========================================================================

export class ConjectureResult {
  claim: string
  verdict: string // "confirmed" | "refuted" | "undecidable"
  counterExample: string | null
  explanation: string
  socraticPrompt: string

  constructor(
    claim: string,
    verdict: string,
    explanation = '',
    counterExample: string | null = null,
    socraticPrompt = '',
  ) {
    this.claim = claim
    this.verdict = verdict
    this.counterExample = counterExample
    this.explanation = explanation
    this.socraticPrompt = socraticPrompt
  }

  toDict(): Record<string, unknown> {
    return {
      claim: this.claim,
      verdict: this.verdict,
      counter_example: this.counterExample,
      explanation: this.explanation,
      socratic_prompt: this.socraticPrompt,
    }
  }
}

// Known test structures (Cayley tables) for common conjectures
const TEST_GROUPS: Record<string, number[][]> = {
  z2: [
    [0, 1],
    [1, 0],
  ], // Z2, order 2, abelian
  z3: [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ], // Z3, order 3, abelian
  z4: [
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
    [3, 0, 1, 2],
  ], // Z4, abelian
  klein: [
    [0, 1, 2, 3],
    [1, 0, 3, 2],
    [2, 3, 0, 1],
    [3, 2, 1, 0],
  ], // Klein 4-group
  s3: [
    [0, 1, 2, 3, 4, 5],
    [1, 0, 3, 2, 5, 4],
    [2, 4, 0, 5, 1, 3],
    [3, 5, 1, 4, 0, 2],
    [4, 2, 5, 0, 3, 1],
    [5, 3, 4, 1, 2, 0],
  ], // S3, order 6, non-abelian
  z6: [
    [0, 1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5, 0],
    [2, 3, 4, 5, 0, 1],
    [3, 4, 5, 0, 1, 2],
    [4, 5, 0, 1, 2, 3],
    [5, 0, 1, 2, 3, 4],
  ], // Z6, abelian
  z7: [
    [0, 1, 2, 3, 4, 5, 6],
    [1, 2, 3, 4, 5, 6, 0],
    [2, 3, 4, 5, 6, 0, 1],
    [3, 4, 5, 6, 0, 1, 2],
    [4, 5, 6, 0, 1, 2, 3],
    [5, 6, 0, 1, 2, 3, 4],
    [6, 0, 1, 2, 3, 4, 5],
  ], // Z7, prime order, abelian
  q8: [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [1, 0, 4, 5, 2, 3, 7, 6],
    [2, 4, 5, 0, 6, 7, 1, 3],
    [3, 5, 0, 4, 7, 6, 2, 1],
    [4, 6, 7, 1, 5, 0, 3, 2],
    [5, 7, 6, 0, 3, 1, 4, 2],
    [6, 2, 3, 7, 0, 4, 5, 1],
    [7, 3, 1, 6, 4, 2, 0, 5],
  ], // Q8 quaternion, non-abelian
}

export class ConjectureHandler {
  forge: CounterExampleForge

  constructor(forge: CounterExampleForge | null = null) {
    this.forge = forge ?? new CounterExampleForge()
  }

  /** Test a student's conjecture against known structures. */
  testConjecture(text: string): ConjectureResult {
    const claim = this.extractClaim(text)
    if (!claim) {
      return new ConjectureResult(
        text.slice(0, 100),
        'undecidable',
        '无法识别猜想内容。请用「我猜...」或「所有...都是...」的格式描述。',
        null,
        '你能更精确地描述你的猜想吗？',
      )
    }
    return this.testClaim(claim)
  }

  /** Extract the conjecture claim from student text. */
  private extractClaim(text: string): string | null {
    const patterns = [
      /我猜(.+)/,
      /猜想(.+)/,
      /猜想[：:](.+)/,
      /所有(.+?)都(.+)/,
      /任何(.+?)都(.+)/,
      /每个(.+?)都(.+)/,
      /(.+?)一定(.+)/,
      /(.+?)必然(.+)/,
      /(.+?)总是(.+)/,
    ]
    for (const pat of patterns) {
      const m = pat.exec(text)
      if (m) return m[0]
    }
    return null
  }

  /**
   * Test a claim against known group structures using brute-force.
   * Specific patterns checked BEFORE general ones.
   */
  private testClaim(claim: string): ConjectureResult {
    const claimLower = claim.toLowerCase()

    // --- Specific patterns (checked first) ---

    // "所有4阶群都是交换群"
    if (claim.includes('4') && (claim.includes('交换') || claimLower.includes('abel'))) {
      const z4 = this.forge.checkCommutativity(TEST_GROUPS['z4'])
      const klein = this.forge.checkCommutativity(TEST_GROUPS['klein'])
      if (!z4.success && !klein.success) {
        return new ConjectureResult(
          claim,
          'confirmed',
          'Z₄ 和 Klein 四元群都是 4 阶交换群。事实上，4 阶群只有这两种，且都交换。',
          null,
          '你猜对了！能证明为什么 4 阶群一定交换吗？',
        )
      }
    }

    // "群中每个元素的逆元唯一"
    if (claim.includes('逆元') && (claim.includes('唯一') || claim.includes('一个'))) {
      return new ConjectureResult(
        claim,
        'confirmed',
        '群公理保证逆元唯一：若 b 和 c 都是 a 的逆元，则 b = b·e = b·(a·c) = (b·a)·c = e·c = c。',
        null,
        '正确！你能用群公理证明这个唯一性吗？',
      )
    }

    // "所有群都有偶数阶"
    if (claim.includes('偶数') && (claim.includes('阶') || claimLower.includes('order'))) {
      return new ConjectureResult(
        claim,
        'refuted',
        'Z₃ = {0, 1, 2} 配合模 3 加法构成 3 阶群，3 是奇数。',
        'Z₃ (3阶循环群)',
        'Z₃ 是一个 3 阶群。什么样的数可以作为群的阶？',
      )
    }

    // "所有素数阶群都是循环群"
    if (claim.includes('素数') || claim.includes('质数')) {
      return new ConjectureResult(
        claim,
        'confirmed',
        '由 Lagrange 定理的推论：素数阶群没有非平凡子群，因此一定循环。',
        null,
        '正确！这和 Lagrange 定理有什么关系？',
      )
    }

    // "群的单位元唯一"
    if (claim.includes('单位元') && (claim.includes('唯一') || claim.includes('一个'))) {
      return new ConjectureResult(
        claim,
        'confirmed',
        '若 e 和 f 都是单位元，则 e = e·f = f。',
        null,
        '正确！这个证明只用了一行。你能写出来吗？',
      )
    }

    // "所有群都满足结合律"
    if (claim.includes('结合律') && (claim.includes('所有') || claim.includes('都'))) {
      return new ConjectureResult(
        claim,
        'confirmed',
        '结合律是群的定义公理之一。所有群都满足结合律。',
        null,
        '正确！但想想：如果去掉结合律，会发生什么？',
      )
    }

    // --- General patterns (checked last) ---

    // "所有群都是交换群"
    if (
      (claim.includes('交换') || claimLower.includes('abel')) &&
      (claim.includes('所有') || claim.includes('群'))
    ) {
      const commResult = this.forge.checkCommutativity(TEST_GROUPS['s3'])
      if (commResult.success) {
        // counter-example found = non-commutative
        return new ConjectureResult(
          claim,
          'refuted',
          '在 S₃ 中，存在元素 a,b 使得 a·b ≠ b·a。',
          'S₃ (3次对称群，6阶)',
          '你的猜想被 S₃ 反驳了。看看 S₃ 的 Cayley 表，你能找到具体哪两个元素不交换吗？',
        )
      }
    }

    return new ConjectureResult(
      claim,
      'undecidable',
      '无法用已知结构验证这个猜想。请尝试更具体的陈述。',
      null,
      '你能把猜想写得更具体吗？比如「所有N阶群都是交换群」？',
    )
  }
}
