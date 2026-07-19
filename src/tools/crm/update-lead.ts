import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export const updateLeadTool =
new DynamicStructuredTool({

    name: "update_lead",

    description:
        "Update CRM lead.",

    schema: z.object({

        leadName: z.string(),

        status: z.string()

    }),

    func: async ({ leadName, status }) => {

        return `Lead ${leadName} updated to ${status}`;

    }

});