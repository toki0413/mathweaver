/**
 * Generate a course (a list of ConceptNode) for an arbitrary math topic via LLM,
 * then sanitize + validate before merging into the DAG.
 */

import { createLLMClient, type LLMClient } from '../llm/client'
import type { LLMConfig, ConceptNode } from '../types'
import { createModuleLogger } from '../utils/logger'

const log = createModuleLogger('CourseGen')

export const COURSE_JSON_SCHEMA_HINT = `请为数学主题生成概念 DAG 节点，严格输出 JSON（不要输出任何其他文字）：
{
  "nodes": [
    {
      "id": "英文小写蛇形命名",
      "name": "中文概念名",
      "description": "一句话说明",
      "prerequisites": ["前置节点id（可为空数组）"],
      "abstraction_level": 1,
      "domain": "自定义域",
      "difficulty": 0.5,
      "is_milestone": false,
      "learning_objectives": ["目标1"],
      "examples": ["例子1"],
      "assessment_criteria": ["评价标准1"],
      "estimated_minutes": 30,
      "historical_context": "历史背景",
      "related_theorems": ["相关定理"],
      "common_misconceptions": ["常见误区"]
    }
  ]
}`

export function sanitizeCourseNodes(raw: unknown[]): ConceptNode[] {
  const out: ConceptNode[] = []
  raw.forEach((item, i) => {
    const n = item as Partial<ConceptNode> & { name?: string }
    if (!n || typeof n !== 'object' || !n.name) return // drop malformed
    const id =
      n.id && /^[a-z0-9_]+$/.test(n.id) ? n.id : `generated_${i}_${Date.now().toString(36)}`
    out.push({
      id,
      name: String(n.name),
      description: String(n.description ?? ''),
      prerequisites: Array.isArray(n.prerequisites) ? n.prerequisites.map(String) : [],
      abstraction_level: Number(n.abstraction_level ?? 1),
      domain: String(n.domain ?? 'generated'),
      difficulty: Number(n.difficulty ?? 0.5),
      is_milestone: Boolean(n.is_milestone),
      learning_objectives: Array.isArray(n.learning_objectives)
        ? n.learning_objectives.map(String)
        : [],
      examples: Array.isArray(n.examples) ? n.examples.map(String) : [],
      assessment_criteria: Array.isArray(n.assessment_criteria)
        ? n.assessment_criteria.map(String)
        : [],
      estimated_minutes: Number(n.estimated_minutes ?? 30),
      historical_context: String(n.historical_context ?? ''),
      related_theorems: Array.isArray(n.related_theorems) ? n.related_theorems.map(String) : [],
      common_misconceptions: Array.isArray(n.common_misconceptions)
        ? n.common_misconceptions.map(String)
        : [],
    })
  })
  return out
}

export async function generateCourse(
  topic: string,
  config: LLMConfig,
  client: LLMClient = createLLMClient(config),
): Promise<ConceptNode[]> {
  const prompt = `${COURSE_JSON_SCHEMA_HINT}\n\n主题：${topic}\n请生成 4-8 个有先修关系的概念节点。`
  const resp = await client.chat('你是数学课程设计专家，只输出符合要求的 JSON。', prompt)
  const match = resp.content.match(/\{[\s\S]*\}/)
  if (!match) {
    log.warn('LLM output contained no JSON', { topic })
    return []
  }
  let parsed: { nodes?: unknown[] }
  try {
    parsed = JSON.parse(match[0])
  } catch (e) {
    log.warn('Failed to parse course JSON', { topic, error: String(e) })
    return []
  }
  return sanitizeCourseNodes(parsed.nodes ?? [])
}
