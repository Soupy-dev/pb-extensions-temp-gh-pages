export const BASE_URL = "https://kagane.to";
export const API_URL = `${BASE_URL}/api/v2`;
export const PAGE_SIZE = 35;

// Deliberately not a real asset: the app draws its own placeholder when a cover
// fails to load, which looks right, unlike a stretched favicon.
export const MISSING_COVER = `${BASE_URL}/image/none.webp`;

export const INTEGRITY_TOKEN_KEY = "kagane-integrity-token";
export const INTEGRITY_EXP_KEY = "kagane-integrity-exp";
export const CONTENT_RATINGS_KEY = "kagane-content-ratings";
export const SOURCE_DISPLAY_MODE_KEY = "kagane-source-display-mode";
export const EXCLUDED_GENRES_KEY = "kagane-excluded-genres";
export const CONTENT_LANGUAGES_KEY = "kagane-content-languages";
export const SHOW_SOURCE_KEY = "kagane-show-source";
export const TAG_MATCH_ALL_KEY = "kagane-tag-match-all";
export const HIDDEN_TAG_CATEGORIES_KEY = "kagane-hidden-tag-categories";
export const CUSTOM_HIDDEN_TAGS_KEY = "kagane-custom-hidden-tags";
export const TAGS_CACHE_KEY = "kagane-tags-cache";
export const TAGS_CACHE_DATE_KEY = "kagane-tags-cache-date";

// The API rejects lower-case ratings: "unknown variant `safe`, expected one of
// `Safe`, `Suggestive`, `Erotica`, `Pornographic`".
export const CONTENT_RATINGS = ["Safe", "Suggestive", "Erotica", "Pornographic"] as const;
export type KaganeRating = (typeof CONTENT_RATINGS)[number];

export const DEFAULT_RATINGS: string[] = ["Safe", "Suggestive"];

export const SOURCE_DISPLAY_MODES = [
  { id: "all", title: "Show All", types: ["Official", "Unofficial", "Mixed"] },
  { id: "official", title: "Official Sources Only", types: ["Official"] },
  { id: "scanlations", title: "Scanlations Only", types: ["Unofficial", "Mixed"] },
] as const;

export const LANGUAGES = [
  { id: "en", title: "English" },
  { id: "ja", title: "Japanese" },
  { id: "ko", title: "Korean" },
  { id: "zh-Hans", title: "Chinese Simplified" },
  { id: "zh-Hant", title: "Chinese Traditional" },
  { id: "es", title: "Spanish" },
  { id: "es-419", title: "Spanish (Latin America)" },
  { id: "fr", title: "French" },
  { id: "de", title: "German" },
  { id: "pt", title: "Portuguese" },
  { id: "pt-BR", title: "Portuguese (Brazil)" },
  { id: "ru", title: "Russian" },
  { id: "it", title: "Italian" },
  { id: "id", title: "Indonesian" },
  { id: "vi", title: "Vietnamese" },
  { id: "th", title: "Thai" },
  { id: "pl", title: "Polish" },
  { id: "hi", title: "Hindi" },
  { id: "ar", title: "Arabic" },
];

export const FORMATS = ["Manga", "Manhwa", "Manhua", "Comic", "Other"];

export const UPLOAD_STATUSES = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Abandoned", title: "Cancelled" },
  { id: "Hiatus", title: "Hiatus" },
];

export const HOME_SECTIONS = [
  { id: "popular_today", title: "Popular Today", sort: "avg_views_today,desc" },
  { id: "popular_week", title: "Popular This Week", sort: "avg_views_week,desc" },
  { id: "latest", title: "Latest Updates", sort: "updated_at,desc" },
  { id: "new_series", title: "New Series", sort: "created_at,desc" },
] as const;

export const SORT_FIELDS = [
  { id: "relevance", title: "Relevance" },
  { id: "total_views,desc", title: "Popular (Total Views)" },
  { id: "avg_views_today,desc", title: "Popular (Today)" },
  { id: "avg_views_week,desc", title: "Popular (Week)" },
  { id: "avg_views_month,desc", title: "Popular (Month)" },
  { id: "updated_at,desc", title: "Latest" },
  { id: "created_at,desc", title: "Newest" },
  { id: "series_name,asc", title: "By Name" },
  { id: "books_count,desc", title: "Chapter Count" },
];

export interface GenreDto {
  id: string;
  genre_name: string;
  genre_type?: string | null;
}

export interface SourceDto {
  source_id: string;
  source_type: string;
  title: string;
}

export interface TagDto {
  id: string;
  tag_name: string;
}

export interface SearchBook {
  series_id: string;
  title: string;
  source_id?: string | null;
  content_rating?: string | null;
  current_books?: number;
  start_year?: number | null;
  cover_image_id?: string | null;
  alternate_titles?: string[];
}

export interface SearchDto {
  content?: SearchBook[];
  last?: boolean;
  total_elements?: number;
}

export interface ChapterBook {
  book_id: string;
  title?: string | null;
  created_at?: string | null;
  page_count?: number;
  sort_no: number;
  chapter_no?: string | null;
  volume_no?: string | null;
  groups?: Array<{ title: string }>;
}

export interface DetailsDto {
  title: string;
  description?: string | null;
  upload_status?: string | null;
  format?: string | null;
  content_rating?: string | null;
  source_id?: string | null;
  series_staff?: Array<{ name: string; role: string }>;
  genres?: Array<{ genre_name: string }>;
  tags?: Array<{ tag_name: string }>;
  series_alternate_titles?: Array<{ title: string }>;
  series_books?: ChapterBook[];
  series_covers?: Array<{ image_id: string }>;
}

export interface ChallengeDto {
  access_token: string;
  cache_url: string;
  manifest?: { pages?: Array<{ page_no: number; page_id: string; ext?: string | null }> } | null;
}

export interface IntegrityDto {
  token: string;
  exp: number;
}
