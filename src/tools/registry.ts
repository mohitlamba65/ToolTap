import { createCalendarEventTool } from "./calendar/create-event.js";
import { updateLeadTool } from "./crm/update-lead.js";
import { getEmailsTool } from "./gmail/get-emails.js";
import { sendEmailTool } from "./gmail/send-email.js";
import { weatherTool } from "./weather.ts/weather.js";

export class ToolRegistry{
    private tools=[
        createCalendarEventTool,
        updateLeadTool,
        getEmailsTool,
        sendEmailTool,
        weatherTool
    ]

    getTools(){
        return this.tools;
    }
}
