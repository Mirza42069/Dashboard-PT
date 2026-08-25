import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { id } from "./id";

/**
 * `as const satisfies Dictionary` already makes a missing or extra key a compile
 * error, so nothing here re-checks the shape. What it cannot see is what is
 * *inside* a string: a translator who drops `{count}` produces a perfectly
 * well-typed dictionary that prints a literal brace to the user, and a key left
 * on its English source is equally invisible to the type system.
 */

type Node = string | { readonly [key: string]: Node };

/** Every leaf, keyed by its dotted path — `projects.deleteTitle`, and so on. */
function leaves(node: Node, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  return Object.entries(node).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key),
  );
}

const enLeaves = leaves(en as Node);
const idLeaves = new Map(leaves(id as Node));

/** `"Hapus {count} item?"` -> `["{count}"]`, sorted so order cannot matter. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[0]).sort();
}

describe("the Indonesian dictionary", () => {
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

  test("has no empty or whitespace-only string", () => {
    const blank = [...idLeaves.entries()]
      .filter(([, value]) => value.trim() === "")
      .map(([path]) => path);

    expect(blank).toEqual([]);
  });

  /**
   * Some keys are legitimately identical across locales — proper nouns, the
   * language names in the switcher, an em dash standing in for "no value". Every
   * other match is a key that was never translated, so the allow-list is the
   * whole test: it has to be added to deliberately.
   */
  const SHARED_WITH_ENGLISH = new Set([
    "common.none", // an em dash, standing in for "no value"
    "auth.email", // loanwords and acronyms Indonesian took whole
    "users.email",
    "actions.typeRfi",
    "projects.statusLabel",
    "tickets.statusColumn",
    "users.statusColumn",
    "boq.subtotal",
    "schedule.rowTotal",
    "projectImport.rowKinds.item",
    "settings.textSizeNormal",
    "settings.english", // the switcher names each language in itself
    "settings.indonesian",
    "users.roleAdmin", // role names, which the product treats as proper nouns
    "users.roleSuperAdmin",
    "projects.tabBaseline", // construction terms Indonesian site engineers use as-is
    "projectUpdate.sectionBoq",
    "baseline.stepBoq",
    "boq.revision", // "Rev" abbreviates revisi just as well as revision
    "projects.statusFilterLabel", // pure format strings, nothing to translate
    "actions.fromTo",
  ]);

  test("does not leave a key on its English source", () => {
    const untranslated = enLeaves
      .filter(
        ([path, source]) =>
          !SHARED_WITH_ENGLISH.has(path) && idLeaves.get(path) === source,
      )
      .map(([path]) => path);

    expect(untranslated).toEqual([]);
  });
});
