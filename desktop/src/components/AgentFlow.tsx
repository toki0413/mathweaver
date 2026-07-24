import { Fragment, useCallback, useState } from 'react'

interface AgentInfo {
  name: string
  description: string
}

const AGENT_INFO: Record<string, AgentInfo> = {
  perception: {
    name: '感知智能体',
    description: '分析学生输入，提取数学结构和认知信号',
  },
  abstraction: {
    name: '抽象智能体',
    description: '从具体运算中提取抽象模式和不变量',
  },
  counter_example: {
    name: '反例智能体',
    description: '构造反例检验学生的猜想',
  },
  epistemic: {
    name: '认知智能体',
    description: '评估知识论证的严谨性和完备性',
  },
  historical: {
    name: '历史智能体',
    description: '检索数学史中的相关概念和案例',
  },
  collaboration: {
    name: '协作智能体',
    description: '协调各智能体输出，形成综合决策',
  },
  meta: {
    name: '元认知智能体',
    description: '监控学习过程，调整教学策略',
  },
}

export interface AgentFlowProps {
  phases: string[]
}

/**
 * AgentFlow — 用可交互的水平流程图替换静态 phase-trace 徽章。
 *
 * - 将 phases 渲染为带连接箭头的智能体节点序列。
 * - 已完成的节点标记 `agent-completed`，当前（最后一个）节点标记 `agent-current`。
 * - 点击任意节点可在下方展开详情卡片，展示智能体中文名、职责描述
 *   以及「输入 / 输出」占位区。
 * - 节点数量较多时，`agent-flow` 容器可水平滚动。
 */
export function AgentFlow({ phases }: AgentFlowProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const handleNodeClick = useCallback((index: number) => {
    setSelectedIndex((prev) => (prev === index ? null : index))
  }, [])

  if (!phases || phases.length === 0) {
    return null
  }

  const lastIndex = phases.length - 1
  const selectedPhase = selectedIndex !== null ? phases[selectedIndex] : null
  const selectedInfo = selectedPhase ? AGENT_INFO[selectedPhase] : null

  return (
    <div className="agent-flow-wrapper">
      <div className="agent-flow">
        {phases.map((phase, index) => {
          const info = AGENT_INFO[phase]
          const stateClass = index === lastIndex ? 'agent-current' : 'agent-completed'
          const isSelected = selectedIndex === index
          const nodeClasses = ['agent-node', stateClass, isSelected ? 'agent-selected' : '']
            .filter(Boolean)
            .join(' ')

          return (
            <Fragment key={`${phase}-${index}`}>
              <span
                className={nodeClasses}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={info ? info.name : phase}
                onClick={() => handleNodeClick(index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleNodeClick(index)
                  }
                }}
              >
                {info ? info.name : phase}
              </span>
              {index < lastIndex && <span className="agent-arrow">{'\u2192'}</span>}
            </Fragment>
          )
        })}
      </div>

      {selectedPhase && (
        <div className="agent-detail-card">
          <div className="agent-detail-name">
            {selectedInfo ? selectedInfo.name : selectedPhase}
          </div>
          <div className="agent-detail-role">
            {selectedInfo ? selectedInfo.description : ''}
          </div>
          <div className="agent-detail-io">
            <div className="agent-detail-input">
              <div className="agent-detail-label">输入</div>
              <div className="agent-detail-placeholder">输入占位</div>
            </div>
            <div className="agent-detail-output">
              <div className="agent-detail-label">输出</div>
              <div className="agent-detail-placeholder">输出占位</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
