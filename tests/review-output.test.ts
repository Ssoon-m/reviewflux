import { describe, expect, it } from "vitest";
import { resolveReviewOutputFromModel } from "../src/llm/review-output";

describe("review output normalization", () => {
  it("returns no findings for an empty findings array", () => {
    const result = resolveReviewOutputFromModel('{"findings":[]}');

    expect(result.findings).toEqual([]);
  });

  it("returns canonical anchored findings", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"src/a.ts","line":12,"body":"- Detail: null guard missing","severity":"High"}]}',
    );

    expect(result.findings).toEqual([
      {
        path: "src/a.ts",
        line: 12,
        body: "- Detail: null guard missing",
      },
    ]);
  });

  it("returns canonical general findings when no anchor exists", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"","line":"","body":"General finding","severity":"Medium"}]}',
    );

    expect(result.findings).toEqual([
      {
        path: "",
        line: "",
        body: "General finding",
      },
    ]);
  });

  it("keeps valid findings when mixed with invalid entries", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"src/a.ts","line":12,"body":"Anchored finding","severity":"High"},{"path":"src/b.ts","line":20,"body":"   ","severity":"Low"}]}',
    );

    expect(result.findings).toEqual([
      {
        path: "src/a.ts",
        line: 12,
        body: "Anchored finding",
      },
    ]);
  });

  it("normalizes malformed anchors to general findings under the current contract", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"src/a.ts","line":"oops","body":"Potential issue without exact anchor","severity":"Medium"}]}',
    );

    expect(result.findings).toEqual([
      {
        path: "",
        line: "",
        body: "Potential issue without exact anchor",
      },
    ]);
  });

  it("accepts numeric string lines as valid anchors", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"src/a.ts","line":"12","body":"String line anchor","severity":"Medium"}]}',
    );

    expect(result.findings).toEqual([
      {
        path: "src/a.ts",
        line: 12,
        body: "String line anchor",
      },
    ]);
  });

  it("returns a fallback finding for invalid model output", () => {
    const result = resolveReviewOutputFromModel("not valid json");

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: "", line: "" });
    expect(result.findings[0]?.body).toContain(
      "Review completed, but the model output format was invalid.",
    );
  });

  it("treats all-invalid findings arrays as invalid output", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"src/a.ts","line":12,"body":"   "}]}',
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: "", line: "" });
    expect(result.findings[0]?.body).toContain(
      "Review completed, but the model output format was invalid.",
    );
  });

  it("maps malformed no-issue hints to no findings", () => {
    const result = resolveReviewOutputFromModel("LGTM. No actionable issues found.");

    expect(result.findings).toEqual([]);
  });

  it("does not suppress invalid output that mixes LGTM with a real concern", () => {
    const result = resolveReviewOutputFromModel(
      "LGTM, but there is still a null guard issue in src/a.ts",
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.body).toContain(
      "Review completed, but the model output format was invalid.",
    );
  });
});
