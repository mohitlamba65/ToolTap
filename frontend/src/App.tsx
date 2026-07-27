import React, { useState, useEffect } from 'react';
import { Bot, MessageSquare, Zap, ChevronRight, Check, Database, BookOpen, Plus, Trash2, Sparkles, FileText, Search } from 'lucide-react';
import { motion } from 'framer-motion';

interface Chatbot {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  triggerKeywords: string[];
  kbCollectionName: string;
  enabled: boolean;
}

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'chatbots' | 'rag_test'>('overview');
  const [provider, setProvider] = useState<string>('meta');
  const [loading, setLoading] = useState(true);
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);

  // Form states for creating a new chatbot
  const [newBotName, setNewBotName] = useState('');
  const [newBotDesc, setNewBotDesc] = useState('');
  const [newBotPrompt, setNewBotPrompt] = useState('');
  const [newBotTriggers, setNewBotTriggers] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Ingestion modal states
  const [ingestBotId, setIngestBotId] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState('general');
  const [docContent, setDocContent] = useState('');
  const [ingestStatus, setIngestStatus] = useState('');

  // RAG Test states
  const [selectedTestBot, setSelectedTestBot] = useState<string>('');
  const [testQuery, setTestQuery] = useState('');
  const [ragResult, setRagResult] = useState<any>(null);
  const [testingRag, setTestingRag] = useState(false);

  // Fetch initial provider and chatbots from backend
  useEffect(() => {
    fetchProvider();
    fetchChatbots();
  }, []);

  const fetchProvider = () => {
    fetch('http://localhost:3000/api/provider')
      .then(res => res.json())
      .then(data => {
        setProvider(data.provider);
        setLoading(false);
      })
      .catch(err => {
        console.error("Could not fetch provider:", err);
        setLoading(false);
      });
  };

  const fetchChatbots = () => {
    fetch('http://localhost:3000/api/chatbots')
      .then(res => res.json())
      .then(data => {
        if (data.chatbots) {
          setChatbots(data.chatbots);
          if (data.chatbots.length > 0 && !selectedTestBot) {
            setSelectedTestBot(data.chatbots[0].id);
          }
        }
      })
      .catch(err => console.error("Error fetching chatbots:", err));
  };

  const switchProvider = async (newProvider: string) => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProvider })
      });
      const data = await res.json();
      if (data.success) {
        setProvider(data.provider);
      }
    } catch (err) {
      console.error("Failed to switch provider:", err);
    } finally {
      setLoading(false);
    }
  };

  const createChatbot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBotName || !newBotPrompt) return;

    try {
      const res = await fetch('http://localhost:3000/api/chatbots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBotName,
          description: newBotDesc,
          systemPrompt: newBotPrompt,
          triggerKeywords: newBotTriggers.split(',').map(s => s.trim()).filter(Boolean),
          kbCollectionName: `kb_${newBotName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
        })
      });
      const data = await res.json();
      if (data.success) {
        fetchChatbots();
        setShowCreateModal(false);
        setNewBotName('');
        setNewBotDesc('');
        setNewBotPrompt('');
        setNewBotTriggers('');
      }
    } catch (err) {
      console.error("Failed to create chatbot:", err);
    }
  };

  const deleteChatbot = async (id: string) => {
    if (!confirm("Are you sure you want to delete this chatbot?")) return;
    try {
      await fetch(`http://localhost:3000/api/chatbots/${id}`, { method: 'DELETE' });
      fetchChatbots();
    } catch (err) {
      console.error("Failed to delete chatbot:", err);
    }
  };

  const submitIngestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingestBotId || !docTitle || !docContent) return;

    const bot = chatbots.find(b => b.id === ingestBotId);
    if (!bot) return;

    setIngestStatus('Processing structure-aware chunking & vector upsert...');
    try {
      const res = await fetch('http://localhost:3000/api/kb/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionName: bot.kbCollectionName,
          content: docContent,
          source: `${docTitle.toLowerCase().replace(/\s+/g, '_')}.md`,
          title: docTitle,
          category: docCategory,
          tags: ['dashboard_upload']
        })
      });
      const data = await res.json();
      if (data.success) {
        setIngestStatus(`Success! Ingested ${data.result.chunksCount} structured chunks into Qdrant collection.`);
        setTimeout(() => {
          setIngestBotId(null);
          setDocTitle('');
          setDocContent('');
          setIngestStatus('');
        }, 2000);
      }
    } catch (err) {
      setIngestStatus('Ingestion failed. See console.');
    }
  };

  const runRagTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTestBot || !testQuery) return;

    setTestingRag(true);
    setRagResult(null);

    try {
      const res = await fetch('http://localhost:3000/api/kb/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatbotId: selectedTestBot,
          query: testQuery
        })
      });
      const data = await res.json();
      if (data.success) {
        setRagResult(data.result);
      }
    } catch (err) {
      console.error("RAG test error:", err);
    } finally {
      setTestingRag(false);
    }
  };

  return (
    <div className="min-h-screen font-sans bg-slate-900 text-slate-100 selection:bg-emerald-500 selection:text-white">
      {/* Navbar */}
      <nav className="fixed top-0 w-full bg-slate-900/90 backdrop-blur-md z-50 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-2.5 rounded-xl text-white shadow-lg shadow-emerald-500/20">
                <Bot size={22} />
              </div>
              <span className="text-xl font-black tracking-tight text-white">ToolTap <span className="text-emerald-400 font-normal">Agent Hub</span></span>
            </div>
            
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
              <button 
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'overview' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
              >
                Overview
              </button>
              <button 
                onClick={() => setActiveTab('chatbots')}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'chatbots' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
              >
                <BookOpen size={16} /> Knowledge Base Chatbots
              </button>
              <button 
                onClick={() => setActiveTab('rag_test')}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'rag_test' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
              >
                <Sparkles size={16} /> RAG Tester
              </button>
            </div>

            {/* Provider Switcher */}
            <div className="hidden md:flex items-center gap-2 bg-slate-800 p-1 rounded-xl border border-slate-700">
              <button 
                onClick={() => switchProvider('meta')}
                disabled={loading}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${provider === 'meta' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Meta {provider === 'meta' && <Check size={12} />}
              </button>
              <button 
                onClick={() => switchProvider('twilio')}
                disabled={loading}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${provider === 'twilio' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Twilio {provider === 'twilio' && <Check size={12} />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Body */}
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {activeTab === 'overview' && (
          <div>
            {/* Hero Section */}
            <section className="py-12 text-center">
              <motion.h1 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl md:text-6xl font-black tracking-tight text-white mb-6"
              >
                Decoupled AI Engine with <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400">
                  Semantic RAG & WhatsApp Orchestration
                </span>
              </motion.h1>
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="max-w-3xl mx-auto text-lg text-slate-400 mb-10 leading-relaxed"
              >
                Intelligent routing between real-time action tools (Search, CRM, Weather, Email) and custom ElevenLabs-style Knowledge Base chatbots powered by Qdrant vector search and structure-aware chunking.
              </motion.p>
            </section>

            {/* Feature Cards Grid */}
            <div className="grid md:grid-cols-3 gap-6 mb-16">
              <FeatureCard 
                icon={<Database size={28} className="text-emerald-400" />}
                title="Structure-Aware Semantic RAG"
                description="Preserves heading paths (#, ##, ###) and metadata filters before Qdrant vector search for 100% grounded answers."
              />
              <FeatureCard 
                icon={<Zap size={28} className="text-teal-400" />}
                title="LangGraph Router & Action Tools"
                description="Dynamically decides whether to execute real-time action tools (Tavily, Brevo Email, CRM) or route to Knowledge Base bots."
              />
              <FeatureCard 
                icon={<MessageSquare size={28} className="text-cyan-400" />}
                title="Rich WhatsApp Formatting"
                description="Renders responses as Quick Reply Buttons (<=3 options), Scrollable Lists (>3 options), or Media payloads."
              />
            </div>

            {/* Live WhatsApp Simulator Preview */}
            <div className="bg-slate-800/60 border border-slate-700 rounded-3xl p-8 md:p-12 flex flex-col md:flex-row items-center gap-10">
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-white mb-4">Capability-Aware WhatsApp Router</h2>
                <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                  When a user asks <code className="bg-slate-900 text-emerald-400 px-2 py-0.5 rounded font-mono">"What can you do?"</code>, the agent lists all Action Tools AND active Custom Knowledge Bases. When they send a keyword matching a KB bot, it triggers Qdrant Semantic Retrieval with citations!
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setActiveTab('chatbots')} className="px-6 py-3 bg-emerald-500 text-white font-semibold rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2">
                    Manage Knowledge Bases <ChevronRight size={18} />
                  </button>
                  <button onClick={() => setActiveTab('rag_test')} className="px-6 py-3 bg-slate-700 text-white font-semibold rounded-xl hover:bg-slate-600 transition-all flex items-center gap-2">
                    Test RAG Pipeline <Sparkles size={18} />
                  </button>
                </div>
              </div>

              {/* Simulator Card */}
              <div className="w-full md:w-96 bg-slate-950 rounded-2xl border border-slate-800 p-4 shadow-2xl">
                <div className="bg-emerald-600 -mx-4 -mt-4 px-4 py-3 rounded-t-2xl flex items-center gap-3 text-white mb-4">
                  <Bot size={20} />
                  <div>
                    <h4 className="font-bold text-sm">ToolTap Orchestrator</h4>
                    <p className="text-[10px] text-emerald-100">Meta / Twilio • Qdrant RAG Enabled</p>
                  </div>
                </div>
                <div className="space-y-3 text-xs">
                  <div className="bg-slate-800 p-2.5 rounded-lg text-slate-200 ml-6">
                    What can you do?
                  </div>
                  <div className="bg-emerald-950 border border-emerald-800/50 p-2.5 rounded-lg text-emerald-200 mr-4">
                    🤖 <strong>Capabilities Overview:</strong><br />
                    • ⚡ <strong>Action Tools</strong>: Web Search, Weather, Brevo Email, CRM, Calendar.<br />
                    • 📚 <strong>Knowledge Bases</strong>: ToolTap Support, Custom Bots.
                  </div>
                  <div className="bg-slate-800 p-2.5 rounded-lg text-slate-200 ml-6">
                    How does direct database CRM setup work?
                  </div>
                  <div className="bg-emerald-950 border border-emerald-800/50 p-2.5 rounded-lg text-emerald-200 mr-4">
                    Direct Postgres CRM requires your database connection URL and table name. [Source: ToolTap Guide &gt; CRM Setup]
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Custom Knowledge Base Chatbots */}
        {activeTab === 'chatbots' && (
          <div>
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-3xl font-black text-white">Custom Knowledge Base Chatbots</h2>
                <p className="text-slate-400 text-sm mt-1">Configure ElevenLabs-style chatbots with custom prompts, trigger keywords, and Qdrant vector storage.</p>
              </div>
              <button 
                onClick={() => setShowCreateModal(true)}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
              >
                <Plus size={18} /> Create Custom Chatbot
              </button>
            </div>

            {/* Chatbots Grid */}
            <div className="grid md:grid-cols-2 gap-6">
              {chatbots.map(bot => (
                <div key={bot.id} className="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-6 hover:border-emerald-500/50 transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <BookOpen size={20} className="text-emerald-400" /> {bot.name}
                      </h3>
                      <button onClick={() => deleteChatbot(bot.id)} className="text-slate-500 hover:text-red-400 p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <p className="text-slate-300 text-sm mb-4 leading-relaxed">{bot.description}</p>
                    
                    <div className="bg-slate-900/80 rounded-xl p-3 mb-4 border border-slate-800 text-xs font-mono text-slate-400">
                      <span className="text-emerald-400 font-semibold block mb-1">System Prompt:</span>
                      {bot.systemPrompt}
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-4">
                      <span className="text-xs text-slate-400 font-semibold mr-1">Triggers:</span>
                      {bot.triggerKeywords.map((kw, i) => (
                        <span key={i} className="bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 text-[11px] px-2 py-0.5 rounded-md font-mono">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-700/60 flex justify-between items-center">
                    <span className="text-xs text-slate-400 font-mono">Collection: <strong className="text-slate-200">{bot.kbCollectionName}</strong></span>
                    <button 
                      onClick={() => setIngestBotId(bot.id)}
                      className="px-3.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-emerald-300 font-semibold text-xs rounded-lg transition-all flex items-center gap-1.5"
                    >
                      <FileText size={14} /> Ingest Knowledge Document
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal: Create Chatbot */}
            {showCreateModal && (
              <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
                  <h3 className="text-xl font-bold text-white mb-4">Create New Knowledge Base Chatbot</h3>
                  <form onSubmit={createChatbot} className="space-y-4 text-sm">
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">Chatbot Name</label>
                      <input 
                        type="text" 
                        value={newBotName} 
                        onChange={e => setNewBotName(e.target.value)}
                        placeholder="e.g. Return Policy & Warranty Bot" 
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-emerald-500 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">Description</label>
                      <input 
                        type="text" 
                        value={newBotDesc} 
                        onChange={e => setNewBotDesc(e.target.value)}
                        placeholder="What topic or product line does this bot cover?" 
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">System Prompt</label>
                      <textarea 
                        value={newBotPrompt} 
                        onChange={e => setNewBotPrompt(e.target.value)}
                        placeholder="You are an AI assistant specialized in..." 
                        rows={3}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-emerald-500 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">Trigger Keywords (comma separated)</label>
                      <input 
                        type="text" 
                        value={newBotTriggers} 
                        onChange={e => setNewBotTriggers(e.target.value)}
                        placeholder="warranty, return, refund, policy" 
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                      <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600">Cancel</button>
                      <button type="submit" className="px-5 py-2 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600">Save Chatbot</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Modal: Document Ingestion */}
            {ingestBotId && (
              <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-xl w-full p-6 shadow-2xl">
                  <h3 className="text-xl font-bold text-white mb-2">Ingest Knowledge Base Document</h3>
                  <p className="text-slate-400 text-xs mb-4">Structure-aware chunking parses headings (#, ##, ###) and attaches metadata payload before Qdrant vector upsert.</p>

                  <form onSubmit={submitIngestion} className="space-y-4 text-sm">
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">Document Title</label>
                      <input 
                        type="text" 
                        value={docTitle} 
                        onChange={e => setDocTitle(e.target.value)}
                        placeholder="e.g. Product Warranty Specification 2026" 
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-emerald-500 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">Category</label>
                      <input 
                        type="text" 
                        value={docCategory} 
                        onChange={e => setDocCategory(e.target.value)}
                        placeholder="warranty_policies" 
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">Content (Markdown / Text with headings)</label>
                      <textarea 
                        value={docContent} 
                        onChange={e => setDocContent(e.target.value)}
                        placeholder="# Warranty Terms&#10;## Exclusions&#10;Water damage is excluded..." 
                        rows={6}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none"
                        required
                      />
                    </div>

                    {ingestStatus && (
                      <div className="p-3 bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs rounded-lg font-mono">
                        {ingestStatus}
                      </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                      <button type="button" onClick={() => setIngestBotId(null)} className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600">Cancel</button>
                      <button type="submit" className="px-5 py-2 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600">Ingest to Qdrant</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: RAG Tester */}
        {activeTab === 'rag_test' && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-8">
              <h2 className="text-3xl font-black text-white">Semantic RAG Interactive Tester</h2>
              <p className="text-slate-400 text-sm mt-1">Test candidate retrieval, metadata filtering, multi-factor reranking, and grounded answer generation.</p>
            </div>

            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 mb-8">
              <form onSubmit={runRagTest} className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-slate-300 text-xs font-bold uppercase mb-1">Select Knowledge Base Chatbot</label>
                    <select 
                      value={selectedTestBot}
                      onChange={e => setSelectedTestBot(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none font-semibold text-sm"
                    >
                      {chatbots.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-slate-300 text-xs font-bold uppercase mb-1">Test User Query</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={testQuery}
                        onChange={e => setTestQuery(e.target.value)}
                        placeholder="e.g. How does direct database CRM setup work?"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none text-sm"
                        required
                      />
                      <button 
                        type="submit" 
                        disabled={testingRag}
                        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-all flex items-center gap-2 disabled:opacity-50"
                      >
                        {testingRag ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <><Search size={18} /> Test RAG</>}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>

            {/* Results Display */}
            {ragResult && (
              <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                {/* Answer Card */}
                <div className="bg-slate-800 border border-emerald-500/50 rounded-2xl p-6 shadow-xl">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold uppercase text-emerald-400 tracking-wider flex items-center gap-1.5">
                      <Sparkles size={16} /> Grounded Gemini Response
                    </span>
                    {ragResult.abstained && (
                      <span className="bg-amber-950 text-amber-300 border border-amber-800 text-[10px] px-2.5 py-0.5 rounded-full font-semibold">
                        Abstained (Insufficient Evidence)
                      </span>
                    )}
                  </div>
                  <div className="text-slate-100 text-base leading-relaxed font-sans whitespace-pre-wrap">
                    {ragResult.answer}
                  </div>
                </div>

                {/* Sources & Provenance Card */}
                {ragResult.sources && ragResult.sources.length > 0 && (
                  <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6">
                    <h4 className="text-sm font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
                      <BookOpen size={16} className="text-teal-400" /> Retrieved Sources &amp; Multi-Factor Scores (Top 5 Reranked)
                    </h4>
                    <div className="space-y-3">
                      {ragResult.sources.map((src: any, idx: number) => (
                        <div key={idx} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 flex justify-between items-center text-xs">
                          <div>
                            <span className="text-emerald-400 font-bold font-mono mr-2">[{idx + 1}]</span>
                            <strong className="text-white text-sm">{src.title}</strong>
                            <span className="text-slate-400 block mt-0.5">Section Path: <code className="text-slate-300 font-mono">{src.heading_path}</code></span>
                          </div>
                          <div className="text-right">
                            <span className="bg-teal-950 text-teal-300 border border-teal-800 font-mono font-bold px-2.5 py-1 rounded-lg block">
                              Score: {Math.round(src.score * 100)}%
                            </span>
                            <span className="text-[10px] text-slate-500 mt-1 block">Effective: {src.effective_date}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700/80 hover:border-emerald-500/50 transition-all"
    >
      <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mb-4 border border-slate-700">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">
        {description}
      </p>
    </motion.div>
  );
}

export default App;
