// apps/web/src/lib/gifs/tenor.ts

export interface GifItem {
  id: string;
  title: string;
  previewUrl: string;
  fullUrl: string;
}

const FALLBACK_GIFS: GifItem[] = [
  {
    id: '1',
    title: 'Thumbs Up Cat',
    previewUrl: 'https://media.giphy.com/media/BzyTuYCmvSORqs1ABM/giphy.gif',
    fullUrl: 'https://media.giphy.com/media/BzyTuYCmvSORqs1ABM/giphy.gif',
  },
  {
    id: '2',
    title: 'Mind Blown',
    previewUrl: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
    fullUrl: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
  },
  {
    id: '3',
    title: 'Party Parrot',
    previewUrl: 'https://media.giphy.com/media/l3q2wJsC23ikJg9xe/giphy.gif',
    fullUrl: 'https://media.giphy.com/media/l3q2wJsC23ikJg9xe/giphy.gif',
  },
  {
    id: '4',
    title: 'Hello Wave',
    previewUrl: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
    fullUrl: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
  },
  {
    id: '5',
    title: 'Excited Dog',
    previewUrl: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
    fullUrl: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
  },
  {
    id: '6',
    title: 'Dancing Kid',
    previewUrl: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
    fullUrl: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
  },
];

export async function searchGifs(query: string): Promise<GifItem[]> {
  const tenorKey = process.env.NEXT_PUBLIC_TENOR_API_KEY;
  const giphyKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;

  if (giphyKey) {
    try {
      const endpoint = query.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${giphyKey}&q=${encodeURIComponent(query)}&limit=12&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${giphyKey}&limit=12&rating=g`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const json = await res.json();
        return json.data.map((item: any) => ({
          id: item.id,
          title: item.title,
          previewUrl: item.images.fixed_height_small.url,
          fullUrl: item.images.original.url,
        }));
      }
    } catch (e) {
      console.warn('Giphy API error, falling back', e);
    }
  }

  if (tenorKey) {
    try {
      const endpoint = query.trim()
        ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${tenorKey}&limit=12`
        : `https://tenor.googleapis.com/v2/featured?key=${tenorKey}&limit=12`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const json = await res.json();
        return json.results.map((item: any) => ({
          id: item.id,
          title: item.content_description,
          previewUrl: item.media_formats.tinygif.url,
          fullUrl: item.media_formats.gif.url,
        }));
      }
    } catch (e) {
      console.warn('Tenor API error, falling back', e);
    }
  }

  // Filter fallback gifs by query
  if (query.trim()) {
    return FALLBACK_GIFS.filter((g) => g.title.toLowerCase().includes(query.toLowerCase()));
  }
  return FALLBACK_GIFS;
}
