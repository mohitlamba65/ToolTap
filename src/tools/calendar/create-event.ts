import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export const createCalendarEventTool =
new DynamicStructuredTool({

    name: "create_calendar_event",

    description:
        "Create a calendar event.",

    schema: z.object({

        title: z.string(),

        date: z.string(),

        time: z.string()

    }),

    func: async ({ title, date, time }) => {

        return `Calendar event created

${title}

${date}

${time}`;

    }

});