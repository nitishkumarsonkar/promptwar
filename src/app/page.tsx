"use client";

import { useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle2, HeartPulse, Activity, Send, PhoneCall, ShieldAlert, Cpu } from 'lucide-react';

export default function Home() {
  const [text, setText] = useState("");
  const [mockContext, setMockContext] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!text && !imagePreview) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          image: imagePreview,
          mockContext
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to process request");
      }
      
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getUrgencyColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case 'critical': return 'bg-red-500 text-white animate-pulse border-red-400';
      case 'high': return 'bg-orange-500 text-white border-orange-400';
      case 'medium': return 'bg-yellow-500 text-black border-yellow-400';
      case 'low': return 'bg-green-500 text-white border-green-400';
      default: return 'bg-gray-500 text-white border-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-slate-800 pb-6">
          <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
            <Cpu className="text-blue-400 w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Universal Intent Bridge
            </h1>
            <p className="text-slate-400 mt-1">Transform messy inputs into structured, life-saving outcomes.</p>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Input Section */}
          <section className="space-y-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <Activity className="w-32 h-32" />
            </div>

            <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
              Input Signal
            </h2>

            <div className="space-y-4 relative z-10">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Unstructured Input (Text/Voice Data)</label>
                <textarea 
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g., 'my dad fell down, not responding, we are near whitefield road'"
                  className="w-full h-32 bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Visual Context (Optional)</label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 hover:border-blue-500/50 hover:bg-slate-800/50 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all group"
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*"
                    onChange={handleImageUpload}
                  />
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" className="max-h-48 rounded-lg object-contain shadow-md" />
                  ) : (
                    <div className="text-center group-hover:scale-105 transition-transform duration-300">
                      <div className="bg-slate-800 p-3 rounded-full inline-block mb-3 border border-slate-700 text-slate-400 group-hover:text-blue-400 group-hover:border-blue-500/30">
                        <Upload className="w-6 h-6" />
                      </div>
                      <p className="text-sm text-slate-400">Upload accident scene, prescription, or document</p>
                    </div>
                  )}
                </div>
                {imagePreview && (
                  <button onClick={() => setImagePreview(null)} className="text-xs text-red-400 mt-2 hover:underline">
                    Remove Image
                  </button>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Sensor / External Data (Mock Context)</label>
                <input 
                  type="text" 
                  value={mockContext}
                  onChange={(e) => setMockContext(e.target.value)}
                  placeholder="e.g., User Location: 12.9698° N, 77.7499° E | Weather: Heavy Rain"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                />
              </div>

              <button 
                onClick={handleSubmit}
                disabled={loading || (!text && !imagePreview)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium p-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(37,99,235,0.2)] hover:shadow-[0_0_25px_rgba(37,99,235,0.4)]"
              >
                {loading ? (
                  <Activity className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
                {loading ? "Processing Intent..." : "Bridge Knowledge to Action"}
              </button>
            </div>
            
            {error && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </section>

          {/* Results Section */}
          <section className="space-y-6">
            {!result && !loading && (
               <div className="h-full min-h-[400px] border-2 border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center p-8 text-center bg-slate-900/50">
                <HeartPulse className="w-16 h-16 text-slate-700 mb-4" />
                <h3 className="text-lg font-medium text-slate-400">Awaiting Signal</h3>
                <p className="text-sm text-slate-500 max-w-xs mt-2">Submit messy, unstructured data on the left to see the Universal Intent Bridge in action.</p>
               </div>
            )}

            {loading && (
              <div className="h-full min-h-[400px] border border-slate-800 bg-slate-900/50 rounded-2xl flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                <h3 className="text-lg font-medium text-slate-300 animate-pulse">Extracting Intent...</h3>
                <p className="text-sm text-slate-500 mt-2 text-balance leading-relaxed animate-pulse">
                  Analyzing multimodal inputs, enriching context, and formulating action plans safely.
                </p>
              </div>
            )}

            {result && !loading && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* Meta Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">Detected Intent</span>
                    <div className="text-lg font-bold text-slate-200 capitalize flex items-center gap-2">
                       {result.intent?.replace(/_/g, ' ')}
                       <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border ${getUrgencyColor(result.urgency_level)}`}>
                        {result.urgency_level}
                       </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">Confidence</span>
                    <div className="text-lg font-bold text-slate-200">
                      {Math.round((result.confidence_score || 0) * 100)}%
                    </div>
                  </div>
                </div>

                {/* Human Readable Explanation */}
                <div className="bg-blue-950/30 border border-blue-900/50 rounded-xl p-4 flex gap-3">
                  <ShieldAlert className="w-6 h-6 text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-200 leading-relaxed">
                    {result.human_readable_explanation}
                  </p>
                </div>

                {/* Actions Orchestration */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                    Orchestrated Actions
                  </h3>
                  <div className="grid gap-3">
                    {result.actions?.map((action: any, idx: number) => (
                      <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex gap-4 transition-colors hover:border-slate-700 group">
                        <div className="mt-1">
                          {idx === 0 && action.priority === "critical" ? (
                            <div className="bg-red-500/10 text-red-400 p-2 rounded-lg border border-red-500/20">
                              <PhoneCall className="w-5 h-5" />
                            </div>
                          ) : (
                            <div className="bg-slate-800 text-slate-400 p-2 rounded-lg border border-slate-700">
                              <CheckCircle2 className="w-5 h-5" />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h4 className="font-semibold text-slate-200 capitalize">{action.action_type?.replace(/_/g, ' ')}</h4>
                            <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">
                              Priority: {action.priority}
                            </span>
                            {action.automation_possible && (
                              <span className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                                Automatable
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-400 leading-relaxed">
                            {action.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Raw JSON Debug (Collapsible) */}
                <details className="mt-2 group">
                  <summary className="text-xs uppercase font-semibold text-slate-500 cursor-pointer hover:text-slate-400 transition-colors select-none">
                    View Raw Structured Output
                  </summary>
                  <div className="mt-3 bg-[#0d1117] border border-slate-800 rounded-xl p-4 overflow-x-auto">
                    <pre className="text-xs text-slate-300 font-mono">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  </div>
                </details>

              </div>
            )}
          </section>

        </main>
      </div>
    </div>
  );
}
