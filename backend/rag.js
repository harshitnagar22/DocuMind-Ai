import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeEmbeddings } from "@langchain/pinecone";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import dotenv from "dotenv";

dotenv.config();

// Graph State Definition
export const GraphState = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  pdfText: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  docId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "default",
  }),
  query: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  context: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  generation: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  nextStep: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "start",
  }),
  k_value: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => 4,
  }),
});

// Initialize Pinecone
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const indexName = process.env.PINECONE_INDEX_NAME || "rag-index";
const pineconeIndex = pc.index(indexName);

// Initialize Embeddings
const embeddings = new PineconeEmbeddings({
  model: "multilingual-e5-large", // standard pinecone serverless embedding model
  pineconeApiEnv: process.env.PINECONE_API_KEY,
});

// Initialize LLM (Gemini 2.5 Flash)
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  maxOutputTokens: 2048,
});

// Nodes
const ingestNode = async (state) => {
  console.log("--- INGESTION NODE ---");
  if (!state.pdfText) return { nextStep: "error" };

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const texts = await textSplitter.splitText(state.pdfText);
  const metadata = texts.map((t, i) => ({ id: `chunk-${Date.now()}-${i}`, text: t }));
  
  // Create embeddings via PineconeEmbeddings (which uses Inference API behind the scenes)
  const vectors = await embeddings.embedDocuments(texts);
  
  const records = vectors.map((values, i) => ({
    id: metadata[i].id,
    values,
    metadata: { text: metadata[i].text },
  }));

  // Batch upsert (in chunks of 100 for safety) using namespace
  const ns = pineconeIndex.namespace(state.docId);
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    await ns.upsert(batch);
  }

  return { nextStep: "ingested", messages: [{ role: "system", content: "Document successfully ingested." }] };
};

const retrieveNode = async (state) => {
  console.log("--- RETRIEVAL NODE ---");
  if (!state.query) return { nextStep: "error" };

  const queryVector = await embeddings.embedQuery(state.query);
  const ns = pineconeIndex.namespace(state.docId);
  const searchResults = await ns.query({
    vector: queryVector,
    topK: state.k_value || 4,
    includeMetadata: true,
  });

  const context = searchResults.matches.map((match) => ({
    id: match.id,
    score: match.score,
    text: match.metadata.text,
  }));

  return { context, nextStep: "retrieved" };
};

const generateNode = async (state) => {
  console.log("--- GENERATION NODE ---");
  
  const contextStr = state.context.map(c => c.text).join("\n\n");
  const prompt = `You are the Generation Agent. Your goal is to provide a highly accurate and educational answer to the user's query based strictly on the provided context.

**Context:**
${contextStr}

**User Query:**
${state.query}

**Instructions:**
1. Analyze the user's query and the provided context chunks.
2. Formulate a comprehensive answer using *only* the information found in the context.
3. If the context does not contain the answer, politely inform the user.
4. Format your response cleanly using Markdown.`;

  const response = await llm.invoke([{ role: "user", content: prompt }]);
  
  return { generation: response.content, nextStep: "generated", messages: [{ role: "assistant", content: response.content }] };
};

// Supervisor Router Function
const supervisorRouter = (state) => {
  if (state.pdfText && state.nextStep === "start") {
    return "ingest";
  }
  if (state.query && state.nextStep === "start") {
    return "retrieve";
  }
  if (state.nextStep === "retrieved") {
    // In HITL, we might route to END here instead to allow inspection.
    // Let's route to a "inspection" node or just END, and then from END we can resume.
    // For educational workflow: retrieve -> END. Then resume -> generate.
    return "hitl_pause";
  }
  if (state.nextStep === "resume_generate") {
    return "generate";
  }
  return "__end__";
};

// Build the Graph
const workflow = new StateGraph(GraphState)
  .addNode("ingest", ingestNode)
  .addNode("retrieve", retrieveNode)
  .addNode("generate", generateNode)
  .addNode("hitl_pause", (state) => {
    console.log("--- HITL PAUSE ---");
    return state; // Just returns state to hit END
  })
  .addConditionalEdges("__start__", supervisorRouter, {
    ingest: "ingest",
    retrieve: "retrieve",
    hitl_pause: "__end__", // Pause and return to user
    generate: "generate",
    __end__: "__end__"
  })
  .addEdge("ingest", "__end__")
  .addEdge("retrieve", "hitl_pause") // retrieve always pauses for HITL
  .addEdge("hitl_pause", "__end__")
  .addEdge("generate", "__end__");

export const app = workflow.compile();
