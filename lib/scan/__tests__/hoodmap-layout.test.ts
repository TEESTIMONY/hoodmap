import { describe, expect, it } from "vitest";
import {
  assignClusterColors,
  bubbleColorCss,
  bubbleGlowCss,
  bubbleGradientCss,
  bubbleRadius,
  MAX_BUBBLE_RADIUS,
  MIN_BUBBLE_RADIUS,
  NEUTRAL_BUBBLE_COLOR,
} from "../hoodmap-layout";

// A CSS color function's alpha channel must be part of the function call
// itself (hsla(h,s%,l%,a) or hsl(h s% l% / a)) — appending hex-alpha-style
// characters after a closing hsl(...) paren produces an invalid color that
// browsers silently drop, so this class of bug renders as "nothing" rather
// than an error. A regex guard here is cheap insurance against reintroducing
// it, since it's invisible without actually opening dev tools.
const VALID_CSS_COLOR_FUNCTION = /^(hsla?|rgba?)\([^)]*\)$/;

describe("bubbleRadius", () => {
  it("returns the minimum radius at 0% supply", () => {
    expect(bubbleRadius(0)).toBe(MIN_BUBBLE_RADIUS);
  });

  it("returns the maximum radius at 100% supply", () => {
    expect(bubbleRadius(100)).toBe(MAX_BUBBLE_RADIUS);
  });

  it("clamps negative and NaN input to the minimum radius", () => {
    expect(bubbleRadius(-5)).toBe(MIN_BUBBLE_RADIUS);
    expect(bubbleRadius(NaN)).toBe(MIN_BUBBLE_RADIUS);
  });

  it("clamps input above 100 the same as exactly 100", () => {
    expect(bubbleRadius(250)).toBe(bubbleRadius(100));
  });

  it("is strictly increasing as pctSupply increases", () => {
    const r1 = bubbleRadius(1);
    const r10 = bubbleRadius(10);
    const r50 = bubbleRadius(50);
    const r90 = bubbleRadius(90);
    expect(r1).toBeLessThan(r10);
    expect(r10).toBeLessThan(r50);
    expect(r50).toBeLessThan(r90);
  });

  it("scales by area (sqrt), not linearly — real proportional scaling", () => {
    // A holder with 4x the supply should have ~2x the radius-above-minimum
    // (sqrt(4) = 2), not 4x — that would be linear/diameter scaling, which
    // the task explicitly rules out ("not fixed size tiers").
    const above = (pct: number) => bubbleRadius(pct) - MIN_BUBBLE_RADIUS;
    const ratio = above(4) / above(1);
    expect(ratio).toBeCloseTo(2, 5);

    // 25% vs 100% supply -> sqrt(25/100) = 0.5
    const ratio2 = above(25) / above(100);
    expect(ratio2).toBeCloseTo(0.5, 5);
  });

  it("does not use fixed size tiers — every distinct input in a range maps to a distinct radius", () => {
    const radii = new Set<number>();
    for (let pct = 1; pct <= 20; pct++) radii.add(bubbleRadius(pct));
    expect(radii.size).toBe(20);
  });
});

describe("assignClusterColors", () => {
  it("assigns a color to every group id", () => {
    const colors = assignClusterColors(["g1", "g2", "g3"]);
    expect(colors.size).toBe(3);
    expect(colors.get("g1")).toBeTruthy();
    expect(colors.get("g2")).toBeTruthy();
    expect(colors.get("g3")).toBeTruthy();
  });

  it("assigns distinct hues to each group", () => {
    const colors = assignClusterColors(["g1", "g2", "g3", "g4"]);
    const hues = Array.from(colors.values()).map((c) => c.h);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it("is deterministic for the same input", () => {
    const a = assignClusterColors(["g1", "g2"]);
    const b = assignClusterColors(["g1", "g2"]);
    expect(a.get("g1")).toEqual(b.get("g1"));
    expect(a.get("g2")).toEqual(b.get("g2"));
  });

  it("returns an empty map for no groups", () => {
    expect(assignClusterColors([]).size).toBe(0);
  });
});

describe("bubbleColorCss / bubbleGradientCss", () => {
  it("renders a flat color as a valid hsl() string", () => {
    expect(bubbleColorCss(NEUTRAL_BUBBLE_COLOR)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it("renders a gradient using the same hue as the flat color", () => {
    const colors = assignClusterColors(["g1"]);
    const color = colors.get("g1")!;
    const gradient = bubbleGradientCss(color);
    expect(gradient).toContain("radial-gradient");
    expect(gradient).toContain(`hsl(${color.h},`);
  });
});

describe("bubbleGlowCss", () => {
  it("produces a box-shadow whose color is valid CSS at normal intensity", () => {
    const shadow = bubbleGlowCss(NEUTRAL_BUBBLE_COLOR, 20);
    // "0 0 <spread>px <color>" — extract just the color token.
    const color = shadow.split("px ")[1];
    expect(color).toMatch(VALID_CSS_COLOR_FUNCTION);
  });

  it("produces a box-shadow whose color is valid CSS at elevated (selected) intensity", () => {
    const shadow = bubbleGlowCss(NEUTRAL_BUBBLE_COLOR, 20, 1.7);
    const color = shadow.split("px ")[1];
    expect(color).toMatch(VALID_CSS_COLOR_FUNCTION);
  });

  it("does not concatenate a hex-alpha suffix onto an hsl() color", () => {
    // The specific bug this guards: hsl(...)  + "aa"/"55" appended directly,
    // which is invalid and silently dropped by the browser.
    const shadow = bubbleGlowCss(NEUTRAL_BUBBLE_COLOR, 20, 1.7);
    expect(shadow).not.toMatch(/\)(aa|55)/);
  });
});
