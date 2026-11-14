'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Smile, Film, Sticker as StickerIcon, Loader2 } from 'lucide-react';
import { searchGifs, GifItem } from '@/lib/gifs/tenor';

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'emoji' | 'gif' | 'sticker';
  onSelectEmoji: (emoji: string) => void;
  onSelectGif: (gif: GifItem) => void;
  onSelectSticker: (stickerUrl: string) => void;
}

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys & People',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥹', '😊',
      '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙',
      '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎',
      '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁',
      '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😮‍💨', '😤',
      '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰',
    ],
  },
  {
    name: 'Gestures & Hearts',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
      '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️',
      '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐',
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❤️‍🔥', '❤️‍🩹', '💖', '💗', '💓', '💞', '💕', '💌', '✨', '🔥',
    ],
  },
  {
    name: 'Activities & Symbols',
    emojis: [
      '🎉', '🎊', '🎁', '🎈', '🍾', '🥂', '🍻', '🍺', '☕️', '🍕',
      '🍔', '🍟', '🌮', '🍩', '🍪', '⚽️', '🏀', '🏈', '🎾', '🎮',
      '🚀', '✈️', '⭐', '🌟', '⚡️', '💡', '💯', '✅', '❌', '⚠️',
    ],
  },
];

const DEFAULT_STICKERS = [
  'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
  'https://media.giphy.com/media/BzyTuYCmvSORqs1ABM/giphy.gif',
  'https://media.giphy.com/media/l3q2wJsC23ikJg9xe/giphy.gif',
  'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
];

export default function MediaPickerModal({
  isOpen,
  onClose,
  initialTab = 'emoji',
  onSelectEmoji,
  onSelectGif,
  onSelectSticker,
}: MediaPickerModalProps) {
  const [activeTab, setActiveTab] = useState<'emoji' | 'gif' | 'sticker'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);

  // In-memory query preview cache for GIF queries
  const gifCache = useRef<Record<string, GifItem[]>>({});

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Debounced GIF search with query preview caching
  useEffect(() => {
    if (activeTab !== 'gif') return;
    const query = searchQuery.trim();

    if (gifCache.current[query]) {
      setGifs(gifCache.current[query]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingGifs(true);
      const results = await searchGifs(query);
      gifCache.current[query] = results;
      setGifs(results);
      setIsSearchingGifs(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, activeTab]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[440px] h-[520px] rounded-t-3xl sm:rounded-3xl bg-[#121212] border border-[#2A2A2A] shadow-2xl flex flex-col overflow-hidden animate-slide-up"
      >
        {/* Modal Header & Tabs */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[#242424]">
          <div className="flex gap-1 p-1 bg-[#1A1A1A] rounded-xl border border-[#2A2A2A]">
            <button
              type="button"
              onClick={() => setActiveTab('emoji')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'emoji'
                  ? 'bg-[#2A2A2A] text-white shadow'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              <Smile className="w-3.5 h-3.5" />
              <span>Emoji</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('gif')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'gif'
                  ? 'bg-[#2A2A2A] text-white shadow'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>GIFs</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sticker')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'sticker'
                  ? 'bg-[#2A2A2A] text-white shadow'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              <StickerIcon className="w-3.5 h-3.5" />
              <span>Stickers</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#222222]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input Bar */}
        {(activeTab === 'emoji' || activeTab === 'gif') && (
          <div className="px-4 py-2 border-b border-[#222222]">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A]">
              <Search className="w-4 h-4 text-[#888888]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  activeTab === 'emoji' ? 'Search emojis...' : 'Search Tenor / Giphy...'
                }
                className="w-full bg-transparent text-xs text-white placeholder-[#666666] outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-[#888888] hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tab Body Contents */}
        <div className="flex-1 overflow-y-auto p-4 custom-dark-scrollbar">
          {/* TAB 1: EMOJIS */}
          {activeTab === 'emoji' && (
            <div className="space-y-4">
              {EMOJI_CATEGORIES.map((category) => (
                <div key={category.name}>
                  <div className="text-[11px] font-semibold text-[#888888] mb-2 uppercase tracking-wider">
                    {category.name}
                  </div>
                  <div className="grid grid-cols-7 sm:grid-cols-8 gap-2">
                    {category.emojis
                      .filter((e) => !searchQuery || e.includes(searchQuery))
                      .map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            onSelectEmoji(emoji);
                            onClose();
                          }}
                          className="text-2xl p-1.5 rounded-lg hover:bg-[#222222] active:scale-90 transition-transform flex items-center justify-center"
                        >
                          {emoji}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 2: GIFS */}
          {activeTab === 'gif' && (
            <div>
              {isSearchingGifs ? (
                <div className="flex flex-col items-center justify-center py-20 text-[#888888] gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#E1306C]" />
                  <span className="text-xs">Searching Tenor...</span>
                </div>
              ) : gifs.length === 0 ? (
                <div className="text-center py-20 text-xs text-[#888888]">
                  No GIFs found.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {gifs.map((gif) => (
                    <button
                      key={gif.id}
                      type="button"
                      onClick={() => {
                        onSelectGif(gif);
                        onClose();
                      }}
                      className="group relative rounded-xl overflow-hidden aspect-video bg-[#1A1A1A] hover:ring-2 hover:ring-[#E1306C] transition-all"
                    >
                      <img
                        src={gif.previewUrl}
                        alt={gif.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: STICKERS */}
          {activeTab === 'sticker' && (
            <div>
              <div className="text-[11px] font-semibold text-[#888888] mb-3 uppercase tracking-wider">
                Custom Sticker Packs
              </div>
              <div className="grid grid-cols-3 gap-3">
                {DEFAULT_STICKERS.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      onSelectSticker(url);
                      onClose();
                    }}
                    className="p-2 rounded-2xl bg-[#181818] border border-[#262626] hover:bg-[#222222] transition-colors flex items-center justify-center"
                  >
                    <img
                      src={url}
                      alt="Sticker"
                      className="w-20 h-20 object-contain hover:scale-105 transition-transform"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { MediaPickerModal };
