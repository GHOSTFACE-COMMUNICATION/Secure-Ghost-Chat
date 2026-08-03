import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

const FONT_CSS = "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@100;300;400;500;700&display=swap');";

export function Periscope() {
  const [time, setTime] = useState('');
  const [lat, setLat] = useState(47.3769);
  const [lng, setLng] = useState(8.5417);
  const [hex, setHex] = useState('0x00000000');

  useEffect(() => {
    // Clock
    const timer = setInterval(() => {
      const now = new Date();
      setTime(now.toISOString().substring(11, 23) + 'Z');
    }, 47);
    
    // Simulate slight movement
    const locTimer = setInterval(() => {
      setLat(l => l + (Math.random() - 0.5) * 0.0001);
      setLng(l => l + (Math.random() - 0.5) * 0.0001);
    }, 3000);

    // Hex stream
    const hexTimer = setInterval(() => {
      setHex('0x' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0').toUpperCase());
    }, 120);

    return () => {
      clearInterval(timer);
      clearInterval(locTimer);
      clearInterval(hexTimer);
    };
  }, []);

  return (
    <div className="relative w-full min-h-[100dvh] bg-[#020202] overflow-hidden select-none font-mono text-[#bf9b30] flex flex-col">
      <style dangerouslySetInnerHTML={{ __html: `
        ${FONT_CSS}
        .spin-slow { animation: spin 120s linear infinite; }
        .spin-slow-reverse { animation: spin 90s linear infinite reverse; }
        .spin-medium { animation: spin 30s linear infinite; }
        .sweep { animation: spin 4s linear infinite; transform-origin: 50% 50%; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .pulse-glow { animation: pulse-glow 3s ease-in-out infinite; }
        @keyframes pulse-glow {
          0%, 100% { text-shadow: 0 0 20px rgba(191,155,48,0.7); opacity: 1; }
          50% { text-shadow: 0 0 5px rgba(191,155,48,0.2); opacity: 0.7; }
        }
        .coin-spin {
          animation: coin-flip 3.6s ease-in-out infinite;
          transform-style: preserve-3d;
        }
        @keyframes coin-flip {
          0%   { transform: rotateY(0deg)    scale(1);    filter: drop-shadow(0 0 12px rgba(191,155,48,0.6)); }
          20%  { transform: rotateY(90deg)   scale(0.82); filter: drop-shadow(0 0 4px  rgba(191,155,48,0.2)); }
          40%  { transform: rotateY(180deg)  scale(1);    filter: drop-shadow(0 0 18px rgba(191,155,48,0.8)); }
          60%  { transform: rotateY(270deg)  scale(0.82); filter: drop-shadow(0 0 4px  rgba(191,155,48,0.2)); }
          80%  { transform: rotateY(360deg)  scale(1);    filter: drop-shadow(0 0 12px rgba(191,155,48,0.6)); }
          100% { transform: rotateY(360deg)  scale(1);    filter: drop-shadow(0 0 12px rgba(191,155,48,0.6)); }
        }
        .coin-glow { animation: coin-glow 3.6s ease-in-out infinite; }
        @keyframes coin-glow {
          0%, 80%, 100% { opacity: 0.25; transform: scale(1); }
          40% { opacity: 0.55; transform: scale(1.15); }
        }
      `}} />

      {/* Noise Texture */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.15] mix-blend-overlay z-50" 
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
      />

      {/* Global Crosshairs */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 w-[1px] h-full bg-[#bf9b30]/5 -translate-x-1/2" />
        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-[#bf9b30]/5 -translate-y-1/2" />
      </div>

      {/* Header */}
      <div className="px-6 py-8 flex justify-between items-start z-10 relative">
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] tracking-[0.3em] font-medium opacity-90">GHOSTFACE</div>
          <div className="text-[7px] tracking-[0.5em] opacity-40 uppercase">No Face // No Trace</div>
        </div>
        <div className="text-[9px] tracking-widest opacity-60 text-right flex flex-col items-end gap-1.5">
          <span>{time}</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-[#bf9b30] rounded-full animate-pulse shadow-[0_0_5px_rgba(191,155,48,0.5)]" />
            LIVE
          </span>
        </div>
      </div>

      {/* Main Dominant Instrument */}
      <div className="flex-1 relative flex items-center justify-center z-10 w-full px-4">
        <div className="relative w-full max-w-[360px] aspect-square flex items-center justify-center">
            
            {/* Background ambient glow */}
            <div className="absolute inset-4 rounded-full bg-[#bf9b30] opacity-[0.02] blur-3xl" />
            
            {/* Outer ticks (120) */}
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-30 spin-slow">
                {Array.from({ length: 120 }).map((_, i) => (
                    <line
                        key={i}
                        x1="50" y1="1" x2="50" y2={i % 10 === 0 ? "5" : i % 5 === 0 ? "3" : "2"}
                        stroke="currentColor" strokeWidth={i % 10 === 0 ? "0.4" : "0.2"}
                        transform={`rotate(${i * 3} 50 50)`}
                    />
                ))}
            </svg>

            {/* Middle decorative ring */}
            <svg viewBox="0 0 100 100" className="absolute inset-3 w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)] opacity-20 spin-slow-reverse">
                <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="0.1" strokeDasharray="1 3" />
                <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="0.3" strokeDasharray="15 2 2 2" />
            </svg>

            {/* Sweep radar element */}
            <div 
              className="absolute inset-[10%] rounded-full sweep pointer-events-none opacity-40" 
              style={{
                  background: 'conic-gradient(from 0deg, transparent 0deg, transparent 280deg, rgba(191,155,48,0.25) 360deg)',
                  WebkitMaskImage: 'radial-gradient(circle, transparent 55%, black 56%)',
                  maskImage: 'radial-gradient(circle, transparent 55%, black 56%)'
              }} 
            />

            {/* Arced text */}
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full z-20 pointer-events-none spin-medium">
                <path id="arc-top" d="M 12 50 A 38 38 0 0 1 88 50" fill="none" />
                <path id="arc-bottom" d="M 88 50 A 38 38 0 0 1 12 50" fill="none" />
                <text className="text-[2.5px] tracking-[0.4em] fill-[#bf9b30] opacity-50 font-mono">
                    <textPath href="#arc-top" startOffset="50%" textAnchor="middle">
                        NODE: SPECTER-07 // ENCRYPTED COMMS
                    </textPath>
                </text>
                <text className="text-[2.5px] tracking-[0.4em] fill-[#bf9b30] opacity-50 font-mono">
                    <textPath href="#arc-bottom" startOffset="50%" textAnchor="middle">
                        SYS_COORD: {lat.toFixed(4)}N {lng.toFixed(4)}E
                    </textPath>
                </text>
            </svg>

            {/* Center — spinning coin logo */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-30">
                {/* Ambient glow pulse behind coin */}
                <div className="w-[148px] h-[148px] rounded-full absolute coin-glow"
                  style={{ background: 'radial-gradient(circle, rgba(191,155,48,0.18) 0%, transparent 70%)' }} />

                {/* Coin */}
                <img
                  src="/__mockup/images/ghostface-logo.jpeg"
                  alt="GHOSTFACE"
                  className="coin-spin"
                  style={{
                    width: 140, height: 140,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    objectPosition: 'center 15%',
                    border: '1.5px solid rgba(191,155,48,0.35)',
                    background: '#020202',
                  }}
                />

                <div className="text-center mt-4 z-20">
                    <div className="text-[9px] tracking-[0.4em] opacity-60 mb-1 text-[#bf9b30]">PROTECTION</div>
                    <div className="font-['Playfair_Display'] italic text-[24px] leading-none pulse-glow tracking-widest text-[#bf9b30]">
                        ACTIVE
                    </div>
                </div>

                <div className="absolute bottom-[26%] text-[8px] tracking-widest opacity-30 font-mono">
                  {hex}
                </div>
            </div>
        </div>
      </div>

      {/* Thin strip of secondary readouts */}
      <div className="w-full pb-10 pt-6 px-8 relative z-10 flex flex-col gap-6 bg-gradient-to-t from-[#020202] via-[#020202] to-transparent">
        {/* Top decorative line */}
        <div className="absolute top-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-[#bf9b30]/20 to-transparent" />
        
        <div className="flex justify-between items-end">
            <div className="flex flex-col gap-1.5">
                <div className="text-[8px] tracking-[0.3em] opacity-40 uppercase">Network Route</div>
                <div className="text-[11px] tracking-widest font-medium opacity-90">ONION // MULTI-HOP</div>
            </div>
            <div className="flex flex-col gap-1.5 items-end">
                <div className="text-[8px] tracking-[0.3em] opacity-40 uppercase">Latency</div>
                <div className="text-[11px] tracking-widest font-medium opacity-90 flex items-center gap-2">
                    <DataMatrix />
                    14.2 ms
                </div>
            </div>
        </div>

        <div className="flex justify-between items-end">
            <div className="flex flex-col gap-1.5">
                <div className="text-[8px] tracking-[0.3em] opacity-40 uppercase">Ghost Number</div>
                <div className="text-[11px] tracking-widest font-medium opacity-90 text-[#bf9b30]">+1 (800) ***-**42</div>
            </div>
            <div className="flex flex-col gap-1.5 items-end">
                <div className="text-[8px] tracking-[0.3em] opacity-40 uppercase">Wallet Sync</div>
                <div className="text-[11px] tracking-widest font-medium opacity-90 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-[#bf9b30] rounded-sm opacity-60" />
                    2.4501 XMR
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}

function DataMatrix() {
    const [dots, setDots] = useState(() => Array(12).fill(false));
    
    useEffect(() => {
        const int = setInterval(() => {
            setDots(prev => prev.map(() => Math.random() > 0.6));
        }, 150);
        return () => clearInterval(int);
    }, []);
    
    return (
        <div className="grid grid-cols-4 gap-[2px] opacity-70 mr-1">
            {dots.map((active, i) => (
                <div key={i} className={`w-[2px] h-[2px] ${active ? 'bg-[#bf9b30]' : 'bg-[#bf9b30]/20'}`} />
            ))}
        </div>
    )
}
