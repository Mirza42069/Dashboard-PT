import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { id } from "./id";
import { DEFAULT_LOCALE, dictionaryFor, interpolate, localeFromHeaders, plural } from "./index";

/**
 * `satisfies MessageDictionary` already makes a missing or extra key a compile
 * error, so nothing here re-checks the shape. What it cannot see is what is
 * inside a string: a dropped `{code}` type-checks perfectly and then prints a
 * brace at a user, and a key left on its English source is equally invisible.
 */

type Node = string | { readonly [key: string]: Node };

function leaves(node: Node, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  return Object.entries(node).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key),
  );
}

const enLeaves = leaves(en as Node);
const idLeaves = new Map(leaves(id as Node));

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[0]).sort();
}

function headers(cookie?: string): Headers {
  return new Headers(cookie === undefined ? {} : { cookie });
}

describe("the Indonesian message catalog", () => {
  test("carries every placeholder its English source does", () => {
    const mismatched = enLeaves
      .filter(([path, source]) => {
        const translated = idLeaves.get(path);
        return (
          translated !== undefined &&
          placeholders(source).join() !== placeholders(translated).join()
        );
      })
      .map(([path]) => path);

    expect(mismatched).toEqual([]);
  });

  test("has no empty string", () => {
    const blank = [...idLeaves.entries()]
      .filter(([, value]) => value.trim() === "")
      .map(([path]) => path);

    expect(blank).toEqual([]);
  });

  test("leaves no key on its English source", () => {
    const untranslated = enLeaves
      .filter(([path, source]) => idLeaves.get(path) === source)
      .map(([path]) => path);

    expect(untranslated).toEqual([]);
  });
});

describe("localeFromHeaders", () => {
  test("reads the locale cookie", () => {
    expect(localeFromHeaders(headers("v2.locale=en"))).toBe("en");
    expect(localeFromHeaders(headers("v2.locale=id"))).toBe("id");
  });

  test("finds it alongside other cookies", () => {
    expect(localeFromHeaders(headers("v2.company=abc; v2.locale=en; other=1"))).toBe("en");
  });

  test("falls back when there is nothing usable", () => {
    expect(localeFromHeaders(headers())).toBe(DEFAULT_LOCALE);
    expect(localeFromHeaders(headers("v2.locale=fr"))).toBe(DEFAULT_LOCALE);
    expect(localeFromHeaders(headers("v2.locale="))).toBe(DEFAULT_LOCALE);
  });

  /**
   * A substring match would read the locale off `not.v2.locale=en`, which is a
   * name any caller can put in their own cookie jar. The lookup splits on `;`
   * and compares the whole name for exactly this reason.
   */
  test("does not match a cookie whose name merely ends in the right thing", () => {
    expect(localeFromHeaders(headers("not.v2.locale=en"))).toBe(DEFAULT_LOCALE);
  });
});

describe("interpolation", () => {
  test("substitutes what it is given and leaves the rest alone", () => {
    expect(interpolate("Kode {code} sudah dipakai", { code: "A1" })).toBe(
      "Kode A1 sudah dipakai",
    );
    expect(interpolate("Periode {first} sampai {last}.", { first: 1 })).toBe(
      "Periode 1 sampai {last}.",
    );
  });

  test("plural picks a form and fills {count} without being passed it", () => {
    const forms = dictionaryFor("en").boq.scheduleRowsIncomplete;
    expect(plural(forms, 1)).toBe("1 schedule row must total 100% before activation.");
    expect(plural(forms, 4)).toBe("4 schedule rows must total 100% before activation.");
  });

  test("Indonesian resolves both forms to the same sentence", () => {
    const forms = dictionaryFor("id").boq.scheduleRowsIncomplete;
    expect(plural(forms, 1)).toBe("1 baris jadwal harus berjumlah 100% sebelum diaktifkan.");
    expect(plural(forms, 4)).toBe("4 baris jadwal harus berjumlah 100% sebelum diaktifkan.");
  });
});
