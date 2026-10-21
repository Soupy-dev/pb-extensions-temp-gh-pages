import { CheerioAPI } from "cheerio";
import {
  Chapter,
  ChapterDetails,
  ChapterProviding,
  CloudflareBypassRequestProviding,
  ContentRating,
  DUISection,
  HomePageSectionsProviding,
  HomeSection,
  HomeSectionType,
  PagedResults,
  PartialSourceManga,
  Request,
  RequestManager,
  SearchField,
  SearchRequest,
  SearchResultsProviding,
  SourceInfo,
  SourceIntents,
  SourceManga,
  Tag,
  TagSection,
} from "@paperback/types";

import { KaganeApi } from "./api";
import {
  API_URL,
  BASE_URL,
  FORMATS,
  HOME_SECTIONS,
  MISSING_COVER,
  PAGE_SIZE,
  UPLOAD_STATUSES,
  type DetailsDto,
  type SearchDto,
  type SourceDto,
} from "./models";
import { buildSettings } from "./settings";
import {
  getContentLanguages,
  getContentRatings,
  getCustomHiddenTags,
  getExcludedGenres,
  getHiddenTagIds,
  getShowSource,
  getSourceDisplayMode,
  getSourceTypes,
  getTagMatchAll,
} from "./state";
import { POPULAR_TAG_NAMES } from "./tags";

export const KaganeInfo: SourceInfo = {
  version: "5.0.0",
  name: "Kagane",
  icon: "icon.png",
  author: "kittycatgit",
  authorWebsite: "https://github.com/kittycatgit",
  description: "Extension that pulls content from kagane.to.",
  contentRating: ContentRating.MATURE,
  websiteBaseURL: BASE_URL,
  language: "en",
  intents:
    SourceIntents.MANGA_CHAPTERS |
    SourceIntents.HOMEPAGE_SECTIONS |
    SourceIntents.SETTINGS_UI |
    SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
};

export class Kagane
  implements
    SearchResultsProviding,
    ChapterProviding,
    HomePageSectionsProviding,
    CloudflareBypassRequestProviding
{
  constructor(public cheerio: CheerioAPI) {}

  readonly requestManager: RequestManager = App.createRequestManager({
    requestTimeout: 20_000,
    interceptor: {
      interceptRequest: async (request: Request): Promise<Request> => {
        request.headers = {
          ...request.headers,
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          "user-agent": await this.requestManager.getDefaultUserAgent(),
        };

        return request;
      },
      interceptResponse: async (response) => response,
    },
  });

  private readonly api = new KaganeApi(this.requestManager);

  async getCloudflareBypassRequestAsync(): Promise<Request> {
    return App.createRequest({
      url: BASE_URL,
      method: "GET",
      headers: { "user-agent": await this.requestManager.getDefaultUserAgent() },
    });
  }

  async getSourceMenu(): Promise<DUISection> {
    return buildSettings(this.api);
  }

  getMangaShareUrl(mangaId: string): string {
    return `${BASE_URL}/series/${mangaId}`;
  }

  // Some series carry no cover at all on Kagane. The fallback has to be a URL
  // the app can try and fail on: an empty string blanks the whole row, and the
  // favicon loads and gets stretched into a blurred logo.
  private cover(imageId?: string | null): string {
    return imageId ? `${API_URL}/image/${imageId}/compressed` : MISSING_COVER;
  }

  // Tag ids carry the group they came from so the search body can put each one
  // in the right field; ids never contain spaces, which Paperback rejects.
  async getSearchTags(): Promise<TagSection[]> {
    const [{ genres, sources }, tags, mode] = await Promise.all([
      this.api.getTaxonomy(),
      this.api.getTags(),
      getSourceDisplayMode(),
    ]);

    const wanted = new Set(POPULAR_TAG_NAMES.map((name) => name.toLowerCase()));
    const popular = tags
      .filter((tag) => wanted.has(tag.tag_name.toLowerCase()))
      .sort((left, right) => left.tag_name.localeCompare(right.tag_name));

    const visibleSources = sources
      .filter((source) => this.matchesMode(source, mode))
      .sort((left, right) => left.title.localeCompare(right.title));

    const sections: TagSection[] = [
      App.createTagSection({
        id: "genres",
        label: "Genres",
        tags: [...genres]
          .sort((left, right) => left.genre_name.localeCompare(right.genre_name))
          .map((genre) => App.createTag({ id: `genre:${genre.id}`, label: genre.genre_name })),
      }),
      App.createTagSection({
        id: "tags",
        label: "Tags",
        tags: popular.map((tag) => App.createTag({ id: `tag:${tag.id}`, label: tag.tag_name })),
      }),
      App.createTagSection({
        id: "formats",
        label: "Format",
        tags: FORMATS.map((format) => App.createTag({ id: `format:${format}`, label: format })),
      }),
      App.createTagSection({
        id: "statuses",
        label: "Status",
        tags: UPLOAD_STATUSES.map((status) =>
          App.createTag({ id: `status:${status.id}`, label: status.title }),
        ),
      }),
      App.createTagSection({
        id: "sources",
        label: "Sources",
        tags: visibleSources.map((source) =>
          App.createTag({
            id: `source:${source.source_id}`,
            label: source.source_type === "Official" ? `${source.title} ⭐` : source.title,
          }),
        ),
      }),
    ];

    return sections.filter((section) => (section.tags?.length ?? 0) > 0);
  }

  private matchesMode(source: SourceDto, mode: string): boolean {
    if (mode === "official") {
      return source.source_type === "Official";
    }

    if (mode === "scanlations") {
      return source.source_type !== "Official";
    }

    return true;
  }

  // Only a few hundred of the ~8,500 tags fit in a picker, so this reaches the
  // rest by name. A leading "-" excludes: "romance, -gore".
  async getSearchFields(): Promise<SearchField[]> {
    return [
      App.createSearchField({
        id: "tags_text",
        name: "Tags",
        placeholder: "romance, -gore",
      }),
    ];
  }

  async supportsTagExclusion(): Promise<boolean> {
    return true;
  }

  private split(tags: Tag[] | undefined, prefix: string): string[] {
    return (tags ?? [])
      .map((tag) => tag.id ?? "")
      .filter((id) => id.startsWith(`${prefix}:`))
      .map((id) => id.slice(prefix.length + 1));
  }

  private async searchBody(query?: SearchRequest): Promise<Record<string, unknown>> {
    const [ratings, languages, sourceTypes, excludedGenres, hiddenTagIds, customHidden, matchAll] =
      await Promise.all([
        getContentRatings(),
        getContentLanguages(),
        getSourceTypes(),
        getExcludedGenres(),
        getHiddenTagIds(),
        getCustomHiddenTags(),
        getTagMatchAll(),
      ]);

    const body: Record<string, unknown> = {
      source_type: sourceTypes,
      content_rating: ratings,
      content_lang: languages,
    };

    const title = query?.title?.trim();
    if (title) {
      body.title = title;
    }

    const formats = this.split(query?.includedTags, "format");
    if (formats.length > 0) {
      body.format = formats;
    }

    const statuses = this.split(query?.includedTags, "status");
    if (statuses.length > 0) {
      body.upload_status = statuses;
    }

    const sourceIds = this.split(query?.includedTags, "source");
    if (sourceIds.length > 0) {
      body.source_id = sourceIds;
    }

    const includedGenres = this.split(query?.includedTags, "genre");
    const excluded = [...this.split(query?.excludedTags, "genre"), ...excludedGenres];
    if (includedGenres.length > 0 || excluded.length > 0) {
      body.genres = this.compound(includedGenres, excluded, matchAll);
    }

    const includedTags = this.split(query?.includedTags, "tag");
    const excludedTags = [...this.split(query?.excludedTags, "tag"), ...hiddenTagIds];
    const typed = this.parseTypedTags(String(query?.parameters?.["tags_text"] ?? ""));

    // Names are resolved here so the 8,500-entry taxonomy is only fetched when
    // somebody actually typed one. Names that match nothing drop out quietly.
    const names = [...customHidden, ...typed.included, ...typed.excluded];
    if (names.length > 0) {
      const byName = await this.api.getTagIdsByName();
      const resolve = (list: string[]) =>
        list.map((name) => byName[name.toLowerCase()] ?? "").filter(Boolean);

      includedTags.push(...resolve(typed.included));
      excludedTags.push(...resolve(customHidden), ...resolve(typed.excluded));
    }

    if (includedTags.length > 0 || excludedTags.length > 0) {
      body.tags = this.compound(includedTags, excludedTags, matchAll);
    }

    return body;
  }

  private parseTypedTags(input: string): { included: string[]; excluded: string[] } {
    const included: string[] = [];
    const excluded: string[] = [];

    for (const entry of input.split(",")) {
      const trimmed = entry.trim();
      const exclude = trimmed.startsWith("-");
      const name = (exclude ? trimmed.slice(1) : trimmed).trim();

      if (name) {
        (exclude ? excluded : included).push(name);
      }
    }

    return { included, excluded };
  }

  private compound(included: string[], excluded: string[], matchAll: boolean) {
    return {
      values: included,
      ...(matchAll && included.length > 0 ? { match_all: true } : {}),
      ...(excluded.length > 0 ? { exclude: [...new Set(excluded)] } : {}),
    };
  }

  private async series(
    body: Record<string, unknown>,
    page: number,
    sort?: string,
  ): Promise<{ results: PartialSourceManga[]; hasNext: boolean }> {
    const parts = [`page=${page}`, `size=${PAGE_SIZE}`];

    if (sort && sort !== "relevance") {
      parts.push(`sort=${sort}`);
    }

    const showSource = await getShowSource();

    // The source list is only there to print a name beside the title, so it is
    // not fetched at all unless that setting is on.
    const [data, sources] = await Promise.all([
      this.api.fetchJSON<SearchDto>(`${API_URL}/search/series?${parts.join("&")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      showSource
        ? this.api
            .getTaxonomy()
            .then((taxonomy) => taxonomy.sources)
            .catch(() => [] as SourceDto[])
        : Promise.resolve([] as SourceDto[]),
    ]);

    const titles = new Map(sources.map((source) => [source.source_id, source.title]));
    const results = (data.content ?? []).map((book) => {
      const source = book.source_id ? titles.get(book.source_id) : undefined;
      const subtitle = [
        typeof book.current_books === "number" ? `${book.current_books} Chapters` : "",
        book.start_year ? String(book.start_year) : "",
      ]
        .filter(Boolean)
        .join(" • ");

      return App.createPartialSourceManga({
        mangaId: book.series_id,
        title: showSource && source ? `${book.title.trim()} [${source}]` : book.title.trim(),
        image: this.cover(book.cover_image_id),
        ...(subtitle ? { subtitle } : {}),
      });
    });

    return { results, hasNext: data.last === false && results.length > 0 };
  }

  // Every row is a different sort of the same endpoint, so they are fetched
  // together rather than one after another.
  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    for (const [index, entry] of HOME_SECTIONS.entries()) {
      sectionCallback(
        App.createHomeSection({
          id: entry.id,
          title: entry.title,
          type: index === 0 ? HomeSectionType.singleRowLarge : HomeSectionType.singleRowNormal,
          containsMoreItems: true,
        }),
      );
    }

    const body = await this.searchBody();
    const rows = await Promise.all(
      HOME_SECTIONS.map((entry) =>
        this.series(body, 0, entry.sort).catch(() => ({ results: [], hasNext: false })),
      ),
    );

    for (const [index, entry] of HOME_SECTIONS.entries()) {
      sectionCallback(
        App.createHomeSection({
          id: entry.id,
          title: entry.title,
          type: index === 0 ? HomeSectionType.singleRowLarge : HomeSectionType.singleRowNormal,
          containsMoreItems: true,
          items: rows[index]?.results ?? [],
        }),
      );
    }

    // Rows are already painted; pull the tag list in behind them so the filter
    // sheet opens without a wait.
    this.api.warm();
  }

  async getViewMoreItems(homepageSectionId: string, metadata: unknown): Promise<PagedResults> {
    const entry = HOME_SECTIONS.find((row) => row.id === homepageSectionId);

    if (!entry) {
      return App.createPagedResults({ results: [] });
    }

    const page = (metadata as { page?: number } | undefined)?.page ?? 0;
    const { results, hasNext } = await this.series(await this.searchBody(), page, entry.sort);

    return App.createPagedResults({
      results,
      metadata: hasNext ? { page: page + 1 } : undefined,
    });
  }

  async getSearchResults(query: SearchRequest, metadata: unknown): Promise<PagedResults> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 0;
    const { results, hasNext } = await this.series(await this.searchBody(query), page);

    return App.createPagedResults({
      results,
      metadata: hasNext ? { page: page + 1 } : undefined,
    });
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const [data, taxonomy] = await Promise.all([
      this.api.fetchJSON<DetailsDto>(`${API_URL}/series/${mangaId}`),
      this.api.getTaxonomy().catch(() => ({ genres: [], sources: [] as SourceDto[] })),
    ]);

    const genres = (data.genres ?? []).map((genre) =>
      App.createTag({
        id: genre.genre_name.toLowerCase().replace(/\s+/g, "-"),
        label: genre.genre_name,
      }),
    );
    const tags = (data.tags ?? [])
      .slice(0, 60)
      .map((tag) =>
        App.createTag({ id: tag.tag_name.toLowerCase().replace(/\s+/g, "-"), label: tag.tag_name }),
      );

    const author = (data.series_staff ?? []).find((entry) =>
      /story|author|writer/i.test(entry.role),
    );
    const artist = (data.series_staff ?? []).find((entry) => /art|illustrat/i.test(entry.role));
    const source = taxonomy.sources.find((entry) => entry.source_id === data.source_id);

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        titles: [
          data.title,
          ...(data.series_alternate_titles ?? []).map((alt) => alt.title).filter(Boolean),
        ],
        image: this.cover(data.series_covers?.[0]?.image_id),
        desc: (data.description ?? "").trim(),
        status: /completed|finished/i.test(data.upload_status ?? "") ? "Completed" : "Ongoing",
        ...(author?.name ? { author: author.name } : {}),
        ...(artist?.name ? { artist: artist.name } : {}),
        ...(source ? { hentai: false } : {}),
        ...(genres.length > 0 || tags.length > 0
          ? {
              tags: [
                ...(genres.length > 0
                  ? [App.createTagSection({ id: "genres", label: "Genres", tags: genres })]
                  : []),
                ...(tags.length > 0
                  ? [App.createTagSection({ id: "tags", label: "Tags", tags })]
                  : []),
              ],
            }
          : {}),
      }),
    });
  }

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const [data, taxonomy] = await Promise.all([
      this.api.fetchJSON<DetailsDto>(`${API_URL}/series/${mangaId}`),
      this.api.getTaxonomy().catch(() => ({ genres: [], sources: [] as SourceDto[] })),
    ]);

    const source = taxonomy.sources.find((entry) => entry.source_id === data.source_id);
    // A star marks an official upload so they stand out from scanlations.
    const official = source?.source_type === "Official";
    const books = data.series_books ?? [];

    if (books.length === 0) {
      throw new Error(`No chapters were listed for ${mangaId}.`);
    }

    // The API returns books oldest-first and `sort_no` tracks the chapter number
    // (decimals included), so ordering by it puts the newest chapter last —
    // which is where the app expects the highest sortingIndex to be.
    const ordered = [...books].sort((left, right) => left.sort_no - right.sort_no);

    return ordered.map((book, index) => {
      const groupName = book.groups?.map((group) => group.title).join(", ") || source?.title || "";
      const time = book.created_at ? new Date(book.created_at) : undefined;
      const chapterNumber = Number(book.chapter_no);
      const volume = Number(book.volume_no);

      return App.createChapter({
        id: book.book_id,
        chapNum: Number.isFinite(chapterNumber) ? chapterNumber : book.sort_no,
        sortingIndex: index,
        langCode: "en",
        ...(book.title ? { name: book.title } : {}),
        ...(Number.isFinite(volume) ? { volume } : {}),
        ...(groupName ? { group: official ? `${groupName} ⭐` : groupName } : {}),
        ...(time && !isNaN(time.getTime()) ? { time } : {}),
      });
    });
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const challenge = await this.api.challenge(chapterId);
    const pages = [...(challenge.manifest?.pages ?? [])]
      .sort((left, right) => left.page_no - right.page_no)
      .map(
        (page) =>
          `${challenge.cache_url}/api/v2/books/page/${chapterId}/${page.page_id}.${page.ext ?? "jxl"}?token=${challenge.access_token}&is_datasaver=false`,
      );

    if (pages.length === 0) {
      throw new Error(`No pages were listed for ${chapterId}.`);
    }

    return App.createChapterDetails({ id: chapterId, mangaId, pages });
  }
}
