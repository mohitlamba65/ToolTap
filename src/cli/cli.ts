import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
// import { invokeAgent } from "../agent/create-agent.js";
import { ConversationManager } from "../conversation/manager.js";

export async function startCLI(){
    const rl = readline.createInterface({
        input: stdin,
        output: stdout
    });

    const manager = new ConversationManager();

    console.log("=====================================");
    console.log("Agent CLI");
    console.log("=====================================");

    const threadId = Date.now().toString(); // Unique thread ID for this session

    while(true){
        const input = await rl.question("\n> ");
        if(input.trim().toLowerCase() === "exit"){
            break;
        }

        try{
            console.log("\nAssistant: \n");
            // for await (const chunk of invokeAgent(input, threadId)) {
            //     console.log(JSON.stringify(chunk, null, 2));
            // }

            const response = await manager.invoke(input);

        console.log(response);

        } catch(error){
            console.error("\nError:", error);
        }
    }

    rl.close();
}
