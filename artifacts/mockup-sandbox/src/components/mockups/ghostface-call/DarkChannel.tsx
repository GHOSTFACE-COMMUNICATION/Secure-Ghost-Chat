import React, { useState, useEffect } from "react";
import { Mic, MicOff, Volume2, PhoneOff, Radio, Lock, Activity, Hexagon, ShieldAlert, Zap, Skull, Cpu, Shield, Signal } from "lucide-react";

export default function DarkChannel() {
  const [duration, setDuration] = useState(263); // Starts at 04:23
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [voiceFx, setVoiceFx] = useState("natural");
  const [fxOpen, setFxOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const VOICE_PRESETS = [
    { id: "natural", label: "NATURAL", icon: Mic },
    { id: "robot", label: "ROBOT", icon: Zap },
    { id: "deep", label: "DEEP", icon: Activity },
    { id: "ghost", label: "GHOST", icon: Skull },
    { id: "alien", label: "ALIEN", icon: Hexagon },
    { id: "high", label: "HIGH", icon: Radio },
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        
        .font-space { font-family: 'Space Mono', monospace; }
        
        .bg-noise {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          opacity: 0.04;
          mix-blend-mode: overlay;
          pointer-events: none;
        }

        .bg-grid {
          background-size: 20px 20px;
          background-image: 
            linear-gradient(to right, rgba(191, 155, 48, 0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(191, 155, 48, 0.03) 1px, transparent 1px);
        }

        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        .animate-pulse-ring { animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }

        @keyframes eq1 { 0%, 100% { transform: scaleY(0.2); } 50% { transform: scaleY(0.8); } }
        @keyframes eq2 { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1.0); } }
        @keyframes eq3 { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(0.6); } }
        @keyframes eq4 { 0%, 100% { transform: scaleY(0.5); } 50% { transform: scaleY(0.9); } }
        @keyframes eq5 { 0%, 100% { transform: scaleY(0.2); } 50% { transform: scaleY(0.7); } }

        .bar-1 { animation: eq1 1.2s ease-in-out infinite; }
        .bar-2 { animation: eq2 0.9s ease-in-out infinite 0.1s; }
        .bar-3 { animation: eq3 1.1s ease-in-out infinite 0.2s; }
        .bar-4 { animation: eq4 0.8s ease-in-out infinite 0.3s; }
        .bar-5 { animation: eq5 1.3s ease-in-out infinite 0.4s; }
        .bar-6 { animation: eq2 1.0s ease-in-out infinite 0.5s; }
        .bar-7 { animation: eq1 1.4s ease-in-out infinite 0.6s; }
        
        .scanline {
          background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.3) 51%);
          background-size: 100% 4px;
        }
      `}} />

      <div className="font-space h-[100dvh] w-full max-w-[390px] mx-auto bg-[#030303] text-[#888] relative overflow-hidden flex flex-col selection:bg-[#bf9b30]/30 shadow-2xl border-x border-[#111]">
        
        {/* Background Layers */}
        <div className="absolute inset-0 bg-grid z-0" />
        <div className="absolute inset-0 bg-noise z-0" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#000_100%)] opacity-80 z-0 pointer-events-none" />

        {/* Corner Reticles */}
        <div className="absolute top-4 left-4 w-3 h-3 border-t border-l border-[#bf9b30]/40 z-0" />
        <div className="absolute top-4 right-4 w-3 h-3 border-t border-r border-[#bf9b30]/40 z-0" />
        <div className="absolute bottom-4 left-4 w-3 h-3 border-b border-l border-[#bf9b30]/40 z-0" />
        <div className="absolute bottom-4 right-4 w-3 h-3 border-b border-r border-[#bf9b30]/40 z-0" />

        {/* Vertical Edge Text */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90 text-[7px] text-[#333] tracking-[0.4em] whitespace-nowrap z-0 origin-right">
          GHST-NET-889.2 // PROTOCOL: OMEGA
        </div>

        <div className="flex-1 flex flex-col pt-10 pb-8 px-6 z-10 w-full relative h-full">
          {/* Header Status */}
          <div className="flex justify-between items-start mb-8 w-full">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[#bf9b30]">
                <Shield size={12} fill="currentColor" className="text-[#bf9b30]/20" />
                <span className="text-[9px] tracking-[0.25em] font-bold uppercase">Secure Channel</span>
              </div>
              <span className="text-[9px] text-[#555] tracking-widest pl-5">E2E // P2P ACTIVE</span>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-[#bf9b30] tracking-widest animate-pulse">LIVE</span>
                <Signal size={12} className="text-[#bf9b30]" />
              </div>
              <span className="text-[9px] text-[#555] tracking-widest">34ms</span>
            </div>
          </div>

          {/* Main Visualization Center */}
          <div className="flex flex-col items-center justify-center flex-1 py-4 w-full relative">
            
            {/* Radar / Pulse Rings */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-25">
              <div className="w-[180px] h-[180px] rounded-full border border-[#bf9b30]/40 animate-pulse-ring" style={{ animationDelay: '0s' }}></div>
              <div className="absolute w-[180px] h-[180px] rounded-full border border-[#bf9b30]/20 animate-pulse-ring" style={{ animationDelay: '1s' }}></div>
              <div className="absolute w-[180px] h-[180px] rounded-full border border-[#bf9b30]/10 animate-pulse-ring" style={{ animationDelay: '2s' }}></div>
            </div>

            {/* Inner Avatar Bubble */}
            <div className="w-28 h-28 mb-8 rounded-full border border-[#bf9b30]/80 bg-[#0a0802] shadow-[0_0_30px_rgba(191,155,48,0.15)] flex items-center justify-center relative z-10 backdrop-blur-md">
               {/* Waveform */}
               <div className="flex items-center justify-center gap-[4px] h-12 w-full px-4">
                 <div className="w-[3px] h-full bg-[#bf9b30] bar-1 rounded-full origin-center"></div>
                 <div className="w-[3px] h-full bg-[#bf9b30] bar-2 rounded-full origin-center"></div>
                 <div className="w-[3px] h-full bg-[#bf9b30] bar-3 rounded-full origin-center"></div>
                 <div className="w-[3px] h-full bg-[#bf9b30] bar-4 rounded-full origin-center"></div>
                 <div className="w-[3px] h-full bg-[#bf9b30] bar-5 rounded-full origin-center"></div>
                 <div className="w-[3px] h-full bg-[#bf9b30] bar-6 rounded-full origin-center"></div>
                 <div className="w-[3px] h-full bg-[#bf9b30] bar-7 rounded-full origin-center"></div>
               </div>
            </div>

            <div className="flex flex-col items-center z-10 w-full">
              <div className="text-[#bf9b30]/70 text-[9px] tracking-[0.4em] mb-3 uppercase flex items-center gap-2">
                <Lock size={10} /> Target ID
              </div>
              <div className="text-3xl font-bold text-[#e0e0e0] tracking-[0.15em] mb-2 uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">
                SPECTER-07
              </div>
              <div className="text-[56px] leading-none font-light text-[#bf9b30] tracking-widest my-4 tabular-nums">
                {formatTime(duration)}
              </div>
              
              {/* Data Table */}
              <div className="flex flex-col gap-1.5 mt-6 text-[9px] text-[#666] tracking-[0.2em] border border-[#1a1a1a] p-4 w-full max-w-[260px] bg-[#050505]/80 backdrop-blur-md relative uppercase">
                {/* Corner Accents on the box */}
                <div className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-[#bf9b30]/30" />
                <div className="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r border-[#bf9b30]/30" />
                
                <div className="flex justify-between items-center">
                  <span>PROTOCOL</span>
                  <span className="text-[#bf9b30]">ZRTP</span>
                </div>
                <div className="w-full h-px bg-[#111] my-0.5" />
                <div className="flex justify-between items-center">
                  <span>CIPHER</span>
                  <span className="text-[#aaa]">AES-256-GCM</span>
                </div>
                <div className="w-full h-px bg-[#111] my-0.5" />
                <div className="flex justify-between items-center">
                  <span>ROUTE</span>
                  <span className="text-[#aaa]">TOR-ONION</span>
                </div>
                <div className="w-full h-px bg-[#111] my-0.5" />
                <div className="flex justify-between items-center">
                  <span>KEY</span>
                  <span className="text-[#aaa] truncate max-w-[100px] font-mono">0x7F8B...9A2</span>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full flex flex-col justify-end mt-auto z-20">
            
            {/* Voice Changer Drawer */}
            <div className={`transition-all duration-300 ease-in-out overflow-hidden border border-[#222] bg-[#050505]/95 backdrop-blur-xl relative ${fxOpen ? 'max-h-[350px] opacity-100 mb-6 translate-y-0' : 'max-h-0 opacity-0 border-none mb-0 translate-y-4'}`}>
              <div className="absolute inset-0 scanline opacity-20 pointer-events-none" />
              
              <div className="p-4 flex flex-col gap-4 relative z-10">
                <div className="text-[9px] text-[#bf9b30] tracking-[0.2em] flex justify-between items-center uppercase">
                  <span className="flex items-center gap-2"><Cpu size={12} /> Voice Modulator</span>
                  <button onClick={() => setFxOpen(false)} className="text-[#666] hover:text-[#bf9b30] transition-colors">[ CLOSE ]</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {VOICE_PRESETS.map(p => {
                    const active = p.id === voiceFx;
                    const Icon = p.icon;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setVoiceFx(p.id)}
                        className={`flex flex-col items-center justify-center p-4 gap-3 border transition-all ${
                          active 
                            ? 'border-[#bf9b30] bg-[#bf9b30]/10 text-[#bf9b30] shadow-[inset_0_0_10px_rgba(191,155,48,0.2)]' 
                            : 'border-[#1a1a1a] bg-[#0a0a0a] text-[#555] hover:border-[#333] hover:text-[#888]'
                        }`}
                      >
                        <Icon size={16} className={active ? 'animate-pulse' : ''} />
                        <span className="text-[8px] tracking-[0.2em] uppercase">{p.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Bottom Controls Row */}
            <div className="flex justify-between items-center px-1 w-full relative z-20 bg-[#030303] pb-2">
              <button 
                onClick={() => setMuted(!muted)}
                className="flex flex-col items-center gap-2.5 w-[64px]"
              >
                <div className={`w-[52px] h-[52px] rounded-full border flex items-center justify-center transition-all ${
                  muted ? 'border-[#bf9b30] bg-[#bf9b30]/10 text-[#bf9b30]' : 'border-[#222] bg-[#0a0a0a] text-[#888]'
                }`}>
                  {muted ? <MicOff size={20} /> : <Mic size={20} />}
                </div>
                <span className={`text-[8px] tracking-[0.2em] uppercase ${muted ? 'text-[#bf9b30]' : 'text-[#666]'}`}>
                  Mute
                </span>
              </button>

              <button 
                onClick={() => setFxOpen(!fxOpen)}
                className="flex flex-col items-center gap-2.5 w-[64px]"
              >
                <div className={`w-[52px] h-[52px] rounded-full border flex items-center justify-center transition-all ${
                  (fxOpen || voiceFx !== 'natural') ? 'border-[#bf9b30] bg-[#bf9b30]/10 text-[#bf9b30]' : 'border-[#222] bg-[#0a0a0a] text-[#888]'
                }`}>
                  <Radio size={20} />
                </div>
                <span className={`text-[8px] tracking-[0.2em] uppercase ${(fxOpen || voiceFx !== 'natural') ? 'text-[#bf9b30]' : 'text-[#666]'}`}>
                  {voiceFx !== 'natural' ? voiceFx : 'Voice FX'}
                </span>
              </button>

              <button 
                onClick={() => setSpeaker(!speaker)}
                className="flex flex-col items-center gap-2.5 w-[64px]"
              >
                <div className={`w-[52px] h-[52px] rounded-full border flex items-center justify-center transition-all ${
                  speaker ? 'border-[#bf9b30] bg-[#bf9b30]/10 text-[#bf9b30]' : 'border-[#222] bg-[#0a0a0a] text-[#888]'
                }`}>
                  <Volume2 size={20} />
                </div>
                <span className={`text-[8px] tracking-[0.2em] uppercase ${speaker ? 'text-[#bf9b30]' : 'text-[#666]'}`}>
                  Speaker
                </span>
              </button>
              
              <button 
                className="flex flex-col items-center gap-2.5 w-[64px]"
              >
                <div className="w-[52px] h-[52px] rounded-full border border-[#8a2b2b]/50 bg-[#3d1414]/30 text-[#e85a5a] flex items-center justify-center hover:bg-[#521919]/50 hover:text-[#ff7070] transition-all">
                  <PhoneOff size={20} />
                </div>
                <span className="text-[8px] tracking-[0.2em] uppercase text-[#e85a5a]/70">
                  Abort
                </span>
              </button>
            </div>

            {/* Brand Mark */}
            <div className="mt-6 flex justify-center items-center gap-2 opacity-30 pb-2">
              <ShieldAlert size={10} className="text-[#bf9b30]" />
              <span className="text-[7px] tracking-[0.4em] uppercase text-[#bf9b30]">NO FACE. NO TRACE.</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
