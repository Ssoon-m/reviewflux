import { describe, expect, it } from "vitest";
import {
  buildReviewEventDedupeKey,
  getClientErrorCode,
  markRecentEventKey,
  parsePromptText,
} from "../src/gateway/http-server.js";
import { parseModelAliasesJson } from "../src/llm/service.js";

describe("parsePromptText", () => {
  it("accepts non-empty strings", () => {
    expect(parsePromptText(" hello ")).toBe("hello");
  });

  it("rejects empty strings", () => {
    expect(parsePromptText("   ")).toBeNull();
  });

  it("rejects non-string payloads", () => {
    expect(parsePromptText({ q: "hi" })).toBeNull();
    expect(parsePromptText(123)).toBeNull();
    expect(parsePromptText(undefined)).toBeNull();
  });

  it("maps server-side failures to stable client error code", () => {
    expect(getClientErrorCode(new Error("llm_request_failed (500): sensitive details"))).toBe("internal_error");
    expect(getClientErrorCode("anything")).toBe("internal_error");
  });

  it("parses model aliases JSON with lowercase keys", () => {
    const aliases = parseModelAliasesJson('{"FAST":{"provider":"google","model":"gemini-2.5-flash"}}');
    expect(aliases.fast).toEqual({ provider: "google", model: "gemini-2.5-flash" });
  });

  it("prefers delivery id for webhook dedupe key", () => {
    const key = buildReviewEventDedupeKey({
      deliveryId: "abc-delivery",
      eventName: "pull_request",
      repo: "Ssoon-m/reviewflux",
      action: "synchronize",
      prNumber: 12,
      reason: "on_push",
      prHeadSha: "deadbeef",
      commentId: null,
    });

    expect(key).toBe("delivery:abc-delivery");
  });

  it("builds pull_request fallback dedupe key from repo/pr/head/action/reason", () => {
    const key = buildReviewEventDedupeKey({
      deliveryId: null,
      eventName: "pull_request",
      repo: "Ssoon-m/reviewflux",
      action: "synchronize",
      prNumber: 77,
      reason: "on_push",
      prHeadSha: "cafebabe",
      commentId: null,
    });

    expect(key).toBe("pr:ssoon-m/reviewflux:77:cafebabe:synchronize:on_push");
  });

  it("builds comment-based fallback dedupe key for manual force events", () => {
    const key = buildReviewEventDedupeKey({
      deliveryId: null,
      eventName: "issue_comment",
      repo: "ssoon-m/reviewflux",
      action: "created",
      prNumber: 55,
      reason: "manual_force",
      prHeadSha: null,
      commentId: "12345",
    });

    expect(key).toBe("comment:ssoon-m/reviewflux:55:issue_comment:12345:manual_force");
  });

  it("marks duplicate keys within ttl window", () => {
    const cache = new Map<string, number>();
    const now = 1_000_000;

    expect(markRecentEventKey(cache, "k1", now)).toBe(false);
    expect(markRecentEventKey(cache, "k1", now + 1_000)).toBe(true);
  });

  it("expires old keys and accepts same key again after ttl", () => {
    const cache = new Map<string, number>();
    const now = 1_000_000;

    expect(markRecentEventKey(cache, "k2", now)).toBe(false);
    expect(markRecentEventKey(cache, "k2", now + 10 * 60 * 1000 + 1)).toBe(false);
  });
});
