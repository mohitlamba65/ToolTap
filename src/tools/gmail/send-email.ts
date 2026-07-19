import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { transporter } from "../../utils/email.js";
import { env } from "../../config/env.js";

export const sendEmailTool = new DynamicStructuredTool({
    name:"send_email",
    description:"Send an email to a recipient.",
    schema: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string(),
    }),
    func: async ({to, subject, body})=>{
        const result = await transporter.sendMail({
            from: env.emailFrom,
            to,
            subject,
            text: body,
        })
        return `Email sent successfully. MessageId=${result.messageId}`;
    }
});