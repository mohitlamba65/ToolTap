import { createCalendarEventTool } from "./calendar/create-event.js";
import { crmListLeadsTool, crmAddLeadTool, crmUpdateLeadTool, crmDeleteLeadTool } from "./crm/crm-agent.js";
import { sendEmailMailgunTool, getEmailsMailgunTool } from "./email/send-email-mailgun.js";
import { tavilySearchTool } from "./web-search/tavily-search.js";
import { weatherTool } from "./weather.ts/weather.js";

export class ToolRegistry {
    private tools = [
        tavilySearchTool,
        weatherTool,
        sendEmailMailgunTool,
        getEmailsMailgunTool,
        crmListLeadsTool,
        crmAddLeadTool,
        crmUpdateLeadTool,
        crmDeleteLeadTool,
        createCalendarEventTool,
    ];

    getTools() {
        return this.tools;
    }
}
