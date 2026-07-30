import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Resolves Mailgun API credentials, base URL, and domain.
 * Automatically auto-discovers sending domain from Mailgun API if MAILGUN_DOMAIN is not set.
 */
async function getMailgunConfig(paramDomain?: string) {
    const apiKey = process.env.MAILGUN_API_KEY;
    if (!apiKey) {
        throw new Error("Error: MAILGUN_API_KEY is not configured. Please set MAILGUN_API_KEY in your .env file.");
    }

    const baseUrl = (process.env.MAILGUN_BASE_URL || "https://api.mailgun.net").replace(/\/$/, "");
    const authHeader = "Basic " + Buffer.from(`api:${apiKey}`).toString("base64");

    let domain = paramDomain || process.env.MAILGUN_DOMAIN;

    if (!domain) {
        // Auto-discover active sending domain via Mailgun API
        try {
            const res = await fetch(`${baseUrl}/v3/domains`, {
                method: "GET",
                headers: {
                    Authorization: authHeader,
                    Accept: "application/json",
                },
            });
            if (res.ok) {
                const data = (await res.json()) as { items?: Array<{ name: string; state: string }> };
                if (data.items && data.items.length > 0) {
                    const activeItem = data.items.find((d) => d.state === "active") || data.items[0];
                    if (activeItem?.name) {
                        domain = activeItem.name;
                        console.log(`ℹ️ [Mailgun] Auto-discovered domain: ${domain}`);
                    }
                }
            }
        } catch (e: any) {
            console.warn(`[Mailgun] Domain auto-discovery warning: ${e.message}`);
        }
    }

    if (!domain) {
        throw new Error("Error: MAILGUN_DOMAIN is not configured and could not be auto-discovered. Please specify domain in request or env.");
    }

    const defaultSender = process.env.MAILGUN_SENDER_EMAIL || process.env.EMAIL_FROM || `ToolTap Agent <postmaster@${domain}>`;

    return { apiKey, baseUrl, authHeader, domain, defaultSender };
}

/**
 * 1. Send Email Tool (Mailgun REST API)
 */
export const sendEmailMailgunTool = new DynamicStructuredTool({
    name: "send_email",
    description:
        "Send transactional emails, templated emails, or batch messages via Mailgun. Supports custom headers, tags, tracking, and delivery options.",
    schema: z.object({
        to: z.string().describe("Recipient email address or comma-separated addresses (e.g. 'user@example.com' or 'Alice <alice@example.com>')"),
        subject: z.string().describe("Email subject line"),
        body: z.string().optional().describe("Plain text body content"),
        htmlBody: z.string().optional().describe("HTML body content (optional)"),
        from: z.string().optional().describe("Sender email address (optional, e.g. 'ToolTap <no-reply@yourdomain.com>')"),
        cc: z.string().optional().describe("CC recipient email addresses (optional)"),
        bcc: z.string().optional().describe("BCC recipient email addresses (optional)"),
        template: z.string().optional().describe("Mailgun stored template name (optional)"),
        templateVariables: z.string().optional().describe("JSON string of variables for Mailgun template expansion (optional)"),
        tags: z.array(z.string()).optional().describe("Tags for message tracking and analytics (optional)"),
        testmode: z.boolean().optional().describe("Set true to process message in test mode without actual delivery (optional)"),
        tracking: z.boolean().optional().describe("Enable open and click tracking (optional)"),
        domain: z.string().optional().describe("Mailgun sending domain (optional, auto-detected if omitted)"),
    }),
    func: async ({ to, subject, body, htmlBody, from, cc, bcc, template, templateVariables, tags, testmode, tracking, domain }) => {
        try {
            const { baseUrl, authHeader, domain: targetDomain, defaultSender } = await getMailgunConfig(domain);

            const formData = new URLSearchParams();
            formData.append("from", from || defaultSender);
            formData.append("to", to);
            formData.append("subject", subject);

            if (body) formData.append("text", body);
            if (htmlBody) formData.append("html", htmlBody);
            if (!body && !htmlBody && !template) {
                // Default fallback if neither body nor template provided
                formData.append("text", " ");
            }

            if (cc) formData.append("cc", cc);
            if (bcc) formData.append("bcc", bcc);

            if (template) {
                formData.append("template", template);
                if (templateVariables) {
                    formData.append("t:variables", typeof templateVariables === "string" ? templateVariables : JSON.stringify(templateVariables));
                }
            }

            if (tags && tags.length > 0) {
                tags.forEach((tag) => formData.append("o:tag", tag));
            }

            if (testmode) formData.append("o:testmode", "yes");
            if (tracking !== undefined) formData.append("o:tracking", tracking ? "yes" : "no");

            const response = await fetch(`${baseUrl}/v3/${targetDomain}/messages`, {
                method: "POST",
                headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: formData.toString(),
            });

            if (!response.ok) {
                const errText = await response.text();
                return `Mailgun Send Error (${response.status}): ${errText}`;
            }

            const data = (await response.json()) as { id: string; message: string };
            return `Email sent successfully via Mailgun to ${to}.\nDomain: ${targetDomain}\nMessage ID: ${data.id}\nStatus: ${data.message}`;
        } catch (error: any) {
            return `Email send error: ${error.message}`;
        }
    },
});

/**
 * 2. Get Email Events & Tracking Tool (Mailgun Events API)
 */
export const getEmailsMailgunTool = new DynamicStructuredTool({
    name: "get_emails",
    description:
        "Retrieve recent email activity, tracking events (delivered, opened, clicked, bounced, failed), or message logs from Mailgun.",
    schema: z.object({
        recipient: z.string().optional().describe("Filter events by recipient email address (optional)"),
        event: z.string().optional().describe("Filter by event type: accepted, delivered, opened, clicked, failed, bounced, complained, unsubscribed (optional)"),
        limit: z.number().optional().default(10).describe("Number of event records to return (default 10)"),
        domain: z.string().optional().describe("Mailgun domain (optional)"),
    }),
    func: async ({ recipient, event, limit, domain }) => {
        try {
            const { baseUrl, authHeader, domain: targetDomain } = await getMailgunConfig(domain);

            const params = new URLSearchParams();
            params.append("limit", String(limit ?? 10));
            if (recipient) params.append("recipient", recipient);
            if (event) params.append("event", event);

            const response = await fetch(`${baseUrl}/v3/${targetDomain}/events?${params.toString()}`, {
                method: "GET",
                headers: {
                    Authorization: authHeader,
                    Accept: "application/json",
                },
            });

            if (!response.ok) {
                const errText = await response.text();
                return `Mailgun Events Error (${response.status}): ${errText}`;
            }

            const data = (await response.json()) as {
                items?: Array<{
                    event: string;
                    timestamp: number;
                    recipient: string;
                    message?: { headers?: { subject?: string } };
                    storage?: { key?: string };
                }>;
            };

            if (!data.items || data.items.length === 0) {
                return `No email events found for domain '${targetDomain}' matching the criteria.`;
            }

            let output = `📧 Recent Mailgun Email Events (${data.items.length} records for ${targetDomain}):\n\n`;
            data.items.forEach((evt, i) => {
                const dateStr = new Date(evt.timestamp * 1000).toISOString();
                const subject = evt.message?.headers?.subject || "No Subject";
                const storageKey = evt.storage?.key ? ` | Storage Key: ${evt.storage.key}` : "";
                output += `${i + 1}. [${evt.event.toUpperCase()}] ${subject}\n   To: ${evt.recipient} | Date: ${dateStr}${storageKey}\n\n`;
            });

            return output;
        } catch (error: any) {
            return `Email fetch error: ${error.message}`;
        }
    },
});

/**
 * 3. Retrieve Stored Email Content Tool (Mailgun Message Retrieval API)
 */
export const getStoredEmailMailgunTool = new DynamicStructuredTool({
    name: "get_stored_email",
    description: "Retrieve full body content and raw details of a stored email using its Mailgun storage key.",
    schema: z.object({
        storageKey: z.string().describe("The storage key obtained from email tracking events"),
        domain: z.string().optional().describe("Mailgun domain (optional)"),
    }),
    func: async ({ storageKey, domain }) => {
        try {
            const { baseUrl, authHeader, domain: targetDomain } = await getMailgunConfig(domain);

            const response = await fetch(`${baseUrl}/v3/domains/${targetDomain}/messages/${storageKey}`, {
                method: "GET",
                headers: {
                    Authorization: authHeader,
                    Accept: "application/json",
                },
            });

            if (!response.ok) {
                const errText = await response.text();
                return `Retrieve Stored Email Error (${response.status}): ${errText}`;
            }

            const data = (await response.json()) as {
                From?: string;
                To?: string;
                Subject?: string;
                "body-plain"?: string;
                "body-html"?: string;
                "Date"?: string;
            };

            return `📬 Stored Email Details:\nFrom: ${data.From || "N/A"}\nTo: ${data.To || "N/A"}\nSubject: ${data.Subject || "N/A"}\nDate: ${data.Date || "N/A"}\n\nBody Content:\n${data["body-plain"] || data["body-html"] || "(No text content)"}`;
        } catch (error: any) {
            return `Retrieve stored email error: ${error.message}`;
        }
    },
});

/**
 * 4. Get Sending Queues Tool (Mailgun Queue Status API)
 */
export const getSendingQueuesMailgunTool = new DynamicStructuredTool({
    name: "get_sending_queues",
    description: "Check the status of default and scheduled message queues for a domain in Mailgun.",
    schema: z.object({
        domain: z.string().optional().describe("Mailgun domain (optional)"),
    }),
    func: async ({ domain }) => {
        try {
            const { baseUrl, authHeader, domain: targetDomain } = await getMailgunConfig(domain);

            const response = await fetch(`${baseUrl}/v3/domains/${targetDomain}/sending_queues`, {
                method: "GET",
                headers: {
                    Authorization: authHeader,
                    Accept: "application/json",
                },
            });

            if (!response.ok) {
                const errText = await response.text();
                return `Sending Queues Error (${response.status}): ${errText}`;
            }

            const data = await response.json();
            return `🚦 Mailgun Sending Queues Status for '${targetDomain}':\n${JSON.stringify(data, null, 2)}`;
        } catch (error: any) {
            return `Sending queues check error: ${error.message}`;
        }
    },
});

/**
 * 5. Delete Scheduled / Undelivered Mail Tool (Mailgun Envelopes API)
 */
export const deleteScheduledMailgunTool = new DynamicStructuredTool({
    name: "delete_scheduled_email",
    description: "Delete all scheduled and undelivered emails from the domain queue in Mailgun.",
    schema: z.object({
        domain: z.string().optional().describe("Mailgun domain (optional)"),
    }),
    func: async ({ domain }) => {
        try {
            const { baseUrl, authHeader, domain: targetDomain } = await getMailgunConfig(domain);

            const response = await fetch(`${baseUrl}/v3/${targetDomain}/envelopes`, {
                method: "DELETE",
                headers: {
                    Authorization: authHeader,
                    Accept: "application/json",
                },
            });

            if (!response.ok) {
                const errText = await response.text();
                return `Delete Envelopes Error (${response.status}): ${errText}`;
            }

            const data = await response.json();
            return `🗑️ Successfully cleared scheduled/undelivered email queue for '${targetDomain}':\n${JSON.stringify(data, null, 2)}`;
        } catch (error: any) {
            return `Delete scheduled mail error: ${error.message}`;
        }
    },
});
