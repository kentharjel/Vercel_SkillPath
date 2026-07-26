const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini with your API Key
// In production, use Firebase Secrets: functions.config().gemini.key
const genAI = new GoogleGenerativeAI("YOUR_GEMINI_API_KEY_HERE"); 

exports.generateQuiz = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    // Only allow POST requests
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const { lessonTitle, lessonContent, difficulty, numQuestions } = req.body;

      // 1. Setup the AI model
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // 2. Create strict instructions so the AI replies in the exact JSON format your React app needs
      const prompt = `
        You are an expert professor. Read the following lesson and generate a ${difficulty} difficulty multiple-choice quiz with ${numQuestions} questions.
        
        Lesson Title: ${lessonTitle}
        Lesson Content: ${lessonContent}
        
        You MUST respond ONLY with a raw JSON object in the exact format below. Do not include markdown formatting, backticks, or any conversational text.
        
        {
          "questions": [
            {
              "question": "Sample Question?",
              "choices": [
                { "text": "Wrong Answer 1", "isCorrect": false },
                { "text": "Correct Answer", "isCorrect": true },
                { "text": "Wrong Answer 2", "isCorrect": false },
                { "text": "Wrong Answer 3", "isCorrect": false }
              ]
            }
          ]
        }
      `;

      // 3. Call the AI
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      // 4. Clean the response (sometimes LLMs add markdown like ```json)
      const cleanedText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
      const quizData = JSON.parse(cleanedText);

      // 5. Send it back to React
      res.status(200).json(quizData);

    } catch (error) {
      console.error("AI Error:", error);
      res.status(500).json({ error: "Failed to generate quiz." });
    }
  });
});