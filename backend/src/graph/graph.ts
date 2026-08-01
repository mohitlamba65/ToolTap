import { StateGraph, START, END, MemorySaver, InMemoryStore } from "@langchain/langgraph";
import { AgentGraphState } from "./state.js";
import { agentNode, shouldContinue, formatterNode, toolNode } from "./nodes/agent.js";
import { deliveryNode } from "./nodes/delivery.js";
import { orchestratorNode, shouldRouteFromOrchestrator } from "./nodes/orchestrator.js";
import { ragNode, shouldEscalateToAgent } from "./nodes/rag.js";
import { capabilityNode } from "./nodes/capability.js";
import { setupMemory, createInMemoryStore } from "../memory/memory.js";
import type { PostgresStore } from "../memory/memory.js";

/**
 * ToolTap Unified LangGraph Workflow
 *
 * Memory strategy:
 *   Short-term : PostgresSaver  — per-thread checkpoints (survives restarts)
 *   Long-term  : PostgresStore  — cross-session user data
 *   Fallback   : MemorySaver + InMemoryStore (dev / Postgres unavailable)
 */

function buildWorkflow() {
    return new StateGraph(AgentGraphState)
        .addNode("orchestrator", orchestratorNode)
        .addNode("agent",        agentNode)
        .addNode("tools",        toolNode)
        .addNode("rag",          ragNode)
        .addNode("capability",   capabilityNode)
        .addNode("formatter",    formatterNode)
        .addNode("delivery",     deliveryNode)

        .addEdge(START, "orchestrator")

        .addConditionalEdges("orchestrator", shouldRouteFromOrchestrator, {
            agent:      "agent",
            rag:        "rag",
            capability: "capability",
        })

        .addConditionalEdges("agent", shouldContinue, {
            tools:     "tools",
            formatter: "formatter",
        })

        .addEdge("tools", "agent")

        .addConditionalEdges("rag", shouldEscalateToAgent, {
            formatter: "formatter",
            agent:     "agent",
        })

        .addEdge("capability", "delivery")
        .addEdge("formatter",  "delivery")
        .addEdge("delivery",   END);
}

export type ToolTapGraph = ReturnType<typeof buildWorkflow> extends StateGraph<any, any, any, any, any, any>
    ? ReturnType<ReturnType<typeof buildWorkflow>["compile"]>
    : never;

/**
 * Creates and compiles the LangGraph with Postgres memory (or in-process fallback).
 * Returns the compiled graph and the store for external cross-session access.
 */
export async function createToolTapGraph(): Promise<{
    graph: ReturnType<ReturnType<typeof buildWorkflow>["compile"]>;
    store: PostgresStore | InMemoryStore | null;
}> {
    const workflow = buildWorkflow();

    try {
        const { checkpointer, store } = await setupMemory();
        const graph = workflow.compile({ checkpointer });
        console.log("✅ [Graph] Compiled with PostgresSaver + custom PostgresStore");
        return { graph, store };
    } catch (err: any) {
        console.warn(`⚠️  [Graph] Postgres unavailable (${err?.message ?? err}). Using in-process MemorySaver.`);
        const checkpointer = new MemorySaver();
        const store = createInMemoryStore();
        const graph = workflow.compile({ checkpointer });
        return { graph, store };
    }
}
