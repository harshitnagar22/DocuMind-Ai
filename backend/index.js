import express from "express";
import cors from "cors";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { createRequire } from "module";
import { app as ragWorkflow } from "./rag.js";
import { PrismaClient } from "./generated/prisma/index.js";
import { Pinecone } from "@pinecone-database/pinecone";
import { clerkMiddleware, requireAuth, getAuth } from "@clerk/express";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
const prisma = new PrismaClient();

const app = express();

const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:3000";
app.use(cors({ origin: allowedOrigin }));

app.use(express.json());
app.use(clerkMiddleware());

// Rate Limiting to prevent abuse in production
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  message: { error: "Too many requests, please try again later." }
});
app.use("/upload", apiLimiter);
app.use("/query", apiLimiter);
app.use("/resume", apiLimiter);

const upload = multer({ storage: multer.memoryStorage() });

// Endpoint 1: Upload PDF (Ingestion)
app.post("/upload", requireAuth(), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const pdfData = await pdfParse(req.file.buffer);
    const text = pdfData.text;
    const docId = `doc-${Date.now()}`;

    // Save to database
    await prisma.document.create({
      data: {
        docId: docId,
        filename: req.file.originalname,
        userId: getAuth(req).userId,
      }
    });

    // Invoke LangGraph Ingestion
    const initialState = {
      pdfText: text,
      docId: docId,
      nextStep: "start",
    };

    const result = await ragWorkflow.invoke(initialState);
    res.json({ message: "Document ingested successfully", docId, state: result });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 2: Query (Retrieval - Pauses for HITL)
app.post("/query", requireAuth(), async (req, res) => {
  try {
    const { query, k_value, docId } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    const initialState = {
      query,
      docId: docId || "default",
      k_value: k_value || 4,
      nextStep: "start",
    };

    // Save user message to DB
    try {
      await prisma.message.create({
        data: { role: "user", content: query, documentId: initialState.docId },
      });
    } catch (e) {
      console.error("DB Error saving message:", e);
    }

    const result = await ragWorkflow.invoke(initialState);
    // Returns the state including retrieved context
    res.json({ message: "Context retrieved", state: result });
  } catch (error) {
    console.error("Query Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 3: Resume (Generation)
app.post("/resume", requireAuth(), async (req, res) => {
  try {
    const { state, prunedChunks } = req.body;
    if (!state) return res.status(400).json({ error: "State is required" });

    // If frontend passed prunedChunks, override the state's context
    if (prunedChunks) {
      state.context = prunedChunks;
    }

    // Force the router to go to the generation node
    state.nextStep = "resume_generate";

    // The frontend sends back the state with the user's potentially modified context
    const result = await ragWorkflow.invoke(state);

    // Save AI response to DB
    try {
      const messages = result.messages || [];
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && state.docId) {
        await prisma.message.create({
          data: { role: "assistant", content: lastMessage.content, documentId: state.docId },
        });
      }
    } catch (e) {
      console.error("DB Error saving AI response:", e);
    }

    res.json({ state: result });
  } catch (error) {
    console.error("Resume Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 4: Get Documents
app.get("/documents", requireAuth(), async (req, res) => {
  try {
    const docs = await prisma.document.findMany({
      where: { userId: getAuth(req).userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 5: Get Messages for a Document
app.get("/messages/:docId", requireAuth(), async (req, res) => {
  try {
    const { docId } = req.params;
    const messages = await prisma.message.findMany({
      where: { documentId: docId },
      orderBy: { createdAt: "asc" },
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 6: Delete Document
app.delete("/documents/:docId", requireAuth(), async (req, res) => {
  try {
    const { docId } = req.params;
    
    // Check ownership
    const doc = await prisma.document.findUnique({ where: { docId } });
    if (doc && doc.userId !== getAuth(req).userId) {
       return res.status(403).json({ error: "Unauthorized" });
    }

    // Delete from SQLite (cascades to messages)
    await prisma.document.delete({ where: { docId } });
    
    // Delete from Pinecone
    try {
      const pc = new Pinecone();
      const index = pc.Index(process.env.PINECONE_INDEX_NAME);
      await index.namespace(docId).deleteAll();
    } catch (e) {
      console.error("Failed to delete Pinecone namespace", e);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
