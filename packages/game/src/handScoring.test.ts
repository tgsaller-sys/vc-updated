import { describe, expect, it } from "vitest";
import { createDeck, scoreHand } from ".";
import type { CardId } from ".";

function card(id: CardId) {
  const found = createDeck().find((nextCard) => nextCard.id === id);

  if (found === undefined) {
    throw new Error(`Missing test card ${id}`);
  }

  return found;
}

describe("scoreHand", () => {
  it("scores weak scattered hands with low flexibility and low-card penalties", () => {
    const score = scoreHand({
      hand: [card("clubs-3"), card("diamonds-5"), card("spades-8"), card("hearts-J")]
    });

    expect(score.estimatedTurnsToGoOut).toBe(4);
    expect(score.singlesCount).toBe(4);
    expect(score.pairCount).toBe(0);
    expect(score.straightCount).toBe(0);
    expect(score.lowCardPenalty).toBeGreaterThan(0);
    expect(score.flexibilityScore).toBeLessThan(20);
    expect(score.notes.some((note) => note.includes("isolated low cards"))).toBe(true);
  });

  it("rewards strong combination hands over scattered hands", () => {
    const comboScore = scoreHand({
      hand: [card("clubs-6"), card("diamonds-6"), card("spades-6"), card("clubs-7"), card("diamonds-7"), card("hearts-7")]
    });
    const scatteredScore = scoreHand({
      hand: [card("clubs-3"), card("diamonds-5"), card("spades-8"), card("hearts-J"), card("clubs-K"), card("diamonds-A")]
    });

    expect(comboScore.tripleCount).toBeGreaterThanOrEqual(2);
    expect(comboScore.estimatedTurnsToGoOut).toBeLessThan(scatteredScore.estimatedTurnsToGoOut);
    expect(comboScore.flexibilityScore).toBeGreaterThan(scatteredScore.flexibilityScore);
    expect(comboScore.totalScore).toBeGreaterThan(scatteredScore.totalScore);
  });

  it("counts and rewards bomb hands", () => {
    const score = scoreHand({
      hand: [card("clubs-9"), card("diamonds-9"), card("hearts-9"), card("spades-9"), card("clubs-4")]
    });

    expect(score.bombCount).toBeGreaterThan(0);
    expect(score.notes).toContain("1 bomb option");
    expect(score.totalScore).toBeGreaterThan(0);
  });

  it("penalizes isolated low cards when they are not part of combinations", () => {
    const isolatedScore = scoreHand({
      hand: [card("clubs-3"), card("diamonds-4"), card("spades-9")]
    });
    const connectedScore = scoreHand({
      hand: [card("clubs-3"), card("diamonds-4"), card("spades-5")]
    });

    expect(isolatedScore.lowCardPenalty).toBeGreaterThan(connectedScore.lowCardPenalty);
    expect(connectedScore.straightCount).toBeGreaterThan(0);
  });

  it("identifies near-winning hands that can go out quickly", () => {
    const score = scoreHand({
      hand: [card("clubs-Q"), card("diamonds-Q")],
      context: { likelyToLeadNext: true }
    });

    expect(score.estimatedTurnsToGoOut).toBe(1);
    expect(score.pairCount).toBe(1);
    expect(score.notes).toContain("near-winning hand");
  });

  it("is deterministic and does not mutate inputs", () => {
    const hand = [card("clubs-5"), card("diamonds-5"), card("spades-2")];
    const publicCards = [card("hearts-A")];
    const before = JSON.stringify({ hand, publicCards });

    expect(scoreHand({ hand, publicCards })).toEqual(scoreHand({ hand, publicCards }));
    expect(JSON.stringify({ hand, publicCards })).toBe(before);
  });
});
