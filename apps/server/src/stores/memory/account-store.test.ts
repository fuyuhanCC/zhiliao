import { describe, expect, it } from "vitest";

import { progressionForExperience, toUserAccount } from "../../domain/account/user-account.js";
import { MemoryAccountStore } from "./account-store.js";

describe("MemoryAccountStore", () => {
  it("creates a new account with 100 coins and level one", () => {
    const store = new MemoryAccountStore({
      now: () => new Date("2026-09-13T08:00:00.000Z"),
    });

    expect(toUserAccount(store.ensure("user-1"))).toEqual({
      coinBalance: 100,
      experience: 0,
      level: 1,
      levelTitle: "蛰伏",
      nextLevelExperience: 500,
    });
  });

  it("transfers a reward atomically and replays the same transaction without double charging", () => {
    const store = new MemoryAccountStore();
    const input = {
      idempotencyKey: "session-1:reward:req-1",
      rewardId: "reward-1",
      senderUserId: "sender",
      recipientUserId: "recipient",
      amount: 10 as const,
      recipientExperience: 2,
    };

    const first = store.transferReward(input);
    const replay = store.transferReward({ ...input, rewardId: "ignored-new-id" });

    expect(first).toMatchObject({
      ok: true,
      rewardId: "reward-1",
      replayed: false,
      senderAccount: { coinBalance: 90 },
      recipientAccount: { coinBalance: 110, experience: 2 },
    });
    expect(replay).toMatchObject({
      ok: true,
      rewardId: "reward-1",
      replayed: true,
      senderAccount: { coinBalance: 90 },
      recipientAccount: { coinBalance: 110, experience: 2 },
    });
    expect(store.get("sender")?.coinBalance).toBe(90);
    expect(store.get("recipient")).toMatchObject({ coinBalance: 110, experience: 2 });
  });

  it("does not debit either account when the sender balance is insufficient", () => {
    const store = new MemoryAccountStore({ initialCoinBalance: 4 });

    const result = store.transferReward({
      idempotencyKey: "session-1:reward:req-1",
      rewardId: "reward-1",
      senderUserId: "sender",
      recipientUserId: "recipient",
      amount: 5,
      recipientExperience: 2,
    });

    expect(result).toEqual({ ok: false, reason: "INSUFFICIENT_BALANCE", balance: 4 });
    expect(store.get("sender")?.coinBalance).toBe(4);
    expect(store.get("recipient")).toBeUndefined();
  });

  it("caps like experience at 50 per UTC day", () => {
    const store = new MemoryAccountStore({
      now: () => new Date("2026-09-13T08:00:00.000Z"),
    });

    const awards = Array.from({ length: 51 }, () => store.awardLikeExperience("speaker"));

    expect(awards.filter((result) => result.awarded)).toHaveLength(50);
    expect(awards.at(-1)?.awarded).toBe(false);
    expect(store.get("speaker")?.experience).toBe(50);
  });

  it("uses the six PRD level thresholds", () => {
    expect(progressionForExperience(0)).toMatchObject({ level: 1, levelTitle: "蛰伏" });
    expect(progressionForExperience(500)).toMatchObject({ level: 2, levelTitle: "破土" });
    expect(progressionForExperience(2_000)).toMatchObject({ level: 3, levelTitle: "蜕壳" });
    expect(progressionForExperience(5_000)).toMatchObject({ level: 4, levelTitle: "振翅" });
    expect(progressionForExperience(12_000)).toMatchObject({ level: 5, levelTitle: "鸣夏" });
    expect(progressionForExperience(30_000)).toEqual({
      level: 6,
      levelTitle: "知秋",
      nextLevelExperience: null,
    });
  });
});
