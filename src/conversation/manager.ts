import { agent } from "../agent/create-agent.js";

export class ConversationManager {

    private threadId = crypto.randomUUID();

    async invoke(input: string) {

        const result = await agent.invoke(

            {

                messages: [

                    {

                        role: "user",

                        content: input

                    }

                ]

            },

            {

                configurable: {

                    thread_id: this.threadId

                }

            }

        );

        return result.messages.at(-1)?.content;

    }

}