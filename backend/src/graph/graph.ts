import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentGraphState } from "./state.js";
import { agentNode, shouldContinue, formatterNode, toolNode } from "./nodes/agent.js";
import { deliveryNode } from "./nodes/delivery.js";
import { orchestratorNode, shouldRouteFromOrchestrator } from "./nodes/orchestrator.js";
import { ragNode, shouldEscalateToAgent } from "./nodes/rag.js";
import { capabilityNode } from "./nodes/capability.js";

/**
 * ToolTap Unified LangGraph Workflow
 *
 * Replaces the old keyword-based router + disconnected RAG/formatter approach
 * with a fully agentic, context-aware graph where all capabilities share state.
 *
 * Architecture:
 *
 *   START
 *     │
 *     ▼
 *   orchestrator  ← LLM-based intent classifier (1 fast call)
 *     │               Knows ALL tools + ALL active chatbots
 *     ├── intent="capability" ──► capabilityNode (0 LLM calls, sets responseIntent directly) ──► delivery ──► END
 *     │
 *     ├── intent="rag" ──► ragNode ──► [abstained?] ──► formatter ──► delivery ──► END
 *     │                                    │
 *     │                                    └── [escalated] ──► agent ──► ...
 *     │
 *     └── intent="tool" ──► agent ──► [tool_calls?] ──► tools ──┐
 *                              │                                  │
 *                              └── [final_response] ──────────────┘
 *                                       │
 *                                       ▼
 *                                  formatter (withStructuredOutput — no truncation)
 *                                       │
 *                                       ▼
 *                                  delivery ──► END
 *
 * Key properties:
 * - All nodes share the same AgentState — RAG bots and agents CAN see each other's context
 * - RAG can escalate to tools if knowledge base is insufficient
 * - Formatter uses withStructuredOutput to guarantee complete JSON (no more truncation)
 * - History auto-trimmed to last 10 messages at state reducer level (not node level)
 */
export function createToolTapGraph() {
    const workflow = new StateGraph(AgentGraphState)
        // ── Nodes ──────────────────────────────────────────────────────────────
        .addNode("orchestrator", orchestratorNode)
        .addNode("agent",        agentNode)
        .addNode("tools",        toolNode)
        .addNode("rag",          ragNode)
        .addNode("capability",   capabilityNode)
        .addNode("formatter",    formatterNode)
        .addNode("delivery",     deliveryNode)

        // ── Entry Point ────────────────────────────────────────────────────────
        .addEdge(START, "orchestrator")

        // ── Orchestrator → Execution Nodes (conditional routing) ───────────────
        .addConditionalEdges("orchestrator", shouldRouteFromOrchestrator, {
            agent:      "agent",
            rag:        "rag",
            capability: "capability",
        })

        // ── Agent → Tools loop or final response ───────────────────────────────
        .addConditionalEdges("agent", shouldContinue, {
            tools:     "tools",
            formatter: "formatter",
        })

        // ── Tools → back to agent ──────────────────────────────────────────────
        .addEdge("tools", "agent")

        // ── RAG → formatter (or escalate to agent if abstained) ───────────────
        .addConditionalEdges("rag", shouldEscalateToAgent, {
            formatter: "formatter",
            agent:     "agent",
        })

        // ── Capability → delivery directly (already sets responseIntent, no LLM pass needed) ───
        .addEdge("capability", "delivery")

        // ── Formatter → delivery ──────────────────────────────────────────────
        .addEdge("formatter", "delivery")

        // ── Delivery → END ────────────────────────────────────────────────────
        .addEdge("delivery", END);

    const checkpointer = new MemorySaver();
    return workflow.compile({ checkpointer });
}
