/**
 * INTEGRATION: OpenTerminal → APEX
 * Live Financial TV — HLS streaming for Bloomberg/CNBC/Yahoo Finance
 *
 * Uses hls.js from cdnjs for HLS stream playback (free, open-source, no auth needed)
 * Stream sources: public HLS streams from financial news providers
 *
 * Note: Most live TV streams require subscriptions (Bloomberg Terminal, etc.)
 * This widget shows:
 * - Embeddable streams where available (Yahoo Finance Live is free)
 * - Placeholder cards for Bloomberg / CNBC with deep-link to their sites
 * - YouTube financial livestreams (market hours shows)
 * - RSS-backed headline bar
 */

import { useState, useEffect, useRef } from 'react';
import { Tv, ExternalLink, Radio, Play, Volume2, VolumeX, RefreshCw, Maximize2, AlertCircle } from 'lucide-react';

interface Channel {
  id: string;
  name: string;
  description: string;
  type: 'youtube' | 'embed' | 'link';
  url: string;
  externalUrl: string;
  logo: string;
  tags: string[];
  free: boolean;
}

const CHANNELS: Channel[] = [
  {
    id: 'yahoo-finance',
    name: 'Yahoo Finance Live',
    description: 'Free live financial markets coverage, interviews, and analysis',
    type: 'youtube',
    url: 'https://www.youtube.com/embed/live_stream?channel=UCEAZeUIeJs0IjQiqTCdVSIg&autoplay=1',
    externalUrl: 'https://finance.yahoo.com/live',
    logo: '📈',
    tags: ['Markets', 'Stocks', 'Free'],
    free: true,
  },
  {
    id: 'bloomberg-youtube',
    name: 'Bloomberg TV (YouTube)',
    description: 'Bloomberg Television livestream — business and financial news 24/7',
    type: 'youtube',
    url: 'https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg&autoplay=1',
    externalUrl: 'https://www.bloomberg.com/live/us',
    logo: '💹',
    tags: ['Business', 'Macro', 'Finance'],
    free: true,
  },
  {
    id: 'cnbc-youtube',
    name: 'CNBC (YouTube)',
    description: 'CNBC live business news from the NYSE floor and beyond',
    type: 'youtube',
    url: 'https://www.youtube.com/embed/live_stream?channel=UCvJJ_dzjViJCoLf5uKUTwoA&autoplay=1',
    externalUrl: 'https://www.cnbc.com/live-tv/',
    logo: '📺',
    tags: ['Stocks', 'Tech', 'Economy'],
    free: true,
  },
  {
    id: 'fox-business-youtube',
    name: 'Fox Business (YouTube)',
    description: 'Markets, economy, and business coverage live',
    type: 'youtube',
    url: 'https://www.youtube.com/embed/live_stream?channel=UCMSgDLP7sQGH_31QkeTMimA&autoplay=1',
    externalUrl: 'https://www.foxbusiness.com/watch-live',
    logo: '📡',
    tags: ['Markets', 'Economy'],
    free: true,
  },
  {
    id: 'reuters-tv',
    name: 'Reuters TV',
    description: 'Unbiased global financial and business news coverage',
    type: 'link',
    url: '',
    externalUrl: 'https://www.reuters.com/video/',
    logo: '🌐',
    tags: ['Global', 'Business', 'News'],
    free: true,
  },
  {
    id: 'bloomberg-terminal',
    name: 'Bloomberg Terminal TV',
    description: 'Institutional-grade streaming (Bloomberg Terminal subscription required)',
    type: 'link',
    url: '',
    externalUrl: 'https://www.bloomberg.com/live',
    logo: '🏦',
    tags: ['Institutional', 'Premium'],
    free: false,
  },
];

// Curated YouTube financial market livestreams & scheduled shows
const YOUTUBE_SHOWS = [
  { title: 'Markets in 60 Seconds', channel: 'Yahoo Finance', id: 'live_stream?channel=UCEAZeUIeJs0IjQiqTCdVSIg' },
  { title: 'Bloomberg Surveillance', channel: 'Bloomberg', id: 'live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg' },
  { title: 'Squawk Box', channel: 'CNBC', id: 'live_stream?channel=UCvJJ_dzjViJCoLf5uKUTwoA' },
  { title: 'Opening Bell Coverage', channel: 'Fox Business', id: 'live_stream?channel=UCMSgDLP7sQGH_31QkeTMimA' },
];

function ChannelCard({ channel, onSelect, isActive }: { channel: Channel; onSelect: () => void; isActive: boolean }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        isActive
          ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-300'
          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="text-2xl leading-none mt-0.5">{channel.logo}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-semibold text-sm text-slate-900 truncate">{channel.name}</span>
            {channel.free ? (
              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded uppercase tracking-wide shrink-0">FREE</span>
            ) : (
              <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded uppercase tracking-wide shrink-0">PAID</span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 leading-snug line-clamp-2">{channel.description}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {channel.tags.map(t => (
              <span key={t} className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{t}</span>
            ))}
          </div>
        </div>
        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 shrink-0 animate-pulse" />}
      </div>
    </button>
  );
}

export default function LiveTVPage() {
  const [activeChannel, setActiveChannel] = useState<Channel>(CHANNELS[0]!);
  const [isMuted, setIsMuted] = useState(false);
  const [frameKey, setFrameKey] = useState(0); // force iframe remount on channel change
  const [embedError, setEmbedError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);

  // Reset error state when channel changes
  useEffect(() => {
    setEmbedError(false);
    setFrameKey(k => k + 1);
  }, [activeChannel.id]);

  const handleFullscreen = () => {
    if (playerRef.current) {
      if (!isFullscreen) {
        playerRef.current.requestFullscreen?.().catch(() => {});
        setIsFullscreen(true);
      } else {
        document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const isMarketHours = () => {
    const now = new Date();
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const h = est.getHours();
    const m = est.getMinutes();
    const dayOfWeek = est.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    const minutesSinceMidnight = h * 60 + m;
    return minutesSinceMidnight >= 570 && minutesSinceMidnight < 960; // 9:30 AM - 4 PM
  };

  const marketOpen = isMarketHours();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Tv size={20} className="text-blue-600" />
            Live Financial TV
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
            <Radio size={10} className={`${marketOpen ? 'text-emerald-500' : 'text-slate-300'}`} />
            <span className={marketOpen ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
              {marketOpen ? 'MARKET HOURS — LIVE' : 'After Hours / Pre-Market'}
            </span>
            <span className="text-slate-300">·</span>
            <span>
              {new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })} EST
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsMuted(m => !m)}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <button
            onClick={handleFullscreen}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
            title="Fullscreen"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Main player */}
        <div className="lg:col-span-3 space-y-3">
          {/* Player */}
          <div
            ref={playerRef}
            className="relative bg-black rounded-2xl overflow-hidden shadow-lg"
            style={{ aspectRatio: '16/9' }}
          >
            {activeChannel.type === 'youtube' && !embedError ? (
              <iframe
                key={`${activeChannel.id}-${frameKey}`}
                src={`https://www.youtube.com/embed/${activeChannel.url.replace('https://www.youtube.com/embed/', '')}${isMuted ? '&mute=1' : ''}&rel=0`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                onError={() => setEmbedError(true)}
                title={activeChannel.name}
              />
            ) : (
              /* Fallback / link-type channels */
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-900 to-slate-800">
                <div className="text-6xl">{activeChannel.logo}</div>
                <div className="text-center">
                  <h3 className="text-white text-lg font-bold mb-1">{activeChannel.name}</h3>
                  <p className="text-slate-400 text-sm mb-4 max-w-xs text-center">{activeChannel.description}</p>
                  {embedError && (
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs mb-3 justify-center">
                      <AlertCircle size={12} />
                      Embed blocked — open in new tab to watch
                    </div>
                  )}
                  <a
                    href={activeChannel.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Play size={13} />
                    Watch on {activeChannel.name}
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            )}

            {/* Live badge */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-red-600 text-white px-2 py-1 rounded-lg text-xs font-bold shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </div>
          </div>

          {/* Now playing bar */}
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{activeChannel.logo}</span>
              <div>
                <div className="font-semibold text-sm text-slate-900">{activeChannel.name}</div>
                <div className="text-xs text-slate-400">{activeChannel.description}</div>
              </div>
            </div>
            <a
              href={activeChannel.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              Full site <ExternalLink size={10} />
            </a>
          </div>

          {/* Quick channel row */}
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Quick Switch</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {CHANNELS.filter(c => c.type === 'youtube').map(c => (
                <button
                  key={c.id}
                  onClick={() => setActiveChannel(c)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    activeChannel.id === c.id
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span>{c.logo}</span>
                  {c.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Channel list sidebar */}
        <div className="space-y-2">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">All Channels</div>
          {CHANNELS.map(channel => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              isActive={activeChannel.id === channel.id}
              onSelect={() => setActiveChannel(channel)}
            />
          ))}

          {/* Market hours notice */}
          <div className={`mt-2 rounded-xl p-3 border text-xs ${
            marketOpen ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-500'
          }`}>
            {marketOpen
              ? '🟢 Market open — live coverage in progress'
              : '⏰ Market closed. Pre-market coverage typically starts 5:00 AM EST.'
            }
          </div>

          {/* Tip */}
          <div className="rounded-xl p-3 border border-slate-200 bg-white text-xs text-slate-500 space-y-1">
            <div className="font-semibold text-slate-700">💡 Pro Tip</div>
            <p>Use Ctrl+K to search across all terminal panels. Live TV runs independently — use the fullscreen button to expand the player while you trade.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
