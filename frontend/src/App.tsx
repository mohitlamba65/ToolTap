import React, { useState, useEffect } from 'react';
import { Bot, MessageSquare, Zap, Shield, ChevronRight, Settings, Check } from 'lucide-react';
import { motion } from 'framer-motion';

const GithubIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

function App() {
  const [provider, setProvider] = useState<string>('meta');
  const [loading, setLoading] = useState(true);

  // Fetch initial provider from backend
  useEffect(() => {
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
  }, []);

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

  return (
    <div className="min-h-screen font-sans overflow-hidden">
      {/* Navbar */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="bg-emerald-500 p-2 rounded-xl text-white">
                <Bot size={24} />
              </div>
              <span className="text-xl font-bold text-slate-900">WhatsApp Agent</span>
            </div>
            
            {/* Provider Switcher */}
            <div className="hidden md:flex items-center gap-3 bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button 
                onClick={() => switchProvider('meta')}
                disabled={loading}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all flex items-center gap-2 ${provider === 'meta' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Meta Cloud API {provider === 'meta' && <Check size={14} />}
              </button>
              <button 
                onClick={() => switchProvider('twilio')}
                disabled={loading}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all flex items-center gap-2 ${provider === 'twilio' ? 'bg-white shadow-sm text-red-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Twilio {provider === 'twilio' && <Check size={14} />}
              </button>
            </div>

            <div className="flex gap-4">
              <a href="https://github.com" target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-900 transition-colors">
                <GithubIcon size={24} />
              </a>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 mb-6"
          >
            Your AI Agent, <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-emerald-600">
              Directly on WhatsApp.
            </span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="max-w-2xl mx-auto text-xl text-slate-600 mb-10"
          >
            Execute commands, query data, and automate workflows effortlessly via WhatsApp. 
            Currently running on <strong className={provider === 'meta' ? 'text-blue-600' : 'text-red-600'}>{provider === 'meta' ? 'Meta Cloud API' : 'Twilio'}</strong>.
          </motion.p>
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex justify-center gap-4"
          >
            <a href="#demo" className="px-8 py-4 bg-slate-900 text-white rounded-full font-semibold hover:bg-slate-800 transition-all flex items-center gap-2 shadow-xl shadow-slate-900/20">
              Try the Demo <ChevronRight size={20} />
            </a>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-slate-50 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Settings size={32} className="text-emerald-500" />}
              title="Multi-Provider Engine"
              description="Seamlessly switch between Meta and Twilio in real-time without restarting your server."
            />
            <FeatureCard 
              icon={<Zap size={32} className="text-emerald-500" />}
              title="Agentic Reasoning"
              description="Powered by LangChain, the bot understands complex intents and sequentially executes necessary tools."
            />
            <FeatureCard 
              icon={<Shield size={32} className="text-emerald-500" />}
              title="Secure Webhooks"
              description="Integrates with official APIs using cryptographic validation and robust session management."
            />
          </div>
        </div>
      </section>

      {/* Interactive Demo Section */}
      <section id="demo" className="py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="bg-slate-900 rounded-3xl p-8 md:p-16 flex flex-col md:flex-row items-center justify-between gap-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/20 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
          
          <div className="flex-1 z-10">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">See it in action.</h2>
            <p className="text-slate-400 text-lg mb-8">
              Connect the agent to your workspace. Simply scan the QR code or click the link to start chatting with your enterprise AI on WhatsApp.
            </p>
            <div className="inline-flex items-center gap-3 px-6 py-3 bg-white/10 rounded-full text-white backdrop-blur-md border border-white/10">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></span>
              Provider: <strong className="uppercase">{provider}</strong>
            </div>
          </div>

          <div className="flex-1 w-full max-w-sm relative z-10">
            {/* Mock Phone UI */}
            <div className="bg-white rounded-[2.5rem] p-4 shadow-2xl border-8 border-slate-800 h-[600px] flex flex-col relative overflow-hidden">
              <div className="bg-emerald-600 -mx-4 -mt-4 px-4 py-6 rounded-t-[2rem] flex items-center gap-3 text-white mb-4 z-10 shadow-md">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <Bot size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg leading-tight">AI Assistant</h3>
                  <p className="text-xs text-emerald-100">online via {provider === 'meta' ? 'Meta' : 'Twilio'}</p>
                </div>
              </div>
              
              <div className="flex-1 flex flex-col gap-4 overflow-y-auto px-2 pb-16 z-0" style={{backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", backgroundSize: 'cover', opacity: 0.9}}>
                <div className="mt-4 text-center">
                  <span className="bg-amber-100 text-amber-800 text-[10px] px-2 py-1 rounded-lg uppercase tracking-wider font-semibold">Today</span>
                </div>
                <Message text="Hi, can you search the web for tech news?" isUser={true} />
                <Message text="I'll search for that using Tavily..." isUser={false} />
                <Message text="Here are the top stories today: 1. AI Agents hit production 2. Tech market updates." isUser={false} />
              </div>

              <div className="absolute bottom-4 left-4 right-4 bg-white rounded-full py-3 px-4 flex items-center gap-2 text-slate-400 shadow-md border border-slate-100">
                <div className="w-6 h-6 rounded-full border-2 border-slate-300"></div>
                <span className="text-sm flex-1">Type a message</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-12 px-4 text-center text-slate-500">
        <p>© {new Date().getFullYear()} WhatsApp AI Agent. Built for scalability.</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <motion.div 
      whileHover={{ y: -5 }}
      className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg transition-all"
    >
      <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mb-6">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-slate-900 mb-3">{title}</h3>
      <p className="text-slate-600 leading-relaxed">
        {description}
      </p>
    </motion.div>
  );
}

function Message({ text, isUser }: { text: string, isUser: boolean }) {
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} z-10`}>
      <div className={`max-w-[85%] rounded-xl px-4 py-2 text-sm shadow-sm relative ${
        isUser 
          ? 'bg-[#dcf8c6] text-slate-800 rounded-tr-sm' 
          : 'bg-white border border-slate-100 text-slate-800 rounded-tl-sm'
      }`}>
        {text}
      </div>
    </div>
  );
}

export default App;
