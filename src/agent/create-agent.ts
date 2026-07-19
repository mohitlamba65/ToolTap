import { MemorySaver } from "@langchain/langgraph";
import { createModel } from "../llm/provider.js";
import { ToolRegistry } from "../tools/registry.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { createAgent } from "langchain";

const model = createModel();
const registry = new ToolRegistry();
export const memory = new MemorySaver();

export const agent = createAgent({
    model,
    tools: registry.getTools(),
    systemPrompt: SYSTEM_PROMPT,
    checkpointer: memory,
});

// export async function* invokeAgent(input: string, threadId: string = "default"){
//     const stream = await agent.stream({
//         messages:[
//             {
//                 role: "user",
//                 content: input
//             }
//         ]
//     }, {
//         configurable: {
//             thread_id: threadId
//         }
//     })
//     for await (const chunk of stream) {
//         yield chunk;
//     }
// }
