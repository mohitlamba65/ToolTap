import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * CRM Agent Tools
 *
 * Designed for full compatibility with Gemini / OpenAI function calling schemas.
 * Avoids z.record() to prevent 'propertyNames' schema rejection by Google Gemini API.
 */

// ─── CRM Tools ────────────────────────────────────────────

export const crmListLeadsTool = new DynamicStructuredTool({
    name: "crm_list_leads",
    description:
        "List leads/contacts from a CRM. Supports two backends: 'database' (provide a Postgres DATABASE_URL) or 'hubspot' (provide a HUBSPOT_API_KEY). Ask the user which backend and credentials to use before calling this tool.",
    schema: z.object({
        backend: z
            .enum(["database", "hubspot"])
            .describe("Which CRM backend: 'database' or 'hubspot'"),
        connectionUrl: z
            .string()
            .optional()
            .describe("Postgres DATABASE_URL (required when backend is 'database')"),
        apiKey: z
            .string()
            .optional()
            .describe("HubSpot API key (required when backend is 'hubspot')"),
        tableName: z
            .string()
            .optional()
            .default("leads")
            .describe("Table name to query (database mode only, default: 'leads')"),
        limit: z
            .number()
            .optional()
            .default(10)
            .describe("Max number of records to return"),
    }),
    func: async ({ backend, connectionUrl, apiKey, tableName, limit }) => {
        if (backend === "hubspot") {
            return await hubspotListContacts(apiKey!, limit);
        }
        return await dbListRecords(connectionUrl!, tableName!, limit);
    },
});

export const crmAddLeadTool = new DynamicStructuredTool({
    name: "crm_add_lead",
    description:
        "Add a new lead/contact to a CRM. Supports 'database' (Postgres) or 'hubspot' backends. Ask the user for backend choice and credentials first.",
    schema: z.object({
        backend: z
            .enum(["database", "hubspot"])
            .describe("Which CRM backend: 'database' or 'hubspot'"),
        connectionUrl: z
            .string()
            .optional()
            .describe("Postgres DATABASE_URL (required when backend is 'database')"),
        apiKey: z
            .string()
            .optional()
            .describe("HubSpot API key (required when backend is 'hubspot')"),
        tableName: z
            .string()
            .optional()
            .default("leads")
            .describe("Table name (database mode only, default: 'leads')"),
        email: z.string().optional().describe("Lead email address"),
        firstName: z.string().optional().describe("Lead first name"),
        lastName: z.string().optional().describe("Lead last name"),
        phone: z.string().optional().describe("Lead phone number"),
        company: z.string().optional().describe("Lead company name"),
        customFieldsJson: z
            .string()
            .optional()
            .describe("JSON string of extra key-value pairs e.g. '{\"status\":\"new\"}'"),
    }),
    func: async ({ backend, connectionUrl, apiKey, tableName, email, firstName, lastName, phone, company, customFieldsJson }) => {
        const data: Record<string, string> = {};
        if (email) data.email = email;
        if (firstName) data.firstname = firstName;
        if (lastName) data.lastname = lastName;
        if (phone) data.phone = phone;
        if (company) data.company = company;
        if (customFieldsJson) {
            try {
                Object.assign(data, JSON.parse(customFieldsJson));
            } catch (e) {}
        }

        if (backend === "hubspot") {
            return await hubspotCreateContact(apiKey!, data);
        }
        return await dbInsertRecord(connectionUrl!, tableName!, data);
    },
});

export const crmUpdateLeadTool = new DynamicStructuredTool({
    name: "crm_update_lead",
    description:
        "Update an existing lead/contact in a CRM. Supports 'database' (Postgres) or 'hubspot' backends.",
    schema: z.object({
        backend: z
            .enum(["database", "hubspot"])
            .describe("Which CRM backend: 'database' or 'hubspot'"),
        connectionUrl: z
            .string()
            .optional()
            .describe("Postgres DATABASE_URL (required when backend is 'database')"),
        apiKey: z
            .string()
            .optional()
            .describe("HubSpot API key (required when backend is 'hubspot')"),
        tableName: z
            .string()
            .optional()
            .default("leads")
            .describe("Table name (database mode only)"),
        recordId: z
            .string()
            .describe(
                "The ID of the record to update (primary key for DB, contact ID for HubSpot)"
            ),
        email: z.string().optional().describe("Updated lead email"),
        firstName: z.string().optional().describe("Updated first name"),
        lastName: z.string().optional().describe("Updated last name"),
        phone: z.string().optional().describe("Updated phone number"),
        company: z.string().optional().describe("Updated company name"),
        customFieldsJson: z
            .string()
            .optional()
            .describe("JSON string of additional key-value fields to update"),
    }),
    func: async ({ backend, connectionUrl, apiKey, tableName, recordId, email, firstName, lastName, phone, company, customFieldsJson }) => {
        const data: Record<string, string> = {};
        if (email) data.email = email;
        if (firstName) data.firstname = firstName;
        if (lastName) data.lastname = lastName;
        if (phone) data.phone = phone;
        if (company) data.company = company;
        if (customFieldsJson) {
            try {
                Object.assign(data, JSON.parse(customFieldsJson));
            } catch (e) {}
        }

        if (backend === "hubspot") {
            return await hubspotUpdateContact(apiKey!, recordId, data);
        }
        return await dbUpdateRecord(connectionUrl!, tableName!, recordId, data);
    },
});

export const crmDeleteLeadTool = new DynamicStructuredTool({
    name: "crm_delete_lead",
    description:
        "Delete a lead/contact from a CRM. Supports 'database' (Postgres) or 'hubspot' backends.",
    schema: z.object({
        backend: z
            .enum(["database", "hubspot"])
            .describe("Which CRM backend: 'database' or 'hubspot'"),
        connectionUrl: z
            .string()
            .optional()
            .describe("Postgres DATABASE_URL (required when backend is 'database')"),
        apiKey: z
            .string()
            .optional()
            .describe("HubSpot API key (required when backend is 'hubspot')"),
        tableName: z
            .string()
            .optional()
            .default("leads")
            .describe("Table name (database mode only)"),
        recordId: z
            .string()
            .describe("The ID of the record to delete"),
    }),
    func: async ({ backend, connectionUrl, apiKey, tableName, recordId }) => {
        if (backend === "hubspot") {
            return await hubspotDeleteContact(apiKey!, recordId);
        }
        return await dbDeleteRecord(connectionUrl!, tableName!, recordId);
    },
});

// ─── HubSpot Implementation ───────────────────────────────────────────────

async function hubspotListContacts(apiKey: string, limit: number): Promise<string> {
    try {
        const response = await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts?limit=${limit}&properties=email,firstname,lastname,phone,company`,
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );
        if (!response.ok) {
            return `HubSpot error: ${response.status} - ${await response.text()}`;
        }
        const data = (await response.json()) as {
            results: Array<{ id: string; properties: Record<string, string> }>;
        };
        if (!data.results?.length) return "No contacts found in HubSpot.";

        let output = `📋 HubSpot Contacts (${data.results.length}):\n\n`;
        for (const [i, c] of data.results.entries()) {
            const p = c.properties;
            output += `${i + 1}. [ID: ${c.id}] ${p.firstname || ""} ${p.lastname || ""}\n   Email: ${p.email || "N/A"} | Phone: ${p.phone || "N/A"} | Company: ${p.company || "N/A"}\n\n`;
        }
        return output;
    } catch (e: any) {
        return `HubSpot list error: ${e.message}`;
    }
}

async function hubspotCreateContact(apiKey: string, data: Record<string, string>): Promise<string> {
    try {
        const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ properties: data }),
        });
        if (!response.ok) {
            return `HubSpot create error: ${response.status} - ${await response.text()}`;
        }
        const result = (await response.json()) as { id: string };
        return `Contact created successfully in HubSpot. Contact ID: ${result.id}`;
    } catch (e: any) {
        return `HubSpot create error: ${e.message}`;
    }
}

async function hubspotUpdateContact(apiKey: string, contactId: string, data: Record<string, string>): Promise<string> {
    try {
        const response = await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
            {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ properties: data }),
            }
        );
        if (!response.ok) {
            return `HubSpot update error: ${response.status} - ${await response.text()}`;
        }
        return `Contact ${contactId} updated successfully in HubSpot.`;
    } catch (e: any) {
        return `HubSpot update error: ${e.message}`;
    }
}

async function hubspotDeleteContact(apiKey: string, contactId: string): Promise<string> {
    try {
        const response = await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
            {
                method: "DELETE",
                headers: { Authorization: `Bearer ${apiKey}` },
            }
        );
        if (!response.ok) {
            return `HubSpot delete error: ${response.status} - ${await response.text()}`;
        }
        return `Contact ${contactId} deleted successfully from HubSpot.`;
    } catch (e: any) {
        return `HubSpot delete error: ${e.message}`;
    }
}

// ─── Direct Database Implementation ──────────────────────────────────────

async function dbListRecords(connectionUrl: string, tableName: string, limit: number): Promise<string> {
    try {
        const { default: pg } = await import("pg");
        const client = new pg.Client({ connectionString: connectionUrl });
        await client.connect();
        const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, "");
        const result = await client.query(`SELECT * FROM "${safeName}" LIMIT $1`, [limit]);
        await client.end();

        if (!result.rows.length) return `No records found in table "${safeName}".`;

        let output = `📋 Records from "${safeName}" (${result.rows.length}):\n\n`;
        for (const [i, row] of result.rows.entries()) {
            const fields = Object.entries(row)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" | ");
            output += `${i + 1}. ${fields}\n`;
        }
        return output;
    } catch (e: any) {
        return `Database query error: ${e.message}`;
    }
}

async function dbInsertRecord(connectionUrl: string, tableName: string, data: Record<string, string>): Promise<string> {
    try {
        const { default: pg } = await import("pg");
        const client = new pg.Client({ connectionString: connectionUrl });
        await client.connect();
        const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, "");
        const keys = Object.keys(data);
        const values = Object.values(data);
        if (keys.length === 0) return "Error: No lead data provided to insert.";
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        const columns = keys.map((k) => `"${k.replace(/[^a-zA-Z0-9_]/g, "")}"`).join(", ");
        const result = await client.query(
            `INSERT INTO "${safeName}" (${columns}) VALUES (${placeholders}) RETURNING *`,
            values
        );
        await client.end();
        return `Record inserted into "${safeName}" successfully. Data: ${JSON.stringify(result.rows[0])}`;
    } catch (e: any) {
        return `Database insert error: ${e.message}`;
    }
}

async function dbUpdateRecord(connectionUrl: string, tableName: string, recordId: string, data: Record<string, string>): Promise<string> {
    try {
        const { default: pg } = await import("pg");
        const client = new pg.Client({ connectionString: connectionUrl });
        await client.connect();
        const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, "");
        const keys = Object.keys(data);
        const values = Object.values(data);
        if (keys.length === 0) return "Error: No lead data provided to update.";
        const setClause = keys
            .map((k, i) => `"${k.replace(/[^a-zA-Z0-9_]/g, "")}" = $${i + 1}`)
            .join(", ");
        values.push(recordId);
        const result = await client.query(
            `UPDATE "${safeName}" SET ${setClause} WHERE id = $${values.length} RETURNING *`,
            values
        );
        await client.end();
        if (!result.rows.length) return `No record found with id "${recordId}" in "${safeName}".`;
        return `Record ${recordId} updated in "${safeName}". Data: ${JSON.stringify(result.rows[0])}`;
    } catch (e: any) {
        return `Database update error: ${e.message}`;
    }
}

async function dbDeleteRecord(connectionUrl: string, tableName: string, recordId: string): Promise<string> {
    try {
        const { default: pg } = await import("pg");
        const client = new pg.Client({ connectionString: connectionUrl });
        await client.connect();
        const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, "");
        const result = await client.query(`DELETE FROM "${safeName}" WHERE id = $1 RETURNING *`, [
            recordId,
        ]);
        await client.end();
        if (!result.rows.length) return `No record found with id "${recordId}" in "${safeName}".`;
        return `Record ${recordId} deleted from "${safeName}" successfully.`;
    } catch (e: any) {
        return `Database delete error: ${e.message}`;
    }
}
