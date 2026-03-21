import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { redisConnection } from "../redis/redis.connection.js";

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY missing");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const DAILY_LIMIT = 20;

// 🔒 Central quota guard
const checkQuota = async () => {
  const usage = await redisConnection.incr("gemini:daily_usage");

  if (usage === 1) {
    await redisConnection.expire("gemini:daily_usage", 86400);
  }

  if (usage > DAILY_LIMIT) {
    throw new Error("QUOTA_EXCEEDED");
  }

  return usage;
};

export const analyzeBusiness = async (text) => {
  await checkQuota();

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
  });

  const prompt = `
You analyze a business website.

Return ONLY JSON:

{
  "businessType": "",
  "services": [],
  "description": ""
}

Rules:
- No markdown
- No explanation
- Strict JSON only

Website text:
${text}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const content = response.text();

    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    return JSON.parse(match[0]);

  } catch (error) {

    const isQuotaExceeded =
      error.message?.includes("quota") ||
      error.message?.includes("Quota exceeded");

    if (isQuotaExceeded) {
      throw new Error("QUOTA_EXCEEDED");
    }

    console.log("Gemini error:", error.message);
    return null;
  }
};