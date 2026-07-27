import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentGraphState } from "./state.js";
import { agentNode, shouldContinue, formatterNode, toolNode } from "./nodes/agent.js";
import { deliveryNode } from "./nodes/delivery.js";

/**
 * Creates the ToolTap Agent Graph using LangGraph.
 * 
 * Architecture (inspired by the copywriting agent v2 pattern):
 * 
 *   START → agent → (tool_calls?) → tools → agent
 *                  → (final response) → formatter → delivery → END
 * 
 * Key features:
 * 1. Action tools (search, CRM, weather) are executed by the agent node
 * 2. The formatter node decides the WhatsApp message format (text, buttons, list, etc.)
 * 3. The delivery node constructs the API payload and sends it
 * 4. MemorySaver checkpointer enables human-in-the-loop:
 *    - Each user gets a persistent thread_id
 *    - When the agent needs input, the graph naturally ends at delivery
 *    - The next webhook message resumes the same thread with full context
 */
export function createToolTapGraph() {
    const workflow = new StateGraph(AgentGraphState)
        // Nodes
        .addNode("agent", agentNode)
        .addNode("tools", toolNode)
        .addNode("formatter", formatterNode)
        .addNode("delivery", deliveryNode)
        
        // Edges
        .addEdge(START, "agent")
        
        // After agent: route to tools (if tool call) or formatter (if final response)
        .addConditionalEdges("agent", shouldContinue, {
            tools: "tools",
            formatter: "formatter",
        })
        
        // After tools: loop back to agent for the next reasoning step
        .addEdge("tools", "agent")
        
        // After formatter: deliver the message
        .addEdge("formatter", "delivery")
        
        // After delivery: end the graph (wait for next user message)
        .addEdge("delivery", END);

    // Compile with checkpointer for stateful multi-turn conversations
    const checkpointer = new MemorySaver();
    return workflow.compile({ checkpointer });
}
