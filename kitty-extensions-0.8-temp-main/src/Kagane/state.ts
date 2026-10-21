import { SourceStateManager } from "@paperback/types";

import {
  CONTENT_LANGUAGES_KEY,
  CONTENT_RATINGS,
  CONTENT_RATINGS_KEY,
  CUSTOM_HIDDEN_TAGS_KEY,
  DEFAULT_RATINGS,
  EXCLUDED_GENRES_KEY,
  HIDDEN_TAG_CATEGORIES_KEY,
  SHOW_SOURCE_KEY,
  SOURCE_DISPLAY_MODES,
  SOURCE_DISPLAY_MODE_KEY,
  TAG_MATCH_ALL_KEY,
} from "./models";
import { HIDDEN_TAG_CATEGORIES } from "./tags";

// Created on first use: the bundler loads this module to read SourceInfo, and
// App does not exist yet at import time.
let manager: SourceStateManager | undefined;

export function stateManager(): SourceStateManager {
  manager ??= App.createSourceStateManager();

  return manager;
}

async function readArray(key: string, fallback: string[] = []): Promise<string[]> {
  const value = (await stateManager().retrieve(key)) as unknown;

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return typeof value === "string" && value ? [value] : fallback;
}

// An older build stored one maximum rating rather than a list. Expanding it to
// the ladder it implied keeps a reader's visible content identical.
export async function getContentRatings(): Promise<string[]> {
  const value = (await stateManager().retrieve(CONTENT_RATINGS_KEY)) as unknown;

  if (typeof value === "string" && value) {
    const ladder = CONTENT_RATINGS.map((rating) => rating.toLowerCase());
    const index = ladder.indexOf(value.toLowerCase());

    return index < 0 ? DEFAULT_RATINGS : CONTENT_RATINGS.slice(0, index + 1);
  }

  const list = await readArray(CONTENT_RATINGS_KEY, DEFAULT_RATINGS);

  return list.length > 0 ? list : DEFAULT_RATINGS;
}

export async function getSourceDisplayMode(): Promise<string> {
  const value = (await stateManager().retrieve(SOURCE_DISPLAY_MODE_KEY)) as unknown;
  const mode = Array.isArray(value) ? value[0] : value;

  return SOURCE_DISPLAY_MODES.some((entry) => entry.id === mode) ? (mode as string) : "all";
}

export async function getSourceTypes(): Promise<string[]> {
  const mode = await getSourceDisplayMode();

  return [...(SOURCE_DISPLAY_MODES.find((entry) => entry.id === mode)?.types ?? [])];
}

export async function getContentLanguages(): Promise<string[]> {
  return readArray(CONTENT_LANGUAGES_KEY, ["en"]);
}

// Genre ids are the taxonomy UUIDs, so they drop straight into the request.
export async function getExcludedGenres(): Promise<string[]> {
  return readArray(EXCLUDED_GENRES_KEY);
}

export async function getHiddenTagIds(): Promise<string[]> {
  const selected = new Set(await readArray(HIDDEN_TAG_CATEGORIES_KEY));

  return HIDDEN_TAG_CATEGORIES.filter((category) => selected.has(category.id)).flatMap(
    (category) => category.tagIds,
  );
}

export async function getCustomHiddenTags(): Promise<string[]> {
  return readArray(CUSTOM_HIDDEN_TAGS_KEY);
}

export async function getShowSource(): Promise<boolean> {
  return ((await stateManager().retrieve(SHOW_SOURCE_KEY)) as boolean | undefined) ?? false;
}

export async function getTagMatchAll(): Promise<boolean> {
  return ((await stateManager().retrieve(TAG_MATCH_ALL_KEY)) as boolean | undefined) ?? false;
}
