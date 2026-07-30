import { createCalendarEventTool } from "./calendar/create-event.js";
import { crmListLeadsTool, crmAddLeadTool, crmUpdateLeadTool, crmDeleteLeadTool } from "./crm/crm-agent.js";
import {
    sendEmailMailgunTool,
    getEmailsMailgunTool,
    getStoredEmailMailgunTool,
    getSendingQueuesMailgunTool,
    deleteScheduledMailgunTool,
} from "./email/send-email-mailgun.js";
import { tavilySearchTool } from "./web-search/tavily-search.js";
import { weatherTool } from "./weather.ts/weather.js";

export class ToolRegistry {
    private tools = [
        // Web Search
        tavilySearchTool,

        // Weather
        weatherTool,

        // Email (Mailgun Engine)
        sendEmailMailgunTool,
        getEmailsMailgunTool,
        getStoredEmailMailgunTool,
        getSendingQueuesMailgunTool,
        deleteScheduledMailgunTool,

        // CRM (Database + HubSpot)
        crmListLeadsTool,
        crmAddLeadTool,
        crmUpdateLeadTool,
        crmDeleteLeadTool,

        // Calendar
        createCalendarEventTool,
    ];

    getTools() {
        return this.tools;
    }
}
