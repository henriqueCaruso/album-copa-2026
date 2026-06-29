import express from "express";
import path from "path";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up lazy initialization for Gemini API client
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not defined in the environment secrets");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Multer memory storage for holding uploaded files before sending to Gemini
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Express API routes go here FIRST
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Gemini Vision processing endpoint
app.post("/api/gemini/analyze", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    const prefix = req.body.prefix || "BRA";

    if (!file) {
       res.status(400).json({ error: "Nenhuma imagem foi enviada." });
       return;
    }

    const ai = getGeminiClient();
    const base64Image = file.buffer.toString("base64");

    const imagePart = {
      inlineData: {
        mimeType: file.mimetype,
        data: base64Image,
      },
    };

    const promptText = `Analise esta foto de uma página do álbum oficial da Copa do Mundo de 2026. 
A página pertence à seleção com prefixo [${prefix}].
Identifique todos os espaços numerados de 1 a 20.
Retorne um objeto JSON contendo o prefixo exato (string), uma array 'filled' com os números das figurinhas que estão fisicamente coladas no espaço, e uma array 'empty' com os números das figurinhas que estão com o espaço em branco/vazio.
O prefixo retornado no JSON deve ser exatamente o prefixo fornecido: "${prefix}".
Seja extremamente preciso.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        imagePart,
        { text: promptText }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            prefix: {
              type: Type.STRING,
              description: "The 3-letter team prefix matching the page, exactly as requested."
            },
            filled: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
              description: "List of sticker numbers (1 to 20) that are physically pasted on this page"
            },
            empty: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
              description: "List of sticker numbers (1 to 20) that are blank/missing on this page"
            }
          },
          required: ["prefix", "filled", "empty"]
        }
      }
    });

    const textOutput = response.text;
    if (!textOutput) {
      throw new Error("Não foi possível obter resposta de análise da IA.");
    }

    const jsonResult = JSON.parse(textOutput.trim());
    res.json(jsonResult);
  } catch (error: any) {
    console.error("Gemini Vision processing error:", error);
    res.status(500).json({
      error: error?.message || "Erro desconhecido ao processar imagem.",
    });
  }
});

// Serve frontend assets using Vite or static folder
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Copas 2026] Server running on http://0.0.0.0:${PORT}`);
  });
}

setupServer();
