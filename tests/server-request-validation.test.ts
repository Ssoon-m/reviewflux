import { describe, expect, it } from "vitest";
import {
  buildReviewEventDedupeKey,
  classifyCollaboratorCheckError,
  getClientErrorCode,
  markRecentEventKey,
  parsePrNumber,
  parsePromptText,
  parseSenderLogin,
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

  it("parses strict positive PR numbers from direct and nested payloads", () => {
    expect(parsePrNumber({ prNumber: 12 })).toBe(12);
    expect(parsePrNumber({ prNumber: "12" })).toBe(12);
    expect(parsePrNumber({ pull_request: { number: 34 } })).toBe(34);
    expect(parsePrNumber({ pull_request: { number: "34" } })).toBe(34);
    expect(parsePrNumber({ issue: { number: 56 } })).toBe(56);
    expect(parsePrNumber({ issue: { number: "56" } })).toBe(56);
  });

  it("rejects malformed PR number strings", () => {
    expect(parsePrNumber({ prNumber: "12abc" })).toBeNull();
    expect(parsePrNumber({ prNumber: "12.3" })).toBeNull();
    expect(parsePrNumber({ prNumber: "" })).toBeNull();
    expect(parsePrNumber({ prNumber: "   " })).toBeNull();
    expect(parsePrNumber({ prNumber: "0" })).toBeNull();
    expect(parsePrNumber({ prNumber: "-1" })).toBeNull();
    expect(parsePrNumber({ pull_request: { number: "89xyz" } })).toBeNull();
  });

  it("parses sender login from sender object or fallback field", () => {
    expect(
      parseSenderLogin({ sender: { login: "Ssoon-m" } }),
    ).toBe("Ssoon-m");

    expect(parseSenderLogin({ senderLogin: "review-bot" })).toBe("review-bot");

    expect(parseSenderLogin({ sender: { login: "  " }, senderLogin: "fallback" })).toBe(
      "fallback",
    );
    expect(parseSenderLogin({})).toBeNull();
    expect(parseSenderLogin(null)).toBeNull();
  });

  it("classifies collaborator check errors by status semantics", () => {
    expect(
      classifyCollaboratorCheckError(new Error("gh: Not Found (HTTP 404)")),
    ).toBe("not_collaborator");
    expect(
      classifyCollaboratorCheckError(new Error("HTTP 500 Internal Server Error")),
    ).toBe("check_failed");
    expect(classifyCollaboratorCheckError("network timeout")).toBe("check_failed");
  });
});
