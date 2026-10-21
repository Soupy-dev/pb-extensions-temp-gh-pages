import { DUIFormRow, DUISection } from "@paperback/types";

import { KaganeApi } from "./api";
import {
  CONTENT_LANGUAGES_KEY,
  CONTENT_RATINGS,
  CONTENT_RATINGS_KEY,
  CUSTOM_HIDDEN_TAGS_KEY,
  EXCLUDED_GENRES_KEY,
  HIDDEN_TAG_CATEGORIES_KEY,
  LANGUAGES,
  SHOW_SOURCE_KEY,
  SOURCE_DISPLAY_MODES,
  SOURCE_DISPLAY_MODE_KEY,
  TAG_MATCH_ALL_KEY,
} from "./models";
import {
  getContentLanguages,
  getContentRatings,
  getCustomHiddenTags,
  getExcludedGenres,
  getShowSource,
  getSourceDisplayMode,
  getTagMatchAll,
  stateManager,
} from "./state";
import { HIDDEN_TAG_CATEGORIES } from "./tags";

function select(info: {
  id: string;
  label: string;
  options: string[];
  labels: Record<string, string>;
  read: () => Promise<string[]>;
  key: string;
  multi: boolean;
}): DUIFormRow {
  return App.createDUISelect({
    id: info.id,
    label: info.label,
    options: info.options,
    allowsMultiselect: info.multi,
    labelResolver: async (option) => info.labels[option] ?? option,
    value: App.createDUIBinding({
      get: info.read,
      set: async (value) => {
        await stateManager().store(info.key, Array.isArray(value) ? value : [value]);
      },
    }),
  });
}

function switchRow(
  id: string,
  label: string,
  key: string,
  read: () => Promise<boolean>,
): DUIFormRow {
  return App.createDUISwitch({
    id,
    label,
    value: App.createDUIBinding({
      get: read,
      set: async (value) => stateManager().store(key, Boolean(value)),
    }),
  });
}

export function buildSettings(api: KaganeApi): DUISection {
  return App.createDUISection({
    id: "kagane-settings",
    isHidden: false,
    rows: async () => [
      App.createDUINavigationButton({
        id: "kagane-settings-button",
        label: "Kagane Settings",
        form: App.createDUIForm({
          sections: async () => {
            const ratingLabels = Object.fromEntries(CONTENT_RATINGS.map((r) => [r, r]));
            const languageLabels = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.title]));
            const modeLabels = Object.fromEntries(SOURCE_DISPLAY_MODES.map((m) => [m.id, m.title]));
            const categoryLabels = Object.fromEntries(
              HIDDEN_TAG_CATEGORIES.map((c) => [c.id, c.title]),
            );

            // Read live so the list matches the server and the stored ids are
            // the UUIDs the search body wants.
            let genreIds: string[] = [];
            let genreLabels: Record<string, string> = {};
            try {
              const genres = [...(await api.getTaxonomy()).genres].sort((left, right) =>
                left.genre_name.localeCompare(right.genre_name),
              );
              genreIds = genres.map((genre) => genre.id);
              genreLabels = Object.fromEntries(genres.map((g) => [g.id, g.genre_name]));
            } catch {
              genreIds = [];
            }

            return [
              App.createDUISection({
                id: "content",
                header: "Content",
                footer: "Titles outside the selected ratings and languages are hidden everywhere.",
                isHidden: false,
                rows: async () => [
                  select({
                    id: "content-ratings",
                    label: "Content Ratings",
                    options: [...CONTENT_RATINGS],
                    labels: ratingLabels,
                    read: getContentRatings,
                    key: CONTENT_RATINGS_KEY,
                    multi: true,
                  }),
                  select({
                    id: "content-languages",
                    label: "Languages",
                    options: LANGUAGES.map((language) => language.id),
                    labels: languageLabels,
                    read: getContentLanguages,
                    key: CONTENT_LANGUAGES_KEY,
                    multi: true,
                  }),
                ],
              }),
              App.createDUISection({
                id: "sources",
                header: "Sources",
                isHidden: false,
                rows: async () => [
                  select({
                    id: "source-display-mode",
                    label: "Show",
                    options: SOURCE_DISPLAY_MODES.map((mode) => mode.id),
                    labels: modeLabels,
                    read: async () => [await getSourceDisplayMode()],
                    key: SOURCE_DISPLAY_MODE_KEY,
                    multi: false,
                  }),
                  switchRow("show-source", "Show Source In Title", SHOW_SOURCE_KEY, getShowSource),
                ],
              }),
              App.createDUISection({
                id: "genres",
                header: "Excluded Genres",
                footer:
                  genreIds.length > 0
                    ? "Titles carrying any of these are hidden from search and the home page."
                    : "Genres could not be loaded. Open settings again once the site is reachable.",
                isHidden: false,
                rows: async () =>
                  genreIds.length === 0
                    ? []
                    : [
                        select({
                          id: "excluded-genres",
                          label: "Excluded Genres",
                          options: genreIds,
                          labels: genreLabels,
                          read: getExcludedGenres,
                          key: EXCLUDED_GENRES_KEY,
                          multi: true,
                        }),
                      ],
              }),
              App.createDUISection({
                id: "tags",
                header: "Hidden Tags",
                footer:
                  "A category hides every variant tag it covers. Custom names are matched against the site's tag list.",
                isHidden: false,
                rows: async () => [
                  select({
                    id: "hidden-tag-categories",
                    label: "Hidden Tags",
                    options: HIDDEN_TAG_CATEGORIES.map((category) => category.id),
                    labels: categoryLabels,
                    read: async () => {
                      const stored = (await stateManager().retrieve(
                        HIDDEN_TAG_CATEGORIES_KEY,
                      )) as unknown;
                      return Array.isArray(stored) ? (stored as string[]) : [];
                    },
                    key: HIDDEN_TAG_CATEGORIES_KEY,
                    multi: true,
                  }),
                  App.createDUIInputField({
                    id: "custom-hidden-tags",
                    label: "Custom Hidden Tags",
                    value: App.createDUIBinding({
                      get: async () => (await getCustomHiddenTags()).join(", "),
                      set: async (value) => {
                        const names = String(value ?? "")
                          .split(",")
                          .map((entry) => entry.trim())
                          .filter((entry) => entry.length > 0);
                        await stateManager().store(CUSTOM_HIDDEN_TAGS_KEY, names);
                      },
                    }),
                  }),
                  switchRow(
                    "tag-match-all",
                    "Match All Selected Tags",
                    TAG_MATCH_ALL_KEY,
                    getTagMatchAll,
                  ),
                ],
              }),
            ];
          },
        }),
      }),
    ],
  });
}
