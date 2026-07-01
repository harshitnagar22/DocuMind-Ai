"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function ChatPage() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { isLoaded, userId, getToken } = useAuth();
  
  // Mobile UI State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // HITL State
  const [inspectionMode, setInspectionMode] = useState(false);
  const [retrievedContext, setRetrievedContext] = useState<any[]>([]);
  const [currentQuery, setCurrentQuery] = useState("");
  const [currentDocId, setCurrentDocId] = useState<string>("default");
  const [graphState, setGraphState] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/documents`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadDocumentChat = async (docId: string) => {
    setCurrentDocId(docId);
    setInspectionMode(false);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/messages/${docId}`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const msgs = await res.json();
        setMessages(msgs.map((m: any) => ({ role: m.role, content: m.content })));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const deleteDocument = async (e: any, docId: string) => {
    e.stopPropagation();
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/documents/${docId}`, { 
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        if (currentDocId === docId) {
          setCurrentDocId("default");
          setMessages([]);
        }
        fetchDocuments();
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, inspectionMode]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMessages((prev) => [...prev, { role: "system", content: `Uploading ${file.name}...` }]);
    setIsProcessing(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        if (data.docId) setCurrentDocId(data.docId);
        setMessages((prev) => [...prev, { role: "system", content: "Document successfully vectorized and stored in Pinecone!" }]);
        fetchDocuments(); // Refresh sidebar
      } else {
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${data.error}` }]);
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: "system", content: `Connection error: ${error.message}` }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const query = input;
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setInput("");
    setIsProcessing(true);
    setCurrentQuery(query);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/query`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ query, docId: currentDocId }),
      });
      const data = await res.json();
      
      if (res.ok && data.state?.context) {
        setGraphState(data.state);
        setRetrievedContext(data.state.context.map((c: any) => ({ ...c, selected: true })));
        setInspectionMode(true); // Trigger HITL pause
      } else {
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${data.error || "Failed to retrieve"}` }]);
        setIsProcessing(false);
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: "system", content: `Connection error: ${error.message}` }]);
      setIsProcessing(false);
    }
  };

  const handleResume = async () => {
    setInspectionMode(false);
    setMessages((prev) => [...prev, { role: "system", content: "Synthesizing answer using Gemini 2.5 Flash..." }]);

    try {
      const prunedChunks = retrievedContext.filter(c => c.selected);
      const cleanPrunedChunks = prunedChunks.map(({ selected, ...rest }) => rest);
      
      const token = await getToken();
      const res = await fetch(`${API_URL}/resume`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ state: graphState, prunedChunks: cleanPrunedChunks }),
      });
      const data = await res.json();
      
      if (res.ok && data.state?.generation) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.state.generation }]);
      } else {
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${data.error || "Failed to generate"}` }]);
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: "system", content: `Connection error: ${error.message}` }]);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isLoaded) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f8fafc' }}>Loading...</div>;
  }

  if (!userId) {
    return (
      <div className={styles.heroContainer}>
        <motion.div 
          className={styles.heroContent}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className={styles.heroTitle}>DocuMind AI</h1>
          <p className={styles.heroSubtitle}>
            Your intelligent document explorer. Upload your PDFs and instantly retrieve answers, insights, and summaries using advanced AI.
          </p>
          <SignInButton mode="modal">
            <button className={styles.heroButton}>
              Get Started
            </button>
          </SignInButton>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={styles.appLayout}>
      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className={styles.sidebarOverlay} 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className={`${styles.sidebar} ${isSidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarTitle}>
          My Documents
          <button 
            className={styles.closeSidebarBtn} 
            onClick={() => setIsSidebarOpen(false)}
          >
            ✕
          </button>
        </div>
        {documents.length === 0 && <div className={styles.emptySidebar}>No documents yet.</div>}
        {documents.map((doc) => (
          <div 
            key={doc.id} 
            className={`${styles.docItem} ${doc.docId === currentDocId ? styles.docItemActive : ""}`}
            onClick={() => loadDocumentChat(doc.docId)}
          >
            <span className={styles.docName}>{doc.filename}</span>
            <button className={styles.deleteDocBtn} onClick={(e) => deleteDocument(e, doc.docId)}>✕</button>
          </div>
        ))}
      </div>

      <div className={styles.container}>
      <motion.div 
        className={`${styles.chatSection} glass-panel`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className={styles.hamburgerBtn} 
              onClick={() => setIsSidebarOpen(true)}
            >
              ☰
            </button>
            <div className={styles.title}>DocuMind AI</div>
          </div>
          <UserButton />
        </div>

        <div className={styles.messages}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", color: "#64748b", marginTop: "2rem" }}>
              Upload a PDF to begin learning!
            </div>
          )}
          {messages.map((msg, idx) => (
            <motion.div 
              key={idx} 
              className={`${styles.message} ${msg.role === "user" ? styles.userMessage : styles.assistantMessage}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {msg.role === "system" ? <i>{msg.content}</i> : (
                <div className={styles.markdownBody}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              )}
            </motion.div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.inputArea}>
          <label className={styles.fileUpload}>
            <input type="file" accept=".pdf" onChange={handleFileUpload} disabled={isProcessing} />
            📎 Upload PDF
          </label>
          <input 
            type="text" 
            className={styles.textInput} 
            placeholder="Ask a question about your document..." 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={isProcessing}
          />
          <button className={styles.sendButton} onClick={handleSend} disabled={isProcessing || !input.trim()}>
            Send
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {inspectionMode && (
          <motion.div 
            className={`${styles.inspectionPanel} glass-panel`}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
          >
            <div className={styles.panelTitle}>
              🔍 Inspection Mode (HITL)
            </div>
            <p style={{ fontSize: "14px", color: "#64748b" }}>
              The Retrieval Agent found {retrievedContext.length} relevant chunks. Review them below before generating the final answer.
            </p>
            
            <div className={styles.chunkList}>
              {retrievedContext.map((chunk, idx) => (
                <div key={idx} className={styles.chunkCard}>
                  <div className={styles.chunkHeader}>
                    <div className={styles.chunkScore}>Score: {chunk.score?.toFixed(4)}</div>
                    <input 
                      type="checkbox" 
                      checked={chunk.selected} 
                      onChange={(e) => {
                        const newContext = [...retrievedContext];
                        newContext[idx].selected = e.target.checked;
                        setRetrievedContext(newContext);
                      }} 
                      className={styles.chunkCheckbox}
                    />
                  </div>
                  <div className={styles.chunkText}>{chunk.text.substring(0, 150)}...</div>
                </div>
              ))}
            </div>

            <button className={styles.resumeButton} onClick={handleResume}>
              Resume Generation
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </div>
  );
}
