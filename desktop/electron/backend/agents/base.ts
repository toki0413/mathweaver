/**
 * Base agent class: defines the contract for all agents.
 *
 * Ported from Python backend (backend/mathweaver/agents/base.py)
 *
 * Agents are independent units that:
 * - Receive a context (read-only state + task info)
 * - Produce an AgentMessage with results and proposed field updates
 * - Can optionally use tools (forge, RAG, LLM) registered with them
 * - Cannot directly mutate the FourFieldState (single-writer pattern)
 *
 * 3.3: Tool whitelist — agents can only call tools they have registered.
 * 6.3: Permission delegation — child agents inherit a subset of parent's tools.
 *
 * NOTE: AgentContext is already defined in ../types and is imported directly.
 */

import type { AgentContext, AgentMessage, AgentRole } from '../types'
import type { LLMClient } from '../llm/client'
import { createModuleLogger } from '../utils/logger'

const log = createModuleLogger('Agent')

// A tool is any callable with arbitrary arguments. Agents know the concrete
// signature of the tools they register (3.3: whitelist enforced).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentTool = (...args: any[]) => any

export abstract class BaseAgent {
  readonly role: AgentRole
  llmClient: LLMClient | null
  /** 3.3: tool whitelist, keyed by name (Map replaces Python dict). */
  tools: Map<string, AgentTool>
  /** Agent-private state (not shared with other agents). */
  localState: Record<string, unknown>
  callCount = 0
  /** 6.3: Parent agent for permission delegation. */
  protected parent: BaseAgent | null = null

  constructor(role: AgentRole, llmClient: LLMClient | null = null) {
    this.role = role
    this.llmClient = llmClient
    this.tools = new Map()
    this.localState = {}
  }

  /** Register a tool this agent can use (3.3: adds to whitelist). */
  registerTool(name: string, tool: AgentTool): void {
    this.tools.set(name, tool)
  }

  /**
   * Call a registered tool by name (3.3: whitelist enforced).
   * Throws if the tool is not in this agent's whitelist.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callTool(name: string, ...args: any[]): any {
    if (!this.tools.has(name)) {
      log.warn('Agent attempted to call unregistered tool (3.3 violation)', {
        role: this.role,
        tool: name,
      })
      throw new Error(
        `Agent ${this.role} cannot call tool '${name}': ` +
          `not in whitelist [${[...this.tools.keys()].join(', ')}]`,
      )
    }
    const tool = this.tools.get(name)!
    return tool(...args)
  }

  /** Check if this agent is permitted to call a tool (3.3). */
  canCallTool(name: string): boolean {
    return this.tools.has(name)
  }

  /** Return the list of tools this agent is permitted to call (3.3). */
  toolWhitelist(): string[] {
    return [...this.tools.keys()]
  }

  /**
   * Delegate to a child agent with a subset of tools (6.3: permission递减).
   *
   * @param child The child agent to delegate to.
   * @param allowedTools Tools from this agent's whitelist that the child may
   *   use. If undefined, child keeps its own registered tools but cannot
   *   access parent's tools.
   * @returns The child agent (for chaining).
   */
  delegateTo(child: BaseAgent, allowedTools?: string[]): BaseAgent {
    child.parent = this
    if (allowedTools !== undefined) {
      // 6.3: Child can only use tools that parent also has (permission递减)
      const parentTools = new Set(this.tools.keys())
      const childAllowed = new Set(allowedTools.filter(t => parentTools.has(t)))
      // Remove any tools from child that parent doesn't have
      for (const toolName of [...child.tools.keys()]) {
        if (!childAllowed.has(toolName)) {
          child.tools.delete(toolName)
        }
      }
      // Copy allowed tools from parent to child
      for (const toolName of childAllowed) {
        if (!child.tools.has(toolName)) {
          child.tools.set(toolName, this.tools.get(toolName)!)
        }
      }
    }
    return child
  }

  /** Return the delegation chain from root to this agent (6.3). */
  permissionChain(): string[] {
    const chain: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- safe: iterating parent chain, no callback involvement
    let current: BaseAgent | null = this
    while (current !== null) {
      chain.push(current.role)
      current = current.parent
    }
    return chain.reverse()
  }

  /**
   * Execute the agent's task.
   *
   * @param ctx Read-only context with state, input, and prior results.
   * @returns AgentMessage with content, proposed field updates, and tool calls.
   */
  abstract run(ctx: AgentContext): Promise<AgentMessage>

  /**
   * Check if this agent can handle the given context.
   * Default: always true. Override for conditional activation.
   */
  canHandle(_ctx: AgentContext): boolean {
    return true
  }

  /** Return a description of this agent for the orchestrator/LLM. */
  describe(): Record<string, unknown> {
    return {
      role: this.role,
      tools: this.toolWhitelist(),
      has_llm: this.llmClient !== null,
      calls: this.callCount,
      parent: this.parent ? this.parent.role : null,
      permission_chain: this.permissionChain(),
    }
  }
}
