import React, { useEffect, useRef, useState } from 'react';

const FONT_CSS = "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100;300;400;500;700&display=swap');";

// Physics constants
const CYCLE = 5200;          // ms per full spin-slow-fall cycle
const FAST_END   = 0.30;    // fraction where fast spin ends
const SLOW_END   = 0.68;    // fraction where slowing ends → wobble begins
const FALL_END   = 0.88;    // fraction where coin is flat
const REST_END   = 1.00;    // flat pause before restart

function easeIn(t: number) { return t * t * t; }
function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function coinPhysics(ms: number): { rotY: number; tiltX: number; scaleX: number; glow: number } {
  const t = (ms % CYCLE) / CYCLE;

  if (t < FAST_END) {
    // Fast upright spin — ~5 full rotations
    const p = t / FAST_END;
    const rotY = p * 1800; // 5 × 360
    return { rotY, tiltX: 0, scaleX: 1, glow: 0.6 };
  }

  if (t < SLOW_END) {
    // Decelerating + tilting
    const p = (t - FAST_END) / (SLOW_END - FAST_END);
    const ep = easeIn(p);                       // deceleration curve
    const rotY = 1800 + ep * 720;               // 2 more slow rotations
    const tiltX = lerp(0, 62, ep);              // tilt 0→62°
    const scaleX = 1;
    const glow = lerp(0.6, 0.25, ep);
    return { rotY, tiltX, scaleX, glow };
  }

  if (t < FALL_END) {
    // Wobble — rapid oscillation as coin precesses and falls
    const p = (t - SLOW_END) / (FALL_END - SLOW_END);
    const ep = easeIn(p);
    const wobbleHz = 14;                        // wobbles per second at peak
    const wobbleAmp = lerp(6, 2, ep);
    const wobble = wobbleAmp * Math.sin(p * Math.PI * wobbleHz);
    const rotY = 2520 + p * 180;               // very slow final rotation
    const tiltX = lerp(62, 86, ep) + wobble;
    const scaleX = lerp(1, 0.15, easeOut(p));  // coin appears to fall flat
    const glow = lerp(0.25, 0.05, ep);
    return { rotY, tiltX, scaleX, glow };
  }

  // REST: flat pause
  return { rotY: 2700, tiltX: 88, scaleX: 0.08, glow: 0.03 };
}

export function Periscope() {
  const [time, setTime] = useState('');
  const [lat, setLat] = useState(47.3769);
  const [lng, setLng] = useState(8.5417);
  const [hex, setHex] = useState('0x00000000');
  const coinRef = useRef<HTMLImageElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setTime(now.toISOString().substring(11, 23) + 'Z');
    }, 47);
    const locTimer = setInterval(() => {
      setLat(l => l + (Math.random() - 0.5) * 0.0001);
      setLng(l => l + (Math.random() - 0.5) * 0.0001);
    }, 3000);
    const hexTimer = setInterval(() => {
      setHex('0x' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0').toUpperCase());
    }, 120);
    return () => { clearInterval(timer); clearInterval(locTimer); clearInterval(hexTimer); };
  }, []);

  // Physics-driven coin animation
  useEffect(() => {
    startRef.current = performance.now();
    function frame(now: number) {
      const elapsed = now - startRef.current;
      const { rotY, tiltX, scaleX, glow } = coinPhysics(elapsed);

      if (coinRef.current) {
        coinRef.current.style.transform =
          `perspective(600px) rotateX(${tiltX}deg) rotateY(${rotY}deg) scaleX(${scaleX})`;
        const glowPx = Math.round(glow * 28);
        coinRef.current.style.filter =
          `drop-shadow(0 0 ${glowPx}px rgba(191,155,48,${glow}))`;
      }
      if (glowRef.current) {
        glowRef.current.style.opacity = String(glow * 1.8);
        glowRef.current.style.transform = `scale(${0.9 + glow * 0.3})`;
      }

      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
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
      `}} />

      {/* Noise */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.12] mix-blend-overlay z-50"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />

      {/* Crosshairs */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 w-[1px] h-full bg-[#bf9b30]/5 -translate-x-1/2" />
        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-[#bf9b30]/5 -translate-y-1/2" />
      </div>

      {/* Header — compact */}
      <div className="px-6 pt-10 pb-3 flex justify-between items-start z-10 relative">
        <div className="flex flex-col gap-1">
          <div className="text-[11px] tracking-[0.3em] font-medium opacity-90">GHOSTFACE</div>
          <div className="text-[7px] tracking-[0.5em] opacity-40 uppercase">No Face // No Trace</div>
        </div>
        <div className="text-[9px] tracking-widest opacity-60 text-right flex flex-col items-end gap-1">
          <span>{time}</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-[#bf9b30] rounded-full animate-pulse shadow-[0_0_5px_rgba(191,155,48,0.5)]" />
            LIVE
          </span>
        </div>
      </div>

      {/* Main instrument — centred, takes all flex space */}
      <div className="flex-1 relative flex items-center justify-center z-10 w-full px-4 -mt-6">
        <div className="relative w-full max-w-[340px] aspect-square flex items-center justify-center">

          {/* Outer tick ring */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-30 spin-slow">
            {Array.from({ length: 120 }).map((_, i) => (
              <line key={i} x1="50" y1="1" x2="50" y2={i % 10 === 0 ? "5" : i % 5 === 0 ? "3" : "2"}
                stroke="currentColor" strokeWidth={i % 10 === 0 ? "0.4" : "0.2"}
                transform={`rotate(${i * 3} 50 50)`} />
            ))}
          </svg>

          {/* Dashed ring */}
          <svg viewBox="0 0 100 100" className="absolute inset-3 w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)] opacity-20 spin-slow-reverse">
            <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="0.1" strokeDasharray="1 3" />
            <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="0.3" strokeDasharray="15 2 2 2" />
          </svg>

          {/* Sweep radar */}
          <div className="absolute inset-[10%] rounded-full sweep pointer-events-none opacity-35"
            style={{
              background: 'conic-gradient(from 0deg, transparent 0deg, transparent 280deg, rgba(191,155,48,0.25) 360deg)',
              WebkitMaskImage: 'radial-gradient(circle, transparent 55%, black 56%)',
              maskImage: 'radial-gradient(circle, transparent 55%, black 56%)',
            }}
          />

          {/* Arced text */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full z-20 pointer-events-none spin-medium">
            <path id="arc-top" d="M 12 50 A 38 38 0 0 1 88 50" fill="none" />
            <path id="arc-bottom" d="M 88 50 A 38 38 0 0 1 12 50" fill="none" />
            <text style={{ fontSize: '2.5px', letterSpacing: '0.4em', fill: '#bf9b30', opacity: 0.5 }}>
              <textPath href="#arc-top" startOffset="50%" textAnchor="middle">NODE: SPECTER-07 // ENCRYPTED COMMS</textPath>
            </text>
            <text style={{ fontSize: '2.5px', letterSpacing: '0.4em', fill: '#bf9b30', opacity: 0.5 }}>
              <textPath href="#arc-bottom" startOffset="50%" textAnchor="middle">SYS_COORD: {lat.toFixed(4)}N {lng.toFixed(4)}E</textPath>
            </text>
          </svg>

          {/* Coin */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-30">
            {/* Ambient glow (driven by JS) */}
            <div ref={glowRef} className="w-[160px] h-[160px] rounded-full absolute"
              style={{ background: 'radial-gradient(circle, rgba(191,155,48,0.22) 0%, transparent 70%)', transition: 'none' }} />

            {/* The coin image */}
            <img
              ref={coinRef}
              src="/__mockup/images/ghostface-logo.jpeg"
              alt="GHOSTFACE"
              style={{
                width: 148, height: 148,
                borderRadius: '50%',
                objectFit: 'cover',
                objectPosition: 'center 15%',
                border: '1.5px solid rgba(191,155,48,0.4)',
                background: '#020202',
                willChange: 'transform, filter',
                transformOrigin: 'center center',
              }}
            />

            {/* Scrolling hex */}
            <div className="mt-5 text-[8px] tracking-widest opacity-25 font-mono">{hex}</div>
          </div>
        </div>
      </div>

      {/* Secondary readouts */}
      <div className="w-full pb-10 pt-4 px-8 relative z-10 flex flex-col gap-5 bg-gradient-to-t from-[#020202] via-[#020202] to-transparent">
        <div className="absolute top-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-[#bf9b30]/20 to-transparent" />

        <div className="flex justify-between items-end">
          <div className="flex flex-col gap-1">
            <div className="text-[8px] tracking-[0.3em] opacity-40 uppercase">Network Route</div>
            <div className="text-[11px] tracking-widest font-medium opacity-90">ONION // MULTI-HOP</div>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <div className="text-[8px] tracking-[0.3em] opacity-40 uppercase">Latency</div>
            <div className="text-[11px] tracking-widest font-medium opacity-90 flex items-center gap-2">
              <DataMatrix />
              14.2 ms
            </div>
          </div>
        </div>

        <div className="flex justify-between items-end">
          <div className="flex flex-col gap-1">
            <div className="text-[8px] tracking-[0.3em] opacity-40 uppercase">Ghost Number</div>
            <div className="text-[11px] tracking-widest font-medium opacity-90">+1 (800) ***-**42</div>
          </div>
          <div className="flex flex-col gap-1 items-end">
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
    const int = setInterval(() => { setDots(prev => prev.map(() => Math.random() > 0.6)); }, 150);
    return () => clearInterval(int);
  }, []);
  return (
    <div className="grid grid-cols-4 gap-[2px] opacity-70 mr-1">
      {dots.map((active, i) => (
        <div key={i} className={`w-[2px] h-[2px] ${active ? 'bg-[#bf9b30]' : 'bg-[#bf9b30]/20'}`} />
      ))}
    </div>
  );
}
