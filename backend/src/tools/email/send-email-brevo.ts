import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export const sendEmailBrevoTool = new DynamicStructuredTool({
    name: "send_email",
    description:
        "Send a transactional email to a recipient using Brevo. Supports plain text and HTML body.",
    schema: z.object({
        to: z.string().describe("Recipient email address"),
        toName: z.string().optional().describe("Recipient name (optional)"),
        subject: z.string().describe("Email subject line"),
        body: z.string().describe("Email body content (plain text)"),
        htmlBody: z
            .string()
            .optional()
            .describe("HTML body content (optional, overrides plain text)"),
    }),
    func: async ({ to, toName, subject, body, htmlBody }) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) {
            return "Error: BREVO_API_KEY is not configured. Please set it in your .env file.";
        }

        const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_FROM;
        const senderName = process.env.BREVO_SENDER_NAME || "ToolTap Agent";

        try {
            const response = await fetch(
                "https://api.brevo.com/v3/smtp/email",
                {
                    method: "POST",
                    headers: {
                        "api-key": apiKey,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    body: JSON.stringify({
                        sender: { name: senderName, email: senderEmail },
                        to: [{ email: to, name: toName || to }],
                        subject,
                        textContent: body,
                        ...(htmlBody ? { htmlContent: htmlBody } : {}),
                    }),
                }
            );

            if (!response.ok) {
                const errText = await response.text();
                return `Failed to send email: ${response.status} - ${errText}`;
            }

            const data = (await response.json()) as { messageId: string };
            return `Email sent successfully to ${to}. Message ID: ${data.messageId}`;
        } catch (error: any) {
            return `Email send error: ${error.message}`;
        }
    },
});

export const getEmailsBrevoTool = new DynamicStructuredTool({
    name: "get_emails",
    description:
        "Get the list of recent transactional email events (sent, delivered, opened, bounced, etc.) from Brevo. Use this to check the status of emails or see recent email activity.",
    schema: z.object({
        email: z
            .string()
            .optional()
            .describe("Filter by recipient email address (optional)"),
        limit: z
            .number()
            .optional()
            .default(10)
            .describe("Number of events to return (default 10)"),
        event: z
            .string()
            .optional()
            .describe(
                "Filter by event type: delivered, opened, clicks, bounces, hardBounces, softBounces, spam, requests, invalid (optional)"
            ),
    }),
    func: async ({ email, limit, event }) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) {
            return "Error: BREVO_API_KEY is not configured. Please set it in your .env file.";
        }

        try {
            const params = new URLSearchParams();
            params.append("limit", String(limit ?? 10));
            if (email) params.append("email", email);
            if (event) params.append("event", event);

            const response = await fetch(
                `https://api.brevo.com/v3/smtp/statistics/events?${params.toString()}`,
                {
                    method: "GET",
                    headers: {
                        "api-key": apiKey,
                        Accept: "application/json",
                    },
                }
            );

            if (!response.ok) {
                const errText = await response.text();
                return `Failed to fetch emails: ${response.status} - ${errText}`;
            }

            const data = (await response.json()) as {
                events?: Array<{
                    email: string;
                    date: string;
                    subject: string;
                    event: string;
                }>;
            };

            if (!data.events || data.events.length === 0) {
                return "No email events found for the given criteria.";
            }

            let output = `📧 Recent Email Activity (${data.events.length} events):\n\n`;
            for (const [i, evt] of data.events.entries()) {
                output += `${i + 1}. [${evt.event.toUpperCase()}] ${evt.subject}\n   To: ${evt.email} | Date: ${evt.date}\n\n`;
            }
            return output;
        } catch (error: any) {
            return `Email fetch error: ${error.message}`;
        }
    },
});
