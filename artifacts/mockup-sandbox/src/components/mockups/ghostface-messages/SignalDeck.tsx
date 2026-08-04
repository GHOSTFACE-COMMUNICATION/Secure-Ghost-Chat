import React, { useState } from "react";
import { Shield, ShieldAlert, Wifi, Lock, Crosshair, ChevronRight, Terminal, Radio, Skull } from "lucide-react";
import "./_group.css";

type ChannelState = 'live' | 'sealed';

interface Channel {
  id: string;
  alias: string;
  isGhostNumber?: boolean;
  ghostNumber?: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  state: ChannelState;
  verified: boolean;
}

const MOCK_CHANNELS: Channel[] = [
  {
    id: "c1",
    alias: "SPECTER-07",
    lastMessage: "Drop point secured. Awaiting coordinates.",
    timestamp: "12m",
    unread: 3,
    state: "live",
    verified: true,
  },
  {
    id: "c2",
    alias: "NIGHTMARE-2",
    lastMessage: "They are tracking the old frequency. Switch now.",
    timestamp: "45m",
    unread: 1,
    state: "live",
    verified: true,
  },
  {
    id: "c3",
    alias: "NULL-ROUTER",
    isGhostNumber: true,
    ghostNumber: "+1 800 555 0199",
    lastMessage: "Incoming SMS transmission block received.",
    timestamp: "3h",
    unread: 0,
    state: "live",
    verified: false,
  },
  {
    id: "c4",
    alias: "PHANTOM-99",
    lastMessage: "0x8F9a... transfer complete. Verify on your end.",
    timestamp: "1d",
    unread: 0,
    state: "live",
    verified: true,
  },
  {
    id: "c5",
    alias: "ECHO-ACTUAL",
    lastMessage: "<CHANNEL SEVERED>",
    timestamp: "2d",
    unread: 0,
    state: "sealed",
    verified: false,
  }
];

export default function SignalDeck() {
  const [activeTab, setActiveTab] = useState<"freq" | "intercept" | "dir">("freq");

  const activeChannels = MOCK_CHANNELS.filter(c => c.state === 'live');
  const sealedChannels = MOCK_CHANNELS.filter(c => c.state === 'sealed');

  return (
    <div className="gf-bg min-h-screen text-neutral-300 relative overflow-hidden flex flex-col items-center w-full">
      {/* Visual FX Layers */}
      <div className="noise-overlay pointer-events-none" />
      <div className="scanline pointer-events-none" />
      
      {/* Mobile Container wrapper */}
      <div className="w-full max-w-[390px] h-full min-h-[844px] flex flex-col relative border-x border-[#111] bg-[#050505] shadow-2xl">
        
        {/* Header Region */}
        <header className="pt-14 pb-4 px-5 border-b border-[#1a1a1a] relative z-10 bg-[#050505]">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 border border-[#bf9b30] flex items-center justify-center bg-[#bf9b30]/10">
                <Crosshair className="w-4 h-4 text-[#bf9b30]" />
              </div>
              <div>
                <h1 className="gf-font-mono text-sm tracking-[0.2em] font-bold text-white">GHOSTFACE</h1>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#bf9b30] animate-pulse-opacity" />
                  <span className="gf-font-mono text-[9px] tracking-widest text-[#bf9b30]">UPLINK SECURE</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="gf-font-mono text-[9px] tracking-widest text-neutral-500">VPN</span>
                <span className="gf-font-mono text-[10px] tracking-widest text-white">CH-04</span>
              </div>
              <Shield className="w-5 h-5 text-neutral-400" strokeWidth={1.5} />
            </div>
          </div>

          {/* Navigation Segments */}
          <div className="flex p-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm">
            {[
              { id: "freq", label: "FREQUENCIES", icon: Radio },
              { id: "intercept", label: "INTERCEPT", icon: Terminal },
              { id: "dir", label: "DIRECTIVES", icon: Lock },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex-1 py-2.5 flex items-center justify-center gap-2 rounded-sm transition-all duration-200 ${
                    isActive ? "bg-[#1a1a1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" : "opacity-50 hover:opacity-100"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? "text-[#bf9b30]" : "text-neutral-500"}`} />
                  <span className={`gf-font-mono text-[10px] font-bold tracking-[0.15em] ${isActive ? "text-white glow-text" : "text-neutral-500"}`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto hide-scrollbar relative z-10 pb-20">
          
          <div className="px-5 py-4 flex items-center justify-between">
            <h2 className="gf-font-mono text-[10px] tracking-[0.2em] text-neutral-500 font-bold">ACTIVE SIGNALS</h2>
            <span className="gf-font-mono text-[10px] text-neutral-600">{activeChannels.length} IDENTIFIED</span>
          </div>

          <div className="flex flex-col px-3 gap-2">
            {activeChannels.map((channel, i) => (
              <div 
                key={channel.id} 
                className={`relative group bg-[#0a0a0a] border ${channel.unread > 0 ? "border-[#bf9b30]/30" : "border-[#1a1a1a]"} p-4 rounded-sm animate-slide-up hover:bg-[#111] transition-colors cursor-pointer`}
                style={{ animationDelay: `${i * 100}ms` }}
              >
                {/* Accent Line for Unread */}
                {channel.unread > 0 && (
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#bf9b30] shadow-[0_0_8px_rgba(191,155,48,0.6)]" />
                )}

                <div className="flex gap-4">
                  {/* Left block: Avatar/Ident */}
                  <div className="flex flex-col items-center justify-start mt-1">
                    <div className={`w-10 h-10 flex items-center justify-center border ${channel.unread > 0 ? "border-[#bf9b30] bg-[#bf9b30]/10" : "border-[#222] bg-[#111]"} rounded-sm`}>
                      <span className={`gf-font-mono text-sm font-bold ${channel.unread > 0 ? "text-[#bf9b30]" : "text-neutral-400"}`}>
                        {channel.alias.substring(0, 2)}
                      </span>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex justify-between items-start mb-1.5">
                      <div className="flex items-center gap-2 truncate pr-2">
                        <span className={`gf-font-mono text-sm font-bold tracking-widest truncate ${channel.unread > 0 ? "text-white" : "text-neutral-300"}`}>
                          {channel.alias}
                        </span>
                        {channel.verified && (
                          <Shield className="w-3.5 h-3.5 text-[#bf9b30]" fill="rgba(191,155,48,0.2)" strokeWidth={2} />
                        )}
                      </div>
                      <span className="gf-font-mono text-[10px] text-neutral-500 whitespace-nowrap mt-0.5">
                        {channel.timestamp}
                      </span>
                    </div>

                    {channel.isGhostNumber && (
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Terminal className="w-3 h-3 text-neutral-500" />
                        <span className="gf-font-mono text-[9px] tracking-widest text-neutral-500">
                          {channel.ghostNumber}
                        </span>
                      </div>
                    )}

                    <p className={`gf-font-sans text-xs truncate ${channel.unread > 0 ? "text-neutral-300 font-medium" : "text-neutral-500"}`}>
                      {channel.lastMessage}
                    </p>
                  </div>

                  {/* Right block: Unread & Action */}
                  <div className="flex flex-col items-end justify-between pl-2">
                    {channel.unread > 0 ? (
                      <div className="w-5 h-5 flex items-center justify-center bg-[#bf9b30] text-black gf-font-mono text-[10px] font-bold rounded-sm">
                        {channel.unread}
                      </div>
                    ) : (
                      <div className="w-5 h-5" /> // placeholder
                    )}
                    <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-[#bf9b30] transition-colors mb-1" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="px-5 py-4 mt-4 flex items-center justify-between">
            <h2 className="gf-font-mono text-[10px] tracking-[0.2em] text-neutral-600 font-bold">SEVERED CHANNELS</h2>
          </div>

          <div className="flex flex-col px-3 gap-2">
            {sealedChannels.map((channel, i) => (
              <div 
                key={channel.id} 
                className="relative bg-[#050505] border border-dashed border-[#1a1a1a] p-4 rounded-sm animate-slide-up opacity-60"
                style={{ animationDelay: `${(activeChannels.length + i) * 100}ms` }}
              >
                <div className="flex gap-4 items-center">
                  <div className="w-10 h-10 flex items-center justify-center border border-[#111] bg-[#0a0a0a] rounded-sm">
                    <Skull className="w-4 h-4 text-neutral-600" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="gf-font-mono text-sm font-bold tracking-widest text-neutral-500 line-through decoration-[#1a1a1a]">
                        {channel.alias}
                      </span>
                      <span className="gf-font-mono text-[10px] text-neutral-600">
                        {channel.timestamp}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 bg-[#111] text-neutral-500 gf-font-mono text-[8px] font-bold tracking-widest rounded-sm">
                        SEALED
                      </span>
                      <p className="gf-font-mono text-[10px] text-neutral-600 truncate">
                        {channel.lastMessage}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Floating Action Bar */}
        <div className="absolute bottom-8 right-5 z-20 flex flex-col gap-3">
          <button className="w-14 h-14 bg-[#bf9b30] rounded-sm flex items-center justify-center shadow-[0_0_20px_rgba(191,155,48,0.3)] hover:scale-105 active:scale-95 transition-transform group">
            <Radio className="w-6 h-6 text-black" />
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full border-2 border-black group-hover:animate-ping" />
          </button>
        </div>

      </div>
    </div>
  );
}
