// Item type definitions: fields, statuses, and CSV header aliases for import mapping.

export const STATUSES = [
  'Owned', 'Wishlist', 'Pre-ordered', 'On Loan', 'For Sale/Trade', 'Sold', 'Given Away'
];

export const CONDITIONS = [
  '', 'Mint', 'Near Mint', 'Very Good', 'Good', 'Fair', 'Poor'
];

// Field input kinds: text, number, year, select, textarea, checkbox
const F = (key, label, input = 'text', extra = {}) => ({ key, label, input, ...extra });

export const COMMON_FIELDS = [
  F('condition', 'Condition', 'select', { options: CONDITIONS, aliases: ['condition', 'cond'] }),
  F('quantity', 'Quantity', 'number', { aliases: ['quantity', 'qty', 'count', 'copies'] }),
  F('purchasePrice', 'Purchase price', 'number', { step: '0.01', aliases: ['purchase price', 'price paid', 'paid', 'cost', 'price'] }),
  F('currentValue', 'Est. value', 'number', { step: '0.01', aliases: ['value', 'current value', 'est value', 'estimated value', 'worth'] }),
  F('purchaseDate', 'Purchase date', 'text', { placeholder: 'YYYY-MM-DD', aliases: ['purchase date', 'date purchased', 'acquired', 'date acquired', 'bought'] }),
  F('location', 'Location', 'text', { placeholder: 'Shelf, room, bin…', aliases: ['location', 'shelf', 'storage', 'where'] }),
  F('loanedTo', 'Loaned to', 'text', { placeholder: 'Who has it (status: On Loan)', aliases: ['loaned to', 'borrowed by', 'lent to'] }),
];

export const TYPES = {
  book: {
    label: 'Books', singular: 'Book', icon: '📚',
    db: 'Open Library + Google Books',
    fields: [
      F('author', 'Author', 'text', { aliases: ['author', 'authors', 'writer', 'by'] }),
      F('isbn', 'ISBN', 'text', { aliases: ['isbn', 'isbn13', 'isbn-13', 'isbn10', 'isbn-10'] }),
      F('publisher', 'Publisher', 'text', { aliases: ['publisher'] }),
      F('year', 'Year', 'year', { aliases: ['year', 'published', 'publication year', 'release year', 'date published'] }),
      F('format', 'Format', 'select', { options: ['', 'Hardcover', 'Paperback', 'Trade Paperback', 'Mass Market', 'Ebook', 'Audiobook', 'Other'], aliases: ['format', 'binding', 'edition type'] }),
      F('pages', 'Pages', 'number', { aliases: ['pages', 'page count'] }),
      F('series', 'Series', 'text', { aliases: ['series'] }),
      F('seriesNum', 'Series #', 'text', { aliases: ['series #', 'series number', 'book number', 'volume'] }),
      F('genre', 'Genre', 'text', { aliases: ['genre', 'category', 'subject'] }),
      F('readStatus', 'Read status', 'select', { options: ['', 'Unread', 'Reading', 'Read', 'Abandoned'], aliases: ['read', 'read status'] }),
    ],
  },
  movie: {
    label: 'Movies & TV', singular: 'Movie / TV', icon: '🎬',
    db: 'TMDB',
    fields: [
      F('director', 'Director', 'text', { aliases: ['director', 'directors'] }),
      F('year', 'Year', 'year', { aliases: ['year', 'release year', 'released'] }),
      F('format', 'Format', 'select', { options: ['', 'DVD', 'Blu-ray', '4K UHD', 'VHS', 'Digital', 'LaserDisc', 'Other'], aliases: ['format', 'media', 'media type'] }),
      F('edition', 'Edition', 'text', { placeholder: "Director's cut, steelbook…", aliases: ['edition', 'version'] }),
      F('season', 'Season(s)', 'text', { aliases: ['season', 'seasons'] }),
      F('runtime', 'Runtime (min)', 'number', { aliases: ['runtime', 'length', 'duration'] }),
      F('studio', 'Studio', 'text', { aliases: ['studio', 'distributor'] }),
      F('genre', 'Genre', 'text', { aliases: ['genre'] }),
      F('watchStatus', 'Watched?', 'select', { options: ['', 'Unwatched', 'Watching', 'Watched'], aliases: ['watched', 'watch status'] }),
    ],
  },
  videogame: {
    label: 'Video Games', singular: 'Video Game', icon: '🎮',
    db: 'RAWG',
    fields: [
      F('platform', 'Platform', 'text', { placeholder: 'NES, PS5, PC…', aliases: ['platform', 'system', 'console'] }),
      F('developer', 'Developer', 'text', { aliases: ['developer', 'dev'] }),
      F('publisher', 'Publisher', 'text', { aliases: ['publisher'] }),
      F('year', 'Year', 'year', { aliases: ['year', 'release year', 'released'] }),
      F('region', 'Region', 'select', { options: ['', 'NTSC-U', 'NTSC-J', 'PAL', 'Region Free', 'Other'], aliases: ['region'] }),
      F('completeness', 'Completeness', 'select', { options: ['', 'Sealed', 'CIB (complete in box)', 'Box + game', 'Loose', 'Digital'], aliases: ['completeness', 'complete', 'cib'] }),
      F('genre', 'Genre', 'text', { aliases: ['genre'] }),
      F('playStatus', 'Play status', 'select', { options: ['', 'Unplayed', 'Playing', 'Beaten', 'Completed 100%', 'Shelved'], aliases: ['play status', 'played', 'beaten'] }),
    ],
  },
  boardgame: {
    label: 'Board Games', singular: 'Board Game', icon: '🎲',
    db: 'BoardGameGeek',
    fields: [
      F('designer', 'Designer', 'text', { aliases: ['designer', 'designers'] }),
      F('publisher', 'Publisher', 'text', { aliases: ['publisher'] }),
      F('year', 'Year', 'year', { aliases: ['year', 'published', 'release year'] }),
      F('players', 'Players', 'text', { placeholder: '2–4', aliases: ['players', 'player count', 'num players'] }),
      F('playtime', 'Playtime (min)', 'text', { aliases: ['playtime', 'play time', 'duration', 'length'] }),
      F('bggId', 'BGG ID', 'text', { aliases: ['bgg id', 'bggid', 'bgg'] }),
      F('bggRating', 'BGG rating', 'number', { step: '0.1', aliases: ['bgg rating', 'geek rating'] }),
      F('expansionOf', 'Expansion of', 'text', { placeholder: 'Base game, if expansion', aliases: ['expansion of', 'base game', 'expansion'] }),
      F('playCount', 'Play count', 'number', { aliases: ['play count', 'plays', 'times played'] }),
    ],
  },
  actionfigure: {
    label: 'Action Figures', singular: 'Action Figure', icon: '🦾',
    db: null,
    dbNote: 'No public database API exists for action figures — use manual entry. Reference sites: theafdb.com, actionfigureindex.com, hobbydb.com.',
    fields: [
      F('character', 'Character', 'text', { aliases: ['character', 'figure'] }),
      F('line', 'Toyline', 'text', { placeholder: 'Marvel Legends, MOTU…', aliases: ['line', 'toyline', 'toy line', 'brand line'] }),
      F('manufacturer', 'Manufacturer', 'text', { placeholder: 'Hasbro, NECA, Bandai…', aliases: ['manufacturer', 'maker', 'brand', 'company'] }),
      F('wave', 'Series / wave', 'text', { aliases: ['wave', 'series', 'assortment'] }),
      F('scale', 'Scale', 'text', { placeholder: '1:12, 6-inch…', aliases: ['scale', 'size'] }),
      F('year', 'Year', 'year', { aliases: ['year', 'release year', 'released'] }),
      F('completeness', 'Completeness', 'select', { options: ['', 'MOC/MISB (sealed)', 'MIB (opened box)', 'Loose, complete', 'Loose, incomplete'], aliases: ['completeness', 'packaging', 'boxed'] }),
      F('accessories', 'Accessories', 'textarea', { aliases: ['accessories', 'includes'] }),
    ],
  },
  comic: {
    label: 'Comic Books', singular: 'Comic Book', icon: '💥',
    db: 'Comic Vine',
    fields: [
      F('series', 'Series / title', 'text', { aliases: ['series', 'volume name'] }),
      F('issueNum', 'Issue #', 'text', { aliases: ['issue', 'issue #', 'issue number', 'number', '#'] }),
      F('volume', 'Volume', 'text', { aliases: ['volume', 'vol'] }),
      F('publisher', 'Publisher', 'text', { aliases: ['publisher'] }),
      F('year', 'Year', 'year', { aliases: ['year', 'cover date', 'published'] }),
      F('writer', 'Writer', 'text', { aliases: ['writer', 'author'] }),
      F('artist', 'Artist', 'text', { aliases: ['artist', 'penciller'] }),
      F('variant', 'Variant', 'text', { aliases: ['variant', 'cover variant'] }),
      F('grade', 'Grade', 'text', { placeholder: 'CGC 9.8, raw NM…', aliases: ['grade', 'cgc', 'grading'] }),
      F('keyIssue', 'Key issue notes', 'text', { placeholder: '1st appearance of…', aliases: ['key', 'key issue', 'key notes'] }),
      F('readStatus', 'Read status', 'select', { options: ['', 'Unread', 'Read'], aliases: ['read', 'read status'] }),
    ],
  },
  other: {
    label: 'Other', singular: 'Item', icon: '🗃️',
    db: null,
    fields: [
      F('category', 'Category', 'text', { placeholder: 'Vinyl, LEGO, cards…', aliases: ['category', 'kind', 'type of item'] }),
      F('maker', 'Maker / brand', 'text', { aliases: ['maker', 'brand', 'manufacturer', 'artist', 'company'] }),
      F('year', 'Year', 'year', { aliases: ['year', 'released'] }),
      F('detail1', 'Detail', 'text', { aliases: ['detail', 'description'] }),
    ],
  },
};

export const TYPE_ORDER = ['book', 'movie', 'videogame', 'boardgame', 'actionfigure', 'comic', 'other'];

// Base (non-type-specific) aliases used by the CSV import auto-mapper.
export const BASE_ALIASES = {
  title: ['title', 'name', 'item', 'item name', 'game', 'movie', 'book title'],
  tags: ['tags', 'tag', 'labels', 'keywords', 'categories'],
  status: ['status', 'owned', 'ownership'],
  rating: ['rating', 'my rating', 'personal rating', 'score', 'stars'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'description'],
  imageUrl: ['image', 'image url', 'thumbnail', 'cover', 'cover url', 'photo', 'picture'],
  link: ['link', 'url', 'web', 'website', 'page'],
};

export function typeFields(typeId) {
  const t = TYPES[typeId] || TYPES.other;
  return [...t.fields, ...COMMON_FIELDS];
}

export function newItem(typeId) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: typeId,
    title: '',
    tags: [],
    status: 'Owned',
    rating: null,        // personal rating 1–5 (halves allowed via number input)
    notes: '',
    imageUrl: '',
    link: '',
    fields: {},          // type-specific + common fields, keyed by field key
    custom: {},          // freeform user key/value pairs
    createdAt: now,
    updatedAt: now,
  };
}
