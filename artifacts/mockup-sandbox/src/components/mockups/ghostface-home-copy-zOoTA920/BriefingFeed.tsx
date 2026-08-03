import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  RadioTower, 
  Wallet, 
  RefreshCcw, 
  Phone, 
  Activity, 
  Shield, 
  Lock, 
  ArrowRight 
} from 'lucide-react';

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@100;300;400;500&display=swap');

@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 0 4px rgba(191, 155, 48, 0.2);
    background-color: #997c26;
  }
  50% {
    box-shadow: 0 0 12px rgba(191, 155, 48, 0.8);
    background-color: #bf9b30;
  }
}

@keyframes ping-slow {
  0% { transform: scale(1) rotate(45deg); opacity: 0.8; }
  50% { transform: scale(2.5) rotate(45deg); opacity: 0; }
  100% { transform: scale(1) rotate(45deg); opacity: 0; }
}

@keyframes slide-up-fade {
  0% { opacity: 0; transform: translateY(12px); }
  100% { opacity: 1; transform: translateY(0); }
}

.animate-pulse-glow {
  animation: pulse-glow 2s infinite ease-in-out;
}

.animate-ping-slow {
  animation: ping-slow 3s cubic-bezier(0, 0, 0.2, 1) infinite;
}

.animate-entrance {
  animation: slide-up-fade 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  opacity: 0;
}

/* Hide scrollbar for a cleaner device feel */
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
`;

const mono = { fontFamily: "'JetBrains Mono', monospace" };
const serif = { fontFamily: "'Playfair Display', serif" };

const FEED_ITEMS = [
  {
    id: "0x7A99F",
    time: "T-04m",
    category: "COMMS",
    title: "INBOUND TRANSMISSION",
    detail: "Signal decrypted from alias [SPECTER-07].",
    payload: "> \"Meeting point compromised. Move to rally point Beta.\"",
    action: "SECURE REPLY",
    isAlert: true,
  },
  {
    id: "0x8B11A",
    time: "T-42m",
    category: "NET_SEC",
    title: "ROUTE ROTATION",
    detail: "Automated exit node shift executed.",
    payload: "EXIT: CH-ZUR-09\nLATENCY: 42ms\nIP: MASKED",
  },
  {
    id: "0x3C02D",
    time: "T-2h 15m",
    category: "COMMS",
    title: "GHOST NUMBER ACTIVITY",
    detail: "Incoming SMS intercepted to ghost number +44 7700 900077.",
    payload: "> \"Package dropped at location Delta.\"",
    action: "VIEW INBOX",
  },
  {
    id: "0x1A44E",
    time: "T-4h 30m",
    category: "FIN",
    title: "LEDGER UPDATE",
    detail: "Incoming anonymous transfer detected. [VAULT_ALPHA]",
    payload: "AMOUNT: +4.25 XMR\nSTATUS: 10/10 CONFIRMED",
    action: "OPEN WALLET",
  },
  {
    id: "0x9D44E",
    time: "T-8h 00m",
    category: "SYS",
    title: "KEY EXCHANGE",
    detail: "Daily key rotation complete. Previous session keys shredded.",
  },
  {
    id: "0x2E88C",
    time: "T-12h 45m",
    category: "COMMS",
    title: "BURN PROTOCOL",
    detail: "Thread expiration reached for [PHANTOM-99]. Cryptographic wipe complete.",
  }
];

export function BriefingFeed() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hh = String(time.getUTCHours()).padStart(2, '0');
  const mm = String(time.getUTCMinutes()).padStart(2, '0');
  const showColon = time.getUTCSeconds() % 2 === 0;

  return (
    <div 
      className="relative w-full max-w-[390px] mx-auto h-[100dvh] overflow-y-auto overflow-x-hidden bg-black text-[#a3a3a3] shadow-2xl border-x border-[#111] flex flex-col no-scrollbar select-none"
      style={{
        backgroundImage: 'radial-gradient(circle at 50% 0%, #0a0a0a 0%, #000000 70%)'
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-[#030303]/80 backdrop-blur-md border-b border-[#111] px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center h-4 w-4">
            <div className="absolute inset-0 border border-[#bf9b30] rotate-45 opacity-50" />
            <div className="h-1.5 w-1.5 bg-[#bf9b30]" />
          </div>
          <span className="text-[#bf9b30] text-sm tracking-[0.2em] uppercase italic mt-0.5" style={serif}>
            Ghostface
          </span>
        </div>
        <button className="text-[9px] tracking-widest text-[#555] border border-[#1a1a1a] bg-[#0a0a0a] px-2.5 py-1.5 hover:text-red-500 hover:border-red-500/30 transition-colors uppercase flex items-center gap-1.5" style={mono}>
          <Lock size={9} />
          Lock
        </button>
      </header>

      {/* SUMMARY DASHBOARD */}
      <div className="px-6 pt-8 pb-6">
        <div className="flex items-end justify-between mb-4">
          <h1 className="text-2xl italic tracking-wide text-[#e5e5e5]" style={serif}>
            Briefing Feed
          </h1>
          <span className="text-[10px] tracking-widest text-[#555]" style={mono}>
            {hh}<span className={showColon ? 'opacity-100' : 'opacity-0'}>:</span>{mm} UTC
          </span>
        </div>
        
        <div className="h-px w-full bg-gradient-to-r from-[#bf9b30]/40 to-transparent mb-6" />
        
        <div className="flex gap-4">
          <div className="flex-1 flex flex-col gap-1.5 p-3 border border-[#1a1a1a] bg-[#050505] relative overflow-hidden group">
            <div className="absolute inset-0 bg-[#bf9b30]/5 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out" />
            <span className="text-[8px] tracking-[0.2em] text-[#666]" style={mono}>ACTIVE ALIAS</span>
            <span className="text-[11px] tracking-widest text-[#bf9b30]" style={mono}>SPECTER-07</span>
          </div>
          <div className="flex-1 flex flex-col gap-1.5 p-3 border border-[#1a1a1a] bg-[#050505] relative overflow-hidden group">
            <div className="absolute inset-0 bg-[#bf9b30]/5 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out" />
            <span className="text-[8px] tracking-[0.2em] text-[#666]" style={mono}>NETWORK</span>
            <span className="text-[11px] tracking-widest text-[#bf9b30]" style={mono}>SECURE_LINK</span>
          </div>
        </div>
      </div>

      {/* FEED TIMELINE */}
      <div className="px-6 pb-32">
        <div className="relative">
          {/* The Track Line */}
          <div className="absolute left-[2px] top-[8px] bottom-[20px] w-[1px] bg-gradient-to-b from-[#1a1a1a] via-[#1a1a1a] to-transparent" />

          <div className="flex flex-col gap-0">
            {FEED_ITEMS.map((item, idx) => {
              let Icon = Activity;
              if (item.category === 'COMMS') Icon = MessageSquare;
              if (item.category === 'NET_SEC') Icon = RadioTower;
              if (item.category === 'FIN') Icon = Wallet;
              if (item.category === 'SYS') Icon = RefreshCcw;

              return (
                <div key={item.id} className="relative pl-7 pb-10 group animate-entrance" style={{ animationDelay: `${idx * 80}ms` }}>
                  {/* The Node */}
                  <div className={`absolute left-[0px] top-[6px] h-[5px] w-[5px] rotate-45 transition-colors duration-500 z-10 ${item.isAlert ? 'animate-pulse-glow' : 'bg-[#333] group-hover:bg-[#555]'}`} />
                  
                  {item.isAlert && (
                    <div className="absolute left-[0px] top-[6px] h-[5px] w-[5px] rotate-45 bg-[#bf9b30] animate-ping-slow pointer-events-none z-0" />
                  )}

                  {/* Content Container */}
                  <div className="flex flex-col gap-2">
                    {/* Time & Ref */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] tracking-[0.2em] text-[#bf9b30] uppercase" style={mono}>{item.time}</div>
                      <div className="text-[9px] tracking-widest text-[#444]" style={mono}>REF:{item.id}</div>
                    </div>

                    {/* Header */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] tracking-widest text-[#666] flex items-center gap-1.5" style={mono}>
                        <Icon size={10} strokeWidth={2} />
                        [{item.category}]
                      </span>
                      <span className="text-[11px] font-medium tracking-widest text-[#d4d4d4]" style={mono}>
                        {item.title}
                      </span>
                    </div>
                    
                    {/* Body */}
                    <div className="text-[11px] leading-[1.6] text-[#777] font-light" style={mono}>
                      {item.detail}
                    </div>

                    {/* Payload */}
                    {item.payload && (
                      <div className={`mt-1.5 pl-3 border-l ${item.isAlert ? 'border-[#bf9b30]/50 text-[#a3a3a3]' : 'border-[#1a1a1a] text-[#555]'} text-[10px] leading-[1.6] whitespace-pre-wrap`} style={mono}>
                        {item.payload}
                      </div>
                    )}

                    {/* Action */}
                    {item.action && (
                      <div className="mt-3">
                        <button className="text-[9px] tracking-[0.15em] uppercase text-[#bf9b30] bg-transparent border border-[#bf9b30]/20 px-3 py-1.5 hover:bg-[#bf9b30]/10 hover:text-white transition-colors flex items-center gap-2" style={mono}>
                          {item.action}
                          <ArrowRight size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* BOTTOM NAV BAR */}
      <div className="fixed bottom-0 w-full max-w-[390px] bg-gradient-to-t from-[#030303] via-[#030303]/90 to-transparent pb-6 pt-12 px-6 z-50 pointer-events-none">
        <div className="pointer-events-auto bg-[#0a0a0a]/90 backdrop-blur-md border border-[#1a1a1a] flex justify-between items-center p-1.5 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.8)]">
          <NavBtn icon={<MessageSquare size={18} strokeWidth={1.5} />} active={false} />
          <NavBtn icon={<Phone size={18} strokeWidth={1.5} />} active={false} />
          <NavBtn icon={<Activity size={18} strokeWidth={1.5} />} active={true} />
          <NavBtn icon={<Wallet size={18} strokeWidth={1.5} />} active={false} />
          <NavBtn icon={<Shield size={18} strokeWidth={1.5} />} active={false} />
        </div>
      </div>
    </div>
  );
}

function NavBtn({ icon, active }: { icon: React.ReactNode; active: boolean }) {
  return (
    <button className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${active ? 'bg-[#bf9b30]/10 text-[#bf9b30] border border-[#bf9b30]/30 shadow-[0_0_12px_rgba(191,155,48,0.15)]' : 'text-[#555] hover:text-[#888] hover:bg-[#111]'}`}>
      {icon}
    </button>
  );
}
