import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentGraphState } from "./state.js";
import { agentNode, shouldContinue, formatterNode, toolNode } from "./nodes/agent.js";
import { deliveryNode } from "./nodes/delivery.js";
import { routerNode, shouldRouteToActionAgent } from "./nodes/router.js";

/**
 * ToolTap LangGraph Agent Workflow
 * 
 * Decoupled Architecture:
 * 
 *   START → router ──(RAG/Capabilities match)──> formatter ──> delivery ──> END
 *              │
 *              └──(Action Tool Request)──> agent ──(tool_calls)──> tools ──┐
 *                                            │                             │
 *                                            ▼                             │
 *                                        formatter <───────────────────────┘
 *                                            │
 *                                            ▼
 *                                         delivery ──> END
 */
export function createToolTapGraph() {
    const workflow = new StateGraph(AgentGraphState)
        // Nodes
        .addNode("router", routerNode)
        .addNode("agent", agentNode)
        .addNode("tools", toolNode)
        .addNode("formatter", formatterNode)
        .addNode("delivery", deliveryNode)

        // Entry point is router
        .addEdge(START, "router")

        // Router branch: route directly to formatter if RAG/Capabilities handled query, else to agent
        .addConditionalEdges("router", shouldRouteToActionAgent, {
            formatter: "formatter",
            agent: "agent",
        })

        // After agent: route to tools (if tool call) or formatter (if final response)
        .addConditionalEdges("agent", shouldContinue, {
            tools: "tools",
            formatter: "formatter",
        })

        // After tools: loop back to agent
        .addEdge("tools", "agent")

        // After formatter: deliver via WhatsApp payload builder
        .addEdge("formatter", "delivery")

        // After delivery: end turn
        .addEdge("delivery", END);

    const checkpointer = new MemorySaver();
    return workflow.compile({ checkpointer });
}
