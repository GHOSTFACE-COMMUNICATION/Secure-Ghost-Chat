import React, { useState, useEffect } from 'react';

const FONT_CSS = "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Playfair+Display:ital,wght@0,400;0,600;1,400;1,600&display=swap');";

export function Switchboard() {
  const [time, setTime] = useState("00:00:00Z");
  
  useEffect(() => {
    const update = () => {
      const d = new Date();
      setTime(d.toISOString().split('T')[1].slice(0, 8) + 'Z');
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div 
      className="relative w-full min-h-[100dvh] h-[100dvh] bg-[#050505] flex flex-col overflow-hidden select-none"
      style={{ fontFamily: "'JetBrains Mono', monospace", color: '#e0e0e0' }}
    >
      <style dangerouslySetInnerHTML={{ __html: FONT_CSS }} />
      
      {/* Background Texture */}
      <div 
        className="absolute inset-0 pointer-events-none z-0"
        style={{ 
          background: 'radial-gradient(circle at 50% -20%, #151515, #050505 80%)',
        }}
      />
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.12] z-0 mix-blend-overlay"
        style={{ 
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      />
      
      <div className="relative z-10 flex flex-col h-full px-4 pb-6 pt-10 max-w-[420px] mx-auto w-full gap-3">
        {/* Top Info */}
        <div className="absolute top-4 left-4 text-[9px] text-[#555] tracking-widest">
          SYS_TIME: {time}
        </div>
        
        {/* Header */}
        <header className="flex justify-between items-end pb-3 border-b border-[#222] shrink-0 mt-4">
          <div>
            <div className="text-[8px] text-[#555] tracking-widest mb-1 uppercase">Operator Alias</div>
            <div className="text-2xl" style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', color: '#e0e0e0' }}>
              SPECTER-07
            </div>
          </div>
          <div className="text-right pb-1">
            <div className="text-[8px] text-[#555] tracking-widest mb-1 uppercase">Sys_State</div>
            <div className="text-[10px] text-[#bf9b30] flex items-center gap-1.5 justify-end uppercase">
              <span className="w-1.5 h-1.5 bg-[#bf9b30] rounded-full animate-pulse shadow-[0_0_8px_rgba(191,155,48,0.8)]" />
              Secure
            </div>
          </div>
        </header>

        {/* Tiles Container */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 py-1">
          {/* Tile 1: VPN */}
          <Tile label="Net_Tunnel" status="Connected" statusColor="#bf9b30">
            <div className="mb-2 grid grid-cols-2 gap-2 text-[9px] text-[#666]">
              <div>
                <div>TX: 1.24 GB</div>
                <div>RX: 3.10 GB</div>
              </div>
              <div className="text-right">
                <div>PING: 14ms</div>
                <div>PROTO: WG-443</div>
              </div>
            </div>
            <div className="flex justify-between items-end mt-auto">
              <div>
                <div className="text-[8px] text-[#555]">IP ADDRESS</div>
                <div className="text-xl text-[#e0e0e0] leading-none my-1.5 font-light tracking-tight">198.51.100.43</div>
                <div className="text-[9px] text-[#bf9b30]">REYKJAVIK, IS</div>
              </div>
              <ActionButton>CYCLE IP</ActionButton>
            </div>
          </Tile>

          {/* Tile 2: Number */}
          <Tile label="Ghost_SIM" status="Active" statusColor="#bf9b30">
            <div className="mb-2 text-[9px] text-[#666] flex justify-between">
              <div className="truncate pr-4">
                <span className="text-[#444]">LAST:</span> "Extraction at 0400"
              </div>
              <div className="shrink-0 text-[#bf9b30]">-12m</div>
            </div>
            <div className="flex justify-between items-end mt-auto">
              <div>
                <div className="text-[8px] text-[#555]">ROUTING NUMBER</div>
                <div className="text-xl text-[#e0e0e0] leading-none my-1.5 font-light tracking-tight">+41 79 123 45 67</div>
                <div className="text-[9px] text-[#666]">TTL: 47H 12M</div>
              </div>
              <HoldButton label="BURN" actionLabel="BURNING" color="red" />
            </div>
          </Tile>

          {/* Split Tiles */}
          <div className="flex gap-3 flex-1 min-h-0">
            {/* Tile 3: Messages */}
            <Tile label="Comms" status="Pulse" statusColor="#bf9b30" className="flex-1">
              <div className="flex flex-col h-full justify-end">
                <div className="text-[8px] text-[#555]">UNREAD TRACES</div>
                <div className="text-3xl text-[#e0e0e0] leading-none my-2" style={{ fontFamily: "'Playfair Display', serif" }}>03</div>
                <ActionButton className="w-full mt-2">DECRYPT</ActionButton>
              </div>
            </Tile>

            {/* Tile 4: Wallet */}
            <Tile label="Vault" status="Synced" statusColor="#666" className="flex-1">
              <div className="flex flex-col h-full justify-end">
                <div className="text-[8px] text-[#555]">BALANCE (XMR)</div>
                <div className="text-xl text-[#e0e0e0] leading-none my-2 font-light">14.052</div>
                <ActionButton className="w-full mt-2">TRANSACT</ActionButton>
              </div>
            </Tile>
          </div>

          {/* Tile 5: Location */}
          <Tile label="GPS_Spoofer" status="Engaged" statusColor="#bf9b30">
            <div className="mb-2 flex justify-between items-end text-[9px] text-[#666]">
              <div>
                <div>ALT: 34m</div>
                <div>SAT: 12 LOCKED</div>
              </div>
              <div className="w-12 h-6 bg-[#0a0a0a] border border-[#222] relative overflow-hidden flex items-center justify-center">
                <div className="absolute inset-0" style={{ background: 'linear-gradient(rgba(85,85,85,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(85,85,85,0.2) 1px, transparent 1px)', backgroundSize: '4px 4px' }} />
                <div className="w-1 h-1 bg-[#bf9b30] rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                <div className="absolute top-1/2 left-1/2 w-4 h-4 border border-[#bf9b30] rounded-full -translate-x-1/2 -translate-y-1/2 opacity-30 animate-ping" />
              </div>
            </div>
            <div className="flex justify-between items-end mt-auto">
              <div>
                <div className="text-[8px] text-[#555]">COORDINATES</div>
                <div className="text-xl text-[#e0e0e0] leading-none my-1.5 font-light tracking-tight">52.5200°N, 13.4050°E</div>
                <div className="text-[9px] text-[#bf9b30]">ALEXANDERPLATZ, DE</div>
              </div>
              <ActionButton>SCRAMBLE</ActionButton>
            </div>
          </Tile>
        </div>

        {/* Panic Wipe */}
        <PanicWipe />
      </div>
    </div>
  );
}

function Tile({ children, label, status, statusColor, className = "" }: { children: React.ReactNode, label: string, status: string, statusColor: string, className?: string }) {
  return (
    <div className={`border border-[#1f1f1f] bg-gradient-to-b from-[#0a0a0a] to-[#050505] p-3.5 flex flex-col flex-1 relative overflow-hidden group min-h-[100px] ${className}`}>
      {/* Decorative corners */}
      <div className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-[#444] transition-colors group-hover:border-[#bf9b30]" />
      <div className="absolute top-0 right-0 w-1.5 h-1.5 border-t border-r border-[#444] transition-colors group-hover:border-[#bf9b30]" />
      <div className="absolute bottom-0 left-0 w-1.5 h-1.5 border-b border-l border-[#444] transition-colors group-hover:border-[#bf9b30]" />
      <div className="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r border-[#444] transition-colors group-hover:border-[#bf9b30]" />

      <div className="flex justify-between items-start text-[9px] text-[#555] uppercase tracking-widest mb-3 shrink-0">
        <span>{label}</span>
        {status === 'Pulse' ? (
          <span className="text-[#bf9b30] animate-pulse">●</span>
        ) : (
          <span style={{ color: statusColor }} className="flex items-center gap-1.5">
            {statusColor === '#bf9b30' && <span className="w-1 h-1 bg-[#bf9b30] rounded-full" />}
            {status}
          </span>
        )}
      </div>
      
      {children}
    </div>
  );
}

function ActionButton({ children, className = "", onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`border border-[#333] px-3 py-1.5 text-[9px] text-[#ccc] hover:bg-[#1a1a1a] hover:text-[#fff] hover:border-[#555] transition-all active:bg-[#222] ${className}`}
    >
      {children}
    </button>
  );
}

function HoldButton({ label, actionLabel, color = 'red' }: { label: string, actionLabel: string, color?: 'red' | 'gold' }) {
  const [holding, setHolding] = useState(false);
  const baseColor = color === 'red' ? '#801010' : '#bf9b30';
  const textColor = color === 'red' ? '#ffaaaa' : '#ffeebb';
  const borderColor = color === 'red' ? '#4a1515' : '#5a4a20';

  return (
    <button 
      className="relative border px-4 py-1.5 text-[9px] overflow-hidden touch-none"
      style={{ borderColor, color: textColor }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHolding(true); }}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setHolding(false); }}
      onPointerCancel={() => setHolding(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div 
        className="absolute left-0 top-0 bottom-0 transition-all ease-linear"
        style={{ 
          backgroundColor: baseColor,
          width: holding ? '100%' : '0%', 
          transitionDuration: holding ? '1500ms' : '200ms' 
        }}
      />
      <span className="relative z-10 font-medium">{holding ? actionLabel : label}</span>
    </button>
  );
}

function PanicWipe() {
  const [holding, setHolding] = useState(false);
  return (
    <div 
      className="shrink-0 border border-[#4a1515] bg-[#0a0202] h-[52px] flex items-center justify-center relative cursor-pointer touch-none mt-2 overflow-hidden"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHolding(true); }}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setHolding(false); }}
      onPointerCancel={() => setHolding(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Striped background for danger */}
      <div 
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{ 
          background: 'repeating-linear-gradient(45deg, #4a1515, #4a1515 10px, transparent 10px, transparent 20px)' 
        }} 
      />
      
      {/* Fill bar */}
      <div 
        className="absolute left-0 top-0 bottom-0 bg-[#b31010] transition-all ease-linear pointer-events-none"
        style={{ 
          width: holding ? '100%' : '0%', 
          transitionDuration: holding ? '2500ms' : '300ms' 
        }}
      />
      
      {/* Text */}
      <div className="relative z-10 flex items-center gap-3">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffcccc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={holding ? "animate-pulse" : ""}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span className="text-[11px] text-[#ffcccc] tracking-[0.3em] font-medium uppercase mt-0.5">
          {holding ? 'Initiating Wipe...' : 'Hold To Wipe Device'}
        </span>
      </div>
    </div>
  );
}
