// External collection-database connectors. Every search returns a normalized
// array of { title, subtitle, year, thumb, link, fields } candidates that the
// item editor can apply as a prefill.
//
// Keyless: BoardGameGeek, Open Library, Google Books.
// User-supplied free keys (Settings): TMDB, RAWG, Comic Vine.
// BGG and Comic Vine don't send CORS headers, so those calls fall back to a
// configurable CORS proxy when a direct fetch is blocked.

import { getSettings } from './settings.js';

function proxied(url) {
  const { corsProxy } = getSettings();
  const template = corsProxy || 'https://corsproxy.io/?url={url}';
  return template.replace('{url}', encodeURIComponent(url));
}

async function fetchTextMaybeProxied(url) {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.text();
    throw new Error(`HTTP ${res.status}`);
  } catch {
    const res = await fetch(proxied(url));
    if (!res.ok) throw new Error(`Lookup failed (HTTP ${res.status} via proxy)`);
    return await res.text();
  }
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Lookup failed (HTTP ${res.status})`);
  return res.json();
}

const num = v => (v == null || v === '' || isNaN(+v)) ? '' : +v;

// ---------- BoardGameGeek (XML API2, no key) ----------

async function searchBGG(query) {
  const searchXml = await fetchTextMaybeProxied(
    `https://boardgamegeek.com/xmlapi2/search?type=boardgame,boardgameexpansion&query=${encodeURIComponent(query)}`);
  const doc = new DOMParser().parseFromString(searchXml, 'text/xml');
  const ids = [...doc.querySelectorAll('item')].slice(0, 10).map(el => el.getAttribute('id'));
  if (!ids.length) return [];
  const thingXml = await fetchTextMaybeProxied(
    `https://boardgamegeek.com/xmlapi2/thing?id=${ids.join(',')}&stats=1`);
  const things = new DOMParser().parseFromString(thingXml, 'text/xml');
  return [...things.querySelectorAll('item')].map(el => {
    const get = sel => el.querySelector(sel);
    const attr = (sel, a = 'value') => get(sel)?.getAttribute(a) || '';
    const name = el.querySelector('name[type="primary"]')?.getAttribute('value') || '';
    const year = attr('yearpublished');
    const minP = attr('minplayers'), maxP = attr('maxplayers');
    const rating = get('statistics ratings average')?.getAttribute('value');
    const designers = [...el.querySelectorAll('link[type="boardgamedesigner"]')].map(l => l.getAttribute('value')).slice(0, 3).join(', ');
    const publishers = [...el.querySelectorAll('link[type="boardgamepublisher"]')].map(l => l.getAttribute('value')).slice(0, 1).join(', ');
    const id = el.getAttribute('id');
    return {
      title: name,
      subtitle: [designers, publishers].filter(Boolean).join(' — '),
      year,
      thumb: get('thumbnail')?.textContent || '',
      link: `https://boardgamegeek.com/boardgame/${id}`,
      fields: {
        designer: designers, publisher: publishers, year,
        players: minP && maxP ? (minP === maxP ? minP : `${minP}–${maxP}`) : '',
        playtime: attr('playingtime') || '',
        bggId: id,
        bggRating: rating ? (Math.round(+rating * 10) / 10) : '',
      },
      imageUrl: get('image')?.textContent || get('thumbnail')?.textContent || '',
    };
  });
}

// ---------- Open Library + Google Books fallback (no key) ----------

async function searchOpenLibrary(query) {
  const isIsbn = /^[\d\-xX]{9,17}$/.test(query.trim());
  const q = isIsbn ? `isbn:${query.replace(/-/g, '')}` : query;
  const data = await fetchJSON(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=key,title,author_name,first_publish_year,cover_i,isbn,publisher,number_of_pages_median`);
  return (data.docs || []).map(d => ({
    title: d.title || '',
    subtitle: (d.author_name || []).slice(0, 2).join(', '),
    year: d.first_publish_year || '',
    thumb: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
    link: d.key ? `https://openlibrary.org${d.key}` : '',
    fields: {
      author: (d.author_name || []).join(', '),
      year: d.first_publish_year || '',
      isbn: (d.isbn || []).find(i => i.length === 13) || (d.isbn || [])[0] || '',
      publisher: (d.publisher || [])[0] || '',
      pages: num(d.number_of_pages_median),
    },
    imageUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
  }));
}

async function searchGoogleBooks(query) {
  const data = await fetchJSON(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books`);
  return (data.items || []).map(it => {
    const v = it.volumeInfo || {};
    const isbn13 = (v.industryIdentifiers || []).find(x => x.type === 'ISBN_13')?.identifier || '';
    const thumb = (v.imageLinks?.thumbnail || '').replace(/^http:/, 'https:');
    return {
      title: v.title || '',
      subtitle: (v.authors || []).slice(0, 2).join(', '),
      year: (v.publishedDate || '').slice(0, 4),
      thumb,
      link: v.infoLink || '',
      fields: {
        author: (v.authors || []).join(', '),
        year: (v.publishedDate || '').slice(0, 4),
        isbn: isbn13,
        publisher: v.publisher || '',
        pages: num(v.pageCount),
        genre: (v.categories || [])[0] || '',
      },
      imageUrl: thumb,
    };
  });
}

async function searchBooks(query) {
  let results = [];
  try { results = await searchOpenLibrary(query); } catch { /* fall through */ }
  if (results.length) return results;
  return searchGoogleBooks(query);
}

// ---------- TMDB (free key required) ----------

async function searchTMDB(query) {
  const { tmdbKey } = getSettings();
  if (!tmdbKey) throw new NeedsKeyError('TMDB', 'https://www.themoviedb.org/settings/api');
  const data = await fetchJSON(
    `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(tmdbKey)}&query=${encodeURIComponent(query)}&include_adult=false`);
  return (data.results || [])
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 12)
    .map(r => {
      const isTv = r.media_type === 'tv';
      const title = isTv ? r.name : r.title;
      const year = ((isTv ? r.first_air_date : r.release_date) || '').slice(0, 4);
      const poster = r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : '';
      return {
        title: title || '',
        subtitle: isTv ? 'TV series' : 'Movie',
        year,
        thumb: poster,
        link: `https://www.themoviedb.org/${r.media_type}/${r.id}`,
        fields: { year, genre: '' },
        imageUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : '',
      };
    });
}

// ---------- RAWG (free key required) ----------

async function searchRAWG(query) {
  const { rawgKey } = getSettings();
  if (!rawgKey) throw new NeedsKeyError('RAWG', 'https://rawg.io/apidocs');
  const data = await fetchJSON(
    `https://api.rawg.io/api/games?key=${encodeURIComponent(rawgKey)}&search=${encodeURIComponent(query)}&page_size=12`);
  return (data.results || []).map(g => ({
    title: g.name || '',
    subtitle: (g.platforms || []).map(p => p.platform?.name).filter(Boolean).slice(0, 4).join(', '),
    year: (g.released || '').slice(0, 4),
    thumb: g.background_image || '',
    link: g.slug ? `https://rawg.io/games/${g.slug}` : '',
    fields: {
      year: (g.released || '').slice(0, 4),
      platform: (g.platforms || []).map(p => p.platform?.name).filter(Boolean).slice(0, 3).join(', '),
      genre: (g.genres || []).map(x => x.name).slice(0, 2).join(', '),
    },
    imageUrl: g.background_image || '',
  }));
}

// ---------- Comic Vine (free key required, needs CORS proxy) ----------

async function searchComicVine(query) {
  const { comicVineKey } = getSettings();
  if (!comicVineKey) throw new NeedsKeyError('Comic Vine', 'https://comicvine.gamespot.com/api/');
  const url = `https://comicvine.gamespot.com/api/search/?api_key=${encodeURIComponent(comicVineKey)}&format=json&resources=volume&limit=12&query=${encodeURIComponent(query)}`;
  const text = await fetchTextMaybeProxied(url);
  const data = JSON.parse(text);
  if (data.error && data.error !== 'OK') throw new Error(`Comic Vine: ${data.error}`);
  return (data.results || []).map(v => ({
    title: v.name || '',
    subtitle: [v.publisher?.name, v.count_of_issues ? `${v.count_of_issues} issues` : ''].filter(Boolean).join(' — '),
    year: v.start_year || '',
    thumb: v.image?.small_url || '',
    link: v.site_detail_url || '',
    fields: {
      series: v.name || '',
      publisher: v.publisher?.name || '',
      year: v.start_year || '',
    },
    imageUrl: v.image?.medium_url || v.image?.small_url || '',
  }));
}

export class NeedsKeyError extends Error {
  constructor(service, signupUrl) {
    super(`${service} needs a free API key — add yours in Settings.`);
    this.service = service;
    this.signupUrl = signupUrl;
  }
}

export const LOOKUP = {
  boardgame: { name: 'BoardGameGeek', search: searchBGG, keyless: true },
  book: { name: 'Open Library / Google Books', search: searchBooks, keyless: true },
  movie: { name: 'TMDB', search: searchTMDB, keyless: false, keySetting: 'tmdbKey' },
  videogame: { name: 'RAWG', search: searchRAWG, keyless: false, keySetting: 'rawgKey' },
  comic: { name: 'Comic Vine', search: searchComicVine, keyless: false, keySetting: 'comicVineKey' },
};
