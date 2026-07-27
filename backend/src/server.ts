import express from 'express';
import type { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { WhatsAppService } from './whatsapp/whatsapp.service.js';
import { ConversationManager } from './conversation/manager.js';
import "dotenv/config";

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const whatsappService = new WhatsAppService();
// We use a simple map to persist ConversationManager per user
const conversations = new Map<string, ConversationManager>();

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'my_verify_token';

app.get(/.*/, (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const challenge = req.query['hub.challenge'];
    const token = req.query['hub.verify_token'];

    if (mode === 'subscribe' && token === verifyToken) {
        console.log('Webhook verified successfully');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post(/.*/, async (req: Request, res: Response) => {
    try {
        const body = req.body;

        // Meta requires a fast 200 response
        res.status(200).send('EVENT_RECEIVED');

        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    const value = change.value;
                    
                    if (value.messages && value.messages.length > 0) {
                        for (const message of value.messages) {
                            if (message.type === 'text') {
                                const from = message.from;
                                const text = message.text.body;

                                console.log(`Received message from ${from}: ${text}`);

                                // Get or create a conversation manager for the user
                                let manager = conversations.get(from);
                                if (!manager) {
                                    manager = new ConversationManager();
                                    conversations.set(from, manager);
                                }

                                // Invoke the agent
                                try {
                                    const responseText = await manager.invoke(text);
                                    if (responseText) {
                                        await whatsappService.sendText(from, responseText.toString());
                                    }
                                } catch (error) {
                                    console.error('Agent invocation error:', error);
                                    await whatsappService.sendText(from, "I'm sorry, an error occurred while processing your request.");
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Webhook error:', error);
    }
});

export function startServer() {
    app.listen(port, () => {
        console.log(`WhatsApp agent server listening on port ${port}`);
    });
}
