import { RequestManager } from "@paperback/types";

import {
  API_URL,
  BASE_URL,
  TAGS_CACHE_DATE_KEY,
  TAGS_CACHE_KEY,
  INTEGRITY_EXP_KEY,
  INTEGRITY_TOKEN_KEY,
  type ChallengeDto,
  type GenreDto,
  type IntegrityDto,
  type SourceDto,
  type TagDto,
} from "./models";
import { stateManager } from "./state";

const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000;

interface Taxonomy {
  genres: GenreDto[];
  sources: SourceDto[];
}

export class KaganeApi {
  constructor(private readonly requestManager: RequestManager) {}

  private taxonomy?: { at: number; value: Taxonomy };

  private tags?: { at: number; value: TagDto[] };

  // The home page asks four rows at once; without holding the in-flight promise
  // each of them starts its own copy of every taxonomy request.
  private pendingTaxonomy?: Promise<Taxonomy>;

  private pendingTags?: Promise<TagDto[]>;

  private integrity?: { token: string; exp: number };

  async fetchJSON<T>(
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<T> {
    const response = await this.requestManager.schedule(
      App.createRequest({
        url,
        method: init?.method ?? "GET",
        ...(init?.headers ? { headers: init.headers } : {}),
        ...(init?.body !== undefined ? { data: init.body } : {}),
      }),
      1,
    );

    const raw = typeof response.data === "string" ? response.data : String(response.data ?? "");

    if (response.status !== 200) {
      throw new Error(`Kagane answered ${response.status} for ${url}: ${raw.slice(0, 120)}`);
    }

    return JSON.parse(raw) as T;
  }

  // The site mints these itself with no payload; each one lasts about five
  // minutes, so it is refreshed rather than stored for long.
  private async integrityToken(force = false): Promise<string> {
    if (!force && this.integrity && this.integrity.exp > Date.now() + 15_000) {
      return this.integrity.token;
    }

    if (!force) {
      const stored = (await stateManager().retrieve(INTEGRITY_TOKEN_KEY)) as string | undefined;
      const exp = Number((await stateManager().retrieve(INTEGRITY_EXP_KEY)) ?? 0);

      if (stored && exp > Date.now() + 15_000) {
        this.integrity = { token: stored, exp };
        return stored;
      }
    }

    const issued = await this.fetchJSON<IntegrityDto>(`${BASE_URL}/api/integrity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    this.integrity = { token: issued.token, exp: issued.exp * 1000 };
    await stateManager().store(INTEGRITY_TOKEN_KEY, issued.token);
    await stateManager().store(INTEGRITY_EXP_KEY, issued.exp * 1000);

    return issued.token;
  }

  async challenge(bookId: string): Promise<ChallengeDto> {
    const url = `${API_URL}/books/${bookId}?is_datasaver=false`;
    const request = async (token: string) =>
      this.fetchJSON<ChallengeDto>(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-integrity-token": token },
        body: "{}",
      });

    try {
      return await request(await this.integrityToken());
    } catch {
      // A token that expired mid-session reads as a plain 401; one retry with a
      // fresh one is the difference between a working chapter and a dead one.
      return request(await this.integrityToken(true));
    }
  }

  async getTaxonomy(): Promise<Taxonomy> {
    if (this.taxonomy && Date.now() - this.taxonomy.at < TAXONOMY_TTL_MS) {
      return this.taxonomy.value;
    }

    this.pendingTaxonomy ??= this.loadTaxonomy().finally(() => {
      this.pendingTaxonomy = undefined;
    });

    return this.pendingTaxonomy;
  }

  private async loadTaxonomy(): Promise<Taxonomy> {
    const [genres, sources] = await Promise.all([
      this.fetchJSON<GenreDto[]>(`${API_URL}/genres/list`),
      this.fetchJSON<{ sources?: SourceDto[] }>(`${API_URL}/sources/list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_types: null }),
      }),
    ]);

    const value: Taxonomy = { genres, sources: sources.sources ?? [] };
    this.taxonomy = { at: Date.now(), value };

    return value;
  }

  async getTags(): Promise<TagDto[]> {
    if (this.tags && Date.now() - this.tags.at < TAXONOMY_TTL_MS) {
      return this.tags.value;
    }

    this.pendingTags ??= this.loadTags().finally(() => {
      this.pendingTags = undefined;
    });

    return this.pendingTags;
  }

  private async loadTags(): Promise<TagDto[]> {
    const cached = await this.readCachedTags();

    if (cached) {
      this.tags = { at: Date.now(), value: cached };
      return cached;
    }

    const tags = (await this.fetchJSON<TagDto[]>(`${API_URL}/tags/list`)).filter(
      (tag) => tag.id && tag.tag_name,
    );
    this.tags = { at: Date.now(), value: tags };

    // Roughly 700KB, so persisting is best-effort: a storage failure after a
    // good fetch must not lose the tags the caller is waiting for.
    try {
      await stateManager().store(TAGS_CACHE_KEY, JSON.stringify(tags));
      await stateManager().store(TAGS_CACHE_DATE_KEY, Date.now());
    } catch {
      // Memory cache still serves this session.
    }

    return tags;
  }

  private async readCachedTags(): Promise<TagDto[] | undefined> {
    try {
      const at = Number((await stateManager().retrieve(TAGS_CACHE_DATE_KEY)) ?? 0);
      const raw = await stateManager().retrieve(TAGS_CACHE_KEY);

      if (typeof raw !== "string" || Date.now() - at > TAXONOMY_TTL_MS) {
        return undefined;
      }

      const parsed = JSON.parse(raw) as TagDto[];

      return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  // Fire-and-forget: pulls the taxonomy into memory so the filter sheet opens
  // without waiting on it. Never surfaces an error and never blocks a caller.
  warm(): void {
    void this.getTags().catch(() => undefined);
  }

  // Lower-cased name to id, for resolving tag names typed into settings.
  async getTagIdsByName(): Promise<Record<string, string>> {
    const map: Record<string, string> = {};

    for (const tag of await this.getTags()) {
      map[tag.tag_name.toLowerCase()] = tag.id;
    }

    return map;
  }
}
