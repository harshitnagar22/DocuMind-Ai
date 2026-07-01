# DocuMind AI 🧠📄

**Your intelligent document explorer.** Upload your PDFs and instantly retrieve answers, insights, and summaries using advanced Retrieval-Augmented Generation (RAG) powered by Google Gemini.

Live Demo: [DocuMind AI](https://docu-mind-ai-mu.vercel.app)

---

## 🚀 Features
- **Intelligent RAG System:** Built with LangGraph, allowing for highly accurate, context-aware answers extracted directly from your uploaded documents.
- **Human-In-The-Loop (HITL):** Inspect exactly which document chunks the AI is using to answer your question and prune irrelevant context before generation.
- **Isolated User Storage:** Clerk Authentication + PostgreSQL ensures that your documents and chat history are 100% private to your account.
- **Beautiful Glassmorphism UI:** Built with Next.js and Framer Motion for a fluid, premium user experience.

---

## 🛠️ Technology Stack

### Frontend (`/frontend`)
- **Framework:** Next.js (React)
- **Styling:** Vanilla CSS Modules with Glassmorphism aesthetic
- **Authentication:** Clerk (`@clerk/nextjs`)
- **Animations:** Framer Motion
- **Markdown Parsing:** `react-markdown` & `remark-gfm`

### Backend (`/backend`)
- **Server:** Node.js + Express
- **AI/LLM:** Google Gemini 2.5 Flash (`@langchain/google-genai`)
- **Agent Orchestration:** LangGraph (`@langchain/langgraph`)
- **Vector Database:** Pinecone (for semantic search & document embeddings)
- **Relational Database:** PostgreSQL on Supabase (managed via Prisma ORM)
- **Auth Middleware:** `@clerk/express`

---

## 💻 Running Locally

### Prerequisites
You will need API keys for the following services:
- **Clerk** (Publishable & Secret keys)
- **Google Gemini API**
- **Pinecone** (API Key & Index Name)
- **Supabase** (PostgreSQL Connection String)

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/documind-ai.git
cd documind-ai
```

### 2. Setup the Backend
Open a terminal and navigate to the backend:
```bash
cd backend
npm install
```

Create a `.env` file in the `backend` folder:
```env
PORT=4000
GEMINI_API_KEY="your_gemini_key"
PINECONE_API_KEY="your_pinecone_key"
PINECONE_INDEX_NAME="your_index_name"
CLERK_PUBLISHABLE_KEY="your_clerk_publishable_key"
CLERK_SECRET_KEY="your_clerk_secret_key"
DATABASE_URL="postgresql://user:password@hostname:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://user:password@hostname:5432/postgres"
FRONTEND_URL="http://localhost:3000"
```

Sync the database schema and start the server:
```bash
npx prisma db push
npm start
```

### 3. Setup the Frontend
Open a new terminal and navigate to the frontend:
```bash
cd frontend
npm install
```

Create a `.env` file in the `frontend` folder:
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="your_clerk_publishable_key"
CLERK_SECRET_KEY="your_clerk_secret_key"
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

Start the Next.js development server:
```bash
npm run dev
```

### 4. Open the App
Visit `http://localhost:3000` in your browser.

---

## 🌐 Deployment
- **Frontend:** Optimized for zero-config deployment on [Vercel](https://vercel.com).
- **Backend:** Designed to run continuously on [Render.com](https://render.com) as a Web Service. Ensure `FRONTEND_URL` is set in the Render environment variables for CORS protection.
