import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const analyzeBusiness = async (text) => {

  try {

    const model = genAI.getGenerativeModel({
      model:"gemini-2.5-flash"
    });

    const prompt = `
You analyze a business website.

Extract structured information.

Return ONLY JSON.

Example:

{
 "businessType": "Hotel",
 "services": ["Hotel rooms","Restaurant","Event hosting"],
 "description": "Hotel offering accommodation and dining."
}

Rules:
- Do not add explanations
- Do not add markdown
- Only return JSON
- If services unclear return []

Website text:
${text}
`;

    const result = await model.generateContent(prompt);

    const response = await result.response;

    let content = response.text();

    /* Extract JSON safely */

    const match = content.match(/\{[\s\S]*\}/);

    if (!match) {
      console.log("Gemini returned invalid format");
      return null;
    }

    const json = JSON.parse(match[0]);

    return {
      businessType: json.businessType || "Business",
      services: json.services || [],
      description: json.description || ""
    };

  } catch (error) {

    console.log("Gemini extraction error:", error.message);

    return null;

  }

};