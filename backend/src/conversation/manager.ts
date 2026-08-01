import { HumanMessage } from "@langchain/core/messages";
import { createToolTapGraph } from "../graph/graph.js";

// Graph is initialised lazily on first use (async)
let graphPromise: ReturnType<typeof createToolTapGraph> | null = null;

function getGraph() {
    if (!graphPromise) {
        graphPromise = createToolTapGraph();
    }
    return graphPromise;
}

export class ConversationManager {

    private threadId = crypto.randomUUID();

    async invoke(input: string) {
        const { graph } = await getGraph();

        const result = await graph.invoke(
            {
                messages: [new HumanMessage(input)],
            },
            {
                configurable: {
                    thread_id: this.threadId,
                },
            }
        );

        return result.messages.at(-1)?.content;
    }
}