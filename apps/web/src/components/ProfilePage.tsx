'use client';

import React, { useState, useRef, useEffect } from 'react';
import { User, ThemeAccent, StickerPack } from '@/types/database';
import { useTheme, WALLPAPER_PRESETS } from '@/lib/theme/ThemeContext';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import { uploadToSupabaseBucket } from '@/lib/supabase/storage';
import {
  ArrowLeft,
  Camera,
  Check,
  Sparkles,
  Plus,
  Trash2,
  Image as ImageIcon,
  CheckCheck,
  LogOut,
  AlertCircle,
  Loader2,
} from 'lucide-react';

interface ProfilePageProps {
  currentUser: User;
  onBack: () => void;
  onUpdateUser?: (updated: Partial<User>) => void;
  onSignOut?: () => void;
}

const ACCENT_OPTIONS: { id: ThemeAccent; name: string; gradient: string; primary: string }[] = [
  { id: 'violet-pink', name: 'Violet Pink', gradient: 'from-[#8A2387] via-[#E94057] to-[#F27121]', primary: '#E1306C' },
  { id: 'ocean-blue', name: 'Ocean Blue', gradient: 'from-[#00C6FF] to-[#0072FF]', primary: '#0084FF' },
  { id: 'emerald', name: 'Emerald', gradient: 'from-[#11998E] to-[#38EF7D]', primary: '#10B981' },
  { id: 'crimson', name: 'Crimson', gradient: 'from-[#FF416C] to-[#FF4B2B]', primary: '#EF4444' },
  { id: 'monochrome', name: 'Monochrome', gradient: 'from-[#555555] to-[#222222]', primary: '#E5E5E5' },
];

const DEMO_STICKER_PACKS = (userId: string): StickerPack[] => [
  {
    id: 'pack-01',
    name: 'Cyber Moods',
    creator_id: userId,
    created_at: new Date().toISOString(),
    stickers: [
      { id: 'stk-1', pack_id: 'pack-01', image_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120', created_at: '' },
      { id: 'stk-2', pack_id: 'pack-01', image_url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=120', created_at: '' },
    ],
  },
  {
    id: 'pack-02',
    name: 'Pixel Reactions (Community)',
    creator_id: 'user-other',
    created_at: new Date().toISOString(),
    stickers: [
      { id: 'stk-3', pack_id: 'pack-02', image_url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=120', created_at: '' },
    ],
  },
];

export default function ProfilePage({ currentUser, onBack, onUpdateUser, onSignOut }: ProfilePageProps) {
  const { accent, setAccent, wallpaper, setWallpaper, config } = useTheme();

  // Profile Form State
  const [displayName, setDisplayName] = useState(currentUser.display_name);
  const [bio, setBio] = useState(currentUser.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatar_url || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sticker Packs State
  const [stickerPacks, setStickerPacks] = useState<StickerPack[]>(
    isLiveSupabaseConfigured() ? [] : DEMO_STICKER_PACKS(currentUser.id)
  );
  const [newPackName, setNewPackName] = useState('');
  const [isCreatingPack, setIsCreatingPack] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickerFileInputRef = useRef<HTMLInputElement>(null);
  const [targetPackForSticker, setTargetPackForSticker] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(currentUser.display_name);
    setBio(currentUser.bio || '');
    setAvatarUrl(currentUser.avatar_url || '');
  }, [currentUser.display_name, currentUser.bio, currentUser.avatar_url]);

  // Load sticker packs from Supabase when live
  useEffect(() => {
    if (!isLiveSupabaseConfigured()) return;
    let active = true;
    supabase
      .from('sticker_packs')
      .select('*, stickers(*)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (active && data) {
          setStickerPacks(data as StickerPack[]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Upload Avatar Image to Supabase Storage (`avatars` bucket)
  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setIsUploadingAvatar(true);

    try {
      const uploaded = await uploadToSupabaseBucket('avatars', file, {
        folder: currentUser.id,
        fileName: file.name,
        maxBytes: 5 * 1024 * 1024,
      });
      setAvatarUrl(uploaded.publicUrl);
      onUpdateUser?.({ avatar_url: uploaded.publicUrl });
      if (isLiveSupabaseConfigured()) {
        const { error } = await supabase
          .from('users')
          .update({ avatar_url: uploaded.publicUrl })
          .eq('id', currentUser.id);
        if (error) throw new Error(error.message);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload avatar.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // Save Profile Changes
  const handleSaveProfile = async () => {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setErrorMsg('Display name cannot be empty.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    const updated = {
      display_name: trimmedName,
      bio: bio.trim(),
      avatar_url: avatarUrl,
      theme_accent: accent,
      chat_background_url: wallpaper,
    };

    try {
      if (isLiveSupabaseConfigured()) {
        const { error } = await supabase
          .from('users')
          .update({
            display_name: updated.display_name,
            bio: updated.bio,
            avatar_url: updated.avatar_url,
            theme_accent: accent,
            chat_background_url: wallpaper,
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentUser.id);
        if (error) throw new Error(error.message);
      }

      onUpdateUser?.(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      console.error('Failed to update profile:', err);
      setErrorMsg(err?.message || 'Failed to save profile changes.');
    } finally {
      setIsSaving(false);
    }
  };

  // Create Sticker Pack
  const handleCreateStickerPack = async () => {
    const name = newPackName.trim();
    if (!name) return;
    setErrorMsg(null);

    if (isLiveSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from('sticker_packs')
          .insert({ name, creator_id: currentUser.id })
          .select('*, stickers(*)')
          .single();
        if (error || !data) throw new Error(error?.message || 'Could not create sticker pack');
        setStickerPacks((prev) => [data as StickerPack, ...prev]);
        setNewPackName('');
        setIsCreatingPack(false);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to create sticker pack');
      }
      return;
    }

    const newPack: StickerPack = {
      id: `pack-${Date.now()}`,
      name,
      creator_id: currentUser.id,
      created_at: new Date().toISOString(),
      stickers: [],
    };
    setStickerPacks((prev) => [newPack, ...prev]);
    setNewPackName('');
    setIsCreatingPack(false);
  };

  // Delete Sticker Pack (creator or admin)
  const handleDeleteStickerPack = async (packId: string) => {
    setErrorMsg(null);
    if (isLiveSupabaseConfigured()) {
      const { error } = await supabase.from('sticker_packs').delete().eq('id', packId);
      if (error) {
        setErrorMsg(error.message || 'Could not delete sticker pack');
        return;
      }
    }
    setStickerPacks((prev) => prev.filter((p) => p.id !== packId));
  };

  // Add Sticker to Pack (`stickers` bucket)
  const handleAddStickerToPack = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const packId = targetPackForSticker;
    setTargetPackForSticker(null);
    if (!file || !packId) return;
    setErrorMsg(null);

    try {
      const uploaded = await uploadToSupabaseBucket('stickers', file, {
        folder: `${currentUser.id}/${packId}`,
        fileName: file.name,
        maxBytes: 5 * 1024 * 1024,
      });

      if (isLiveSupabaseConfigured()) {
        const { data, error } = await supabase
          .from('stickers')
          .insert({ pack_id: packId, image_url: uploaded.publicUrl })
          .select()
          .single();
        if (error || !data) throw new Error(error?.message || 'Failed to save sticker');
        setStickerPacks((prev) =>
          prev.map((pack) =>
            pack.id === packId
              ? { ...pack, stickers: [...(pack.stickers || []), data] }
              : pack
          )
        );
      } else {
        setStickerPacks((prev) =>
          prev.map((pack) =>
            pack.id === packId
              ? {
                  ...pack,
                  stickers: [
                    ...(pack.stickers || []),
                    {
                      id: `stk-${Date.now()}`,
                      pack_id: pack.id,
                      image_url: uploaded.publicUrl,
                      created_at: new Date().toISOString(),
                    },
                  ],
                }
              : pack
          )
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload sticker.');
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-black text-white overflow-y-auto custom-dark-scrollbar select-none">
      {/* Top Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-[#1F1F1F] bg-black/95 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-1.5 -ml-1 rounded-full hover:bg-[#1E1E1E] text-white transition active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-lg font-bold tracking-tight text-white">Profile &amp; Settings</h1>
        </div>

        {saveSuccess && (
          <span className="text-xs text-[#10B981] font-semibold flex items-center space-x-1 animate-fade-in">
            <CheckCheck className="w-4 h-4" />
            <span>Saved</span>
          </span>
        )}
      </div>

      <div className="p-4 space-y-8 max-w-md mx-auto w-full pb-12">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Profile Card & Avatar */}
        <div className="flex flex-col items-center pt-2">
          <div className="relative group mb-3">
            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-[#2A2A2A] bg-[#121212] flex items-center justify-center shadow-xl">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-white">
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
              className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity text-white text-xs font-semibold cursor-pointer"
            >
              {isUploadingAvatar ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <>
                  <Camera className="w-6 h-6 mb-1" />
                  <span>Change</span>
                </>
              )}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarFileChange}
              accept="image/*"
              className="hidden"
            />
          </div>

          <div className="flex items-center space-x-1.5 mb-1">
            <span className="text-sm font-semibold text-[#888888]">{currentUser.email}</span>
          </div>
        </div>

        {/* Display Name & Bio */}
        <div className="space-y-4 bg-[#121212] border border-[#2A2A2A] rounded-2xl p-4 shadow-lg">
          <div>
            <label className="text-xs font-semibold text-[#A0A0A0] block mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#444444]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#A0A0A0] block mb-1">Bio</label>
            <textarea
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 150))}
              placeholder="Tell friends about yourself..."
              className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#444444] resize-none"
            />
            <span className="text-[10px] text-[#666666] float-right mt-1">
              {bio.length}/150
            </span>
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={isSaving}
            className={`w-full py-2.5 rounded-xl font-bold text-sm text-white shadow-lg transition-transform active:scale-95 cursor-pointer disabled:opacity-50 ${config.gradientClass}`}
          >
            {isSaving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>

        {/* Accent Theme Selector (5 Options) */}
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center space-x-1.5">
              <Sparkles className="w-4 h-4 text-[#E1306C]" />
              <span>Select Accent Theme</span>
            </h2>
            <p className="text-xs text-[#777777]">
              Changes gradient message bubbles, unread badges, and highlights.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ACCENT_OPTIONS.map((theme) => {
              const isSelected = accent === theme.id;
              return (
                <button
                  key={theme.id}
                  onClick={() => setAccent(theme.id)}
                  className={`p-3 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-white bg-[#1A1A1A] shadow-lg'
                      : 'border-[#2A2A2A] bg-[#121212] hover:bg-[#181818]'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-6 h-6 rounded-full bg-gradient-to-tr ${theme.gradient} shadow`} />
                    <span className="text-sm font-medium text-white">{theme.name}</span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-white" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat Wallpaper Selector */}
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-white">Chat Wallpaper</h2>
            <p className="text-xs text-[#777777]">Choose your chat canvas pattern.</p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {WALLPAPER_PRESETS.map((wp) => {
              const isSelected = wallpaper === wp.url;
              return (
                <button
                  key={wp.id}
                  onClick={() => setWallpaper(wp.url)}
                  className={`h-16 rounded-xl border flex items-center justify-center p-2 text-center transition-all cursor-pointer ${
                    isSelected
                      ? 'border-white bg-[#1E1E1E]'
                      : 'border-[#2A2A2A] bg-[#121212] hover:bg-[#161616]'
                  }`}
                  style={{
                    background: wp.url || '#000000',
                    backgroundSize: 'cover',
                  }}
                >
                  <span className="text-xs font-semibold text-white drop-shadow-md">
                    {wp.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Sticker Pack Manager */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center space-x-1.5">
                <ImageIcon className="w-4 h-4 text-[#0084FF]" />
                <span>Custom Sticker Packs</span>
              </h2>
              <p className="text-xs text-[#777777]">
                Create and upload stickers to share in any chat.
              </p>
            </div>
            <button
              onClick={() => setIsCreatingPack(true)}
              className="p-1.5 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] text-white text-xs font-semibold flex items-center space-x-1 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Pack</span>
            </button>
          </div>

          {isCreatingPack && (
            <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-3 space-y-2">
              <input
                type="text"
                placeholder="Sticker Pack Name..."
                value={newPackName}
                onChange={(e) => setNewPackName(e.target.value)}
                className="w-full bg-[#1E1E1E] border border-[#333333] rounded-lg px-3 py-1.5 text-xs text-white outline-none"
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setIsCreatingPack(false)}
                  className="px-2.5 py-1 text-xs text-[#A0A0A0] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateStickerPack}
                  className={`px-3 py-1 text-xs font-bold text-white rounded-lg cursor-pointer ${config.gradientClass}`}
                >
                  Create
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {stickerPacks.map((pack) => (
              <div
                key={pack.id}
                className="bg-[#121212] border border-[#2A2A2A] rounded-xl p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white">{pack.name}</h3>
                    <span className="text-[10px] text-[#666666]">
                      {pack.stickers?.length || 0} stickers •{' '}
                      {pack.creator_id === currentUser.id ? 'Created by you' : 'Community Pack'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    {(pack.creator_id === currentUser.id || currentUser.role === 'admin') && (
                      <>
                        <button
                          onClick={() => {
                            setTargetPackForSticker(pack.id);
                            stickerFileInputRef.current?.click();
                          }}
                          title="Add Sticker"
                          className="p-1 rounded bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#A0A0A0] hover:text-white cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteStickerPack(pack.id)}
                          title="Delete Pack"
                          className="p-1 rounded bg-[#1E1E1E] hover:bg-red-900/40 text-[#A0A0A0] hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1">
                  {pack.stickers?.map((stk) => (
                    <div
                      key={stk.id}
                      className="w-16 h-16 rounded-lg bg-[#181818] border border-[#2A2A2A] overflow-hidden flex items-center justify-center p-1"
                    >
                      <img src={stk.image_url} alt="Sticker" className="max-w-full max-h-full object-contain" />
                    </div>
                  ))}
                  {(!pack.stickers || pack.stickers.length === 0) && (
                    <span className="text-[11px] text-[#555555] col-span-4 italic">
                      No stickers yet. Click + to add.
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <input
            type="file"
            ref={stickerFileInputRef}
            onChange={handleAddStickerToPack}
            accept="image/png,image/webp,image/gif"
            className="hidden"
          />
        </div>

        {/* Clean Sign Out Action */}
        {onSignOut && (
          <div className="pt-2">
            <button
              type="button"
              onClick={onSignOut}
              className="w-full py-3 rounded-2xl border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 font-semibold text-sm flex items-center justify-center space-x-2 transition-colors active:scale-95 cursor-pointer shadow-lg"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export { ProfilePage };
