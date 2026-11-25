'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Search,
  Smile,
  Film,
  Sticker as StickerIcon,
  Image as ImageIcon,
  Upload,
  Send,
  Loader2,
} from 'lucide-react';
import { searchGifs, GifItem } from '@/lib/gifs/tenor';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import { formatFileSize, MAX_SUPABASE_STORAGE_BYTES } from '@/lib/supabase/storage';

export type MediaPickerTab = 'emoji' | 'gif' | 'sticker' | 'photo';

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: MediaPickerTab;
  reactionOnly?: boolean;
  onSelectEmoji: (emoji: string) => void;
  onSelectGif: (gif: GifItem) => void;
  onSelectSticker: (stickerUrl: string) => void;
  onSelectPhoto?: (file: File, options: { isViewOnce: boolean; caption: string }) => Promise<void> | void;
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
  reactionOnly = false,
  onSelectEmoji,
  onSelectGif,
  onSelectSticker,
  onSelectPhoto,
}: MediaPickerModalProps) {
  const [activeTab, setActiveTab] = useState<MediaPickerTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);
  const [customStickers, setCustomStickers] = useState<string[]>([]);

  // Image/Photo attachment preview state (View Once is ONLY allowed here for images)
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoViewOnce, setPhotoViewOnce] = useState(false);
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isSendingPhoto, setIsSendingPhoto] = useState(false);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const gifCache = useRef<Record<string, GifItem[]>>({});

  useEffect(() => {
    if (isOpen) {
      setActiveTab(reactionOnly ? 'emoji' : initialTab);
      setSearchQuery('');
      setPhotoError(null);
    } else {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
      setSelectedPhotoFile(null);
      setPhotoPreviewUrl(null);
      setPhotoViewOnce(false);
      setPhotoCaption('');
      setPhotoError(null);
      setIsSendingPhoto(false);
    }
  }, [isOpen, initialTab, reactionOnly]);

  // Load community & user stickers from Supabase when live
  useEffect(() => {
    if (!isOpen || activeTab !== 'sticker' || !isLiveSupabaseConfigured()) return;
    let active = true;
    supabase
      .from('stickers')
      .select('image_url')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (active && data) {
          setCustomStickers(data.map((s: any) => s.image_url).filter(Boolean));
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen, activeTab]);

  // Debounced GIF search with query preview caching
  useEffect(() => {
    if (!isOpen || activeTab !== 'gif') return;
    const query = searchQuery.trim();

    if (gifCache.current[query]) {
      setGifs(gifCache.current[query]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingGifs(true);
      try {
        const results = await searchGifs(query);
        gifCache.current[query] = results;
        setGifs(results);
      } catch {
        setGifs([]);
      } finally {
        setIsSearchingGifs(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, activeTab, isOpen]);

  const handlePhotoChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);

    const isImage =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(file.name);
    if (!isImage) {
      setPhotoError('Please choose a valid image file (PNG, JPG, WEBP, GIF).');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_SUPABASE_STORAGE_BYTES) {
      setPhotoError('Photo exceeds 50 MB storage limit. Send files > 50 MB via P2P attachment.');
      e.target.value = '';
      return;
    }

    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setSelectedPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setPhotoViewOnce(false);
    e.target.value = '';
  };

  const handleConfirmSendPhoto = async () => {
    if (!selectedPhotoFile || !onSelectPhoto || isSendingPhoto) return;
    setIsSendingPhoto(true);
    setPhotoError(null);
    try {
      await onSelectPhoto(selectedPhotoFile, {
        isViewOnce: photoViewOnce,
        caption: photoViewOnce ? '' : photoCaption.trim(),
      });
      onClose();
    } catch (err: any) {
      setPhotoError(err?.message || 'Failed to upload photo. Please try again.');
      setIsSendingPhoto(false);
    }
  };

  if (!isOpen) return null;

  const stickerGallery = Array.from(new Set([...customStickers, ...DEFAULT_STICKERS]));

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
          {reactionOnly ? (
            <div className="text-xs font-semibold text-white px-2 py-1.5">
              Choose Reaction
            </div>
          ) : (
            <div className="flex gap-1 p-1 bg-[#1A1A1A] rounded-xl border border-[#2A2A2A]">
              <button
                type="button"
                onClick={() => setActiveTab('emoji')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'sticker'
                    ? 'bg-[#2A2A2A] text-white shadow'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                <StickerIcon className="w-3.5 h-3.5" />
                <span>Stickers</span>
              </button>
              {onSelectPhoto && (
                <button
                  type="button"
                  onClick={() => setActiveTab('photo')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'photo'
                      ? 'bg-[#2A2A2A] text-white shadow'
                      : 'text-[#A0A0A0] hover:text-white'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Photo</span>
                </button>
              )}
            </div>
          )}

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
                  <span className="text-xs">Searching GIFs...</span>
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
                {stickerGallery.map((url, i) => (
                  <button
                    key={`${url}-${i}`}
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

          {/* TAB 4: PHOTO ATTACHMENT WITH VIEW-ONCE ("1") TOGGLE (IMAGE ONLY) */}
          {activeTab === 'photo' && onSelectPhoto && (
            <div className="h-full flex flex-col justify-between gap-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChosen}
              />

              {photoError && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {photoError}
                </div>
              )}

              {!selectedPhotoFile || !photoPreviewUrl ? (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="flex-1 rounded-2xl border-2 border-dashed border-[#2E2E2E] hover:border-[#E1306C] bg-[#161616] flex flex-col items-center justify-center gap-3 p-6 transition-colors"
                >
                  <div className="w-14 h-14 rounded-2xl bg-[#222222] flex items-center justify-center text-[#E1306C]">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-white">Select Photo to Send</p>
                    <p className="text-xs text-[#888888] mt-1">
                      Supports standard photos or View Once (1) photos up to 50 MB
                    </p>
                  </div>
                </button>
              ) : (
                <div className="flex-1 flex flex-col gap-3 min-h-0">
                  <div className="relative flex-1 rounded-2xl overflow-hidden bg-black border border-[#2A2A2A] flex items-center justify-center min-h-0">
                    <img
                      src={photoPreviewUrl}
                      alt={selectedPhotoFile.name}
                      className="max-h-full max-w-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
                        setSelectedPhotoFile(null);
                        setPhotoPreviewUrl(null);
                        setPhotoViewOnce(false);
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white hover:bg-black"
                      title="Remove photo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-full bg-black/70 text-[10px] text-white/90">
                      {selectedPhotoFile.name} • {formatFileSize(selectedPhotoFile.size)}
                    </div>
                  </div>

                  {/* Caption + View Once ("1") Toggle strictly for this Image */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPhotoViewOnce((prev) => !prev)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                        photoViewOnce
                          ? 'bg-gradient-to-tr from-[#E1306C] to-[#F27121] border-transparent text-white shadow-lg'
                          : 'bg-[#1A1A1A] border-[#2A2A2A] text-[#A0A0A0] hover:text-white'
                      }`}
                      title="Toggle View Once Photo"
                    >
                      <span className="w-4 h-4 rounded-full border-2 border-current border-dashed flex items-center justify-center text-[9px] font-bold">
                        1
                      </span>
                      <span>{photoViewOnce ? 'View Once On' : 'View Once'}</span>
                    </button>

                    <input
                      type="text"
                      value={photoCaption}
                      onChange={(e) => setPhotoCaption(e.target.value)}
                      disabled={photoViewOnce}
                      placeholder={photoViewOnce ? 'Captions disabled for View Once' : 'Add a caption...'}
                      className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-2 text-xs text-white placeholder-[#666666] outline-none disabled:opacity-50"
                    />

                    <button
                      type="button"
                      onClick={handleConfirmSendPhoto}
                      disabled={isSendingPhoto}
                      className="px-3.5 py-2 rounded-xl bg-gradient-to-tr from-[#8A2387] via-[#E94057] to-[#F27121] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isSendingPhoto ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      <span>Send</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { MediaPickerModal };
