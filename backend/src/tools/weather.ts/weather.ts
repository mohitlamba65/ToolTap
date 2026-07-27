import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = new DynamicStructuredTool({
    name: "get_weather",
    description:
        "Get the current weather for a city using OpenWeatherMap. Returns temperature, conditions, humidity, and wind speed.",
    schema: z.object({
        city: z
            .string()
            .describe("The city name to get weather for (e.g. 'London', 'New Delhi', 'Tokyo')"),
    }),
    func: async ({ city }) => {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) {
            return "Error: OPENWEATHER_API_KEY is not configured. Please set it in your .env file.";
        }

        try {
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
            const response = await fetch(url);

            if (!response.ok) {
                if (response.status === 404) {
                    return `City "${city}" not found. Please check the spelling and try again.`;
                }
                const errText = await response.text();
                return `Weather API error: ${response.status} - ${errText}`;
            }

            const data = (await response.json()) as {
                name: string;
                sys: { country: string };
                main: {
                    temp: number;
                    feels_like: number;
                    humidity: number;
                    temp_min: number;
                    temp_max: number;
                };
                weather: Array<{ main: string; description: string }>;
                wind: { speed: number };
                visibility: number;
            };

            return `🌤️ Weather in ${data.name}, ${data.sys.country}:
Temperature: ${data.main.temp}°C (feels like ${data.main.feels_like}°C)
High/Low: ${data.main.temp_max}°C / ${data.main.temp_min}°C
Condition: ${data.weather[0]?.description ?? "N/A"}
Humidity: ${data.main.humidity}%
Wind Speed: ${data.wind.speed} m/s
Visibility: ${(data.visibility / 1000).toFixed(1)} km`;
        } catch (error: any) {
            return `Weather fetch error: ${error.message}`;
        }
    },
});