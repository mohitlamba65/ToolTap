import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export const tavilySearchTool = new DynamicStructuredTool({
    name: "web_search",
    description:
        "Search the web for current information using Tavily. Use this when the user asks about recent news, facts, prices, events, or anything that requires up-to-date internet data.",
    schema: z.object({
        query: z
            .string()
            .describe("The search query to look up on the web"),
        maxResults: z
            .number()
            .optional()
            .default(5)
            .describe("Maximum number of results to return (default 5)"),
    }),
    func: async ({ query, maxResults }) => {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
            return "Error: TAVILY_API_KEY is not configured. Please set it in your .env file.";
        }

        try {
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    api_key: apiKey,
                    query,
                    max_results: maxResults,
                    include_answer: true,
                    include_raw_content: false,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                return `Web search failed: ${response.status} - ${errText}`;
            }

            const data = (await response.json()) as {
                answer?: string;
                results?: Array<{
                    title: string;
                    url: string;
                    content: string;
                }>;
            };

            let output = "";

            if (data.answer) {
                output += `**Summary:** ${data.answer}\n\n`;
            }

            if (data.results && data.results.length > 0) {
                output += "**Sources:**\n";
                for (const [i, result] of data.results.entries()) {
                    output += `${i + 1}. ${result.title}\n   ${result.url}\n   ${result.content.slice(0, 200)}...\n\n`;
                }
            }

            return output || "No results found for your query.";
        } catch (error: any) {
            return `Web search error: ${error.message}`;
        }
    },
});
