import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = new DynamicStructuredTool({
    name:"get_weather",
    description:"Get the current weather for a city.",
    schema: z.object({
        city: z.string(),
    }),
    func: async ({city})=>{
        return `Weather in  ${city}
        Temperature: 25°C
        Condition: Sunny
        Humidity: 60%
        Wind Speed: 10 km/h
        `
    }
})