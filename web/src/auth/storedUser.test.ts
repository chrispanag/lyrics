import { afterEach, describe, expect, it } from "vitest";

import { SESSION_ATTRIBUTE, SESSION_BOOT_SCRIPT, storeUser } from "./storedUser";
import { makeUser } from "@/test/handlers";

// biome-ignore lint/security/noGlobalEval: runs our own constant, and global scope is the point.
const runBootScript = () => globalThis.eval(SESSION_BOOT_SCRIPT);

const hinted = () => document.documentElement.hasAttribute(SESSION_ATTRIBUTE);

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute(SESSION_ATTRIBUTE);
});

describe("SESSION_BOOT_SCRIPT", () => {
  it("marks a browser that remembers a session", () => {
    storeUser(makeUser());
    runBootScript();
    expect(hinted()).toBe(true);
  });

  it("leaves a guest's browser unmarked", () => {
    runBootScript();
    expect(hinted()).toBe(false);
  });

  it("forgets the mark along with the session", () => {
    storeUser(makeUser());
    storeUser(null);
    runBootScript();
    expect(hinted()).toBe(false);
  });
});
