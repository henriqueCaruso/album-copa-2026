import express from "express";
import path from "path";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

dotenv.config();

// Initialize Firebase Admin SDK for token verification
// This relies on Google Application Default Credentials in Cloud Run.
// Ensure the Cloud Run service account has proper permissions.
if (getApps().length === 0) {
  initializeApp();
}

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

// Middleware to verify Firebase ID token
const verifyFirebaseToken = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header" });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// Gemini Vision processing endpoint
app.post("/api/gemini/analyze", verifyFirebaseToken, upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    const pageId = req.body.pageId || "BRA-PAGE-01";
    const stickerIdsStr = req.body.stickerIds || "";
    const stickerIds = stickerIdsStr ? stickerIdsStr.split(",") : [];

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
A página selecionada é a "[${pageId}]" correspondente aos seguintes adesivos (IDs): [${stickerIds.join(", ")}].
Identifique o estado de preenchimento para cada um destes adesivos de forma extremamente precisa.
Retorne um objeto JSON contendo:
- "pageId": o ID exato da página fornecido: "${pageId}"
- "detections": lista de objetos com "stickerId" (ex: "BRA_1") e "confidence" (float entre 0.0 e 1.0) para os adesivos que parecem estar fisicamente colados (alta confiança > 0.85).
- "uncertainDetections": lista de objetos com "stickerId" (ex: "BRA_4"), "confidence" (float entre 0.0 e 1.0) e "reason" (string explicando o motivo da dúvida) para adesivos que estão com imagem borrada, cortada ou parcialmente encoberta.
- "warnings": lista de avisos caso a qualidade da foto esteja ruim ou a página pareça incorreta.

Apenas retorne adesivos que pertencem à lista fornecida.`;

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
            pageId: {
              type: Type.STRING,
              description: "The unique ID of the scanned page."
            },
            detections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  stickerId: { type: Type.STRING },
                  confidence: { type: Type.NUMBER }
                },
                required: ["stickerId", "confidence"]
              },
              description: "List of detected/filled stickers with high confidence (> 0.85)"
            },
            uncertainDetections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  stickerId: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  reason: { type: Type.STRING }
                },
                required: ["stickerId", "confidence", "reason"]
              },
              description: "List of stickers with lower confidence or visual occlusion"
            },
            warnings: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Any warnings regarding page mismatch or image quality"
            }
          },
          required: ["pageId", "detections", "uncertainDetections", "warnings"]
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
