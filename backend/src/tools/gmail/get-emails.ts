import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export const getEmailsTool = new DynamicStructuredTool({

    name: "get_emails",

    description:
        "Fetch emails for a given date.",

    schema: z.object({

        date: z.string()

    }),

    func: async ({ date }) => {

        return `

Emails for ${date}

1. Welcome to OpenAI

2. Interview Invitation

3. Monthly Newsletter

`;

    }

});