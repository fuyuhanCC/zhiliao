import type {
  AccountStore,
  LikeExperienceResult,
  RewardTransferInput,
  RewardTransferResult,
  UserAccountRecord,
} from "../account-store.js";

interface CompletedReward {
  senderUserId: string;
  recipientUserId: string;
  amount: number;
  result: Extract<RewardTransferResult, { ok: true }>;
}

export interface MemoryAccountStoreOptions {
  initialCoinBalance?: number;
  now?: () => Date;
}

export class MemoryAccountStore implements AccountStore {
  private readonly initialCoinBalance: number;
  private readonly now: () => Date;
  private readonly accounts = new Map<string, UserAccountRecord>();
  private readonly completedRewards = new Map<string, CompletedReward>();
  private readonly dailyLikeExperience = new Map<string, number>();

  constructor(options: MemoryAccountStoreOptions = {}) {
    this.initialCoinBalance = options.initialCoinBalance ?? 100;
    this.now = options.now ?? (() => new Date());
  }

  ensure(userId: string): UserAccountRecord {
    const existing = this.accounts.get(userId);
    if (existing) {
      return structuredClone(existing);
    }

    const account: UserAccountRecord = {
      userId,
      coinBalance: this.initialCoinBalance,
      experience: 0,
      updatedAt: this.now().toISOString(),
    };
    this.accounts.set(userId, account);
    return structuredClone(account);
  }

  get(userId: string): UserAccountRecord | undefined {
    const account = this.accounts.get(userId);
    return account ? structuredClone(account) : undefined;
  }

  migrate(fromUserId: string, toUserId: string): UserAccountRecord {
    if (fromUserId === toUserId) {
      return this.ensure(toUserId);
    }

    const target = this.accounts.get(toUserId);
    if (target) {
      this.accounts.delete(fromUserId);
      return structuredClone(target);
    }

    const source = this.accounts.get(fromUserId) ?? this.ensure(fromUserId);
    const migrated = {
      ...source,
      userId: toUserId,
      updatedAt: this.now().toISOString(),
    };
    this.accounts.delete(fromUserId);
    this.accounts.set(toUserId, migrated);
    return structuredClone(migrated);
  }

  transferReward(input: RewardTransferInput): RewardTransferResult {
    const completed = this.completedRewards.get(input.idempotencyKey);
    if (completed) {
      if (
        completed.senderUserId !== input.senderUserId ||
        completed.recipientUserId !== input.recipientUserId ||
        completed.amount !== input.amount
      ) {
        throw new Error("打赏幂等键被用于不同的交易参数");
      }
      return {
        ...structuredClone(completed.result),
        replayed: true,
      };
    }

    const sender = this.ensure(input.senderUserId);
    if (sender.coinBalance < input.amount) {
      return {
        ok: false,
        reason: "INSUFFICIENT_BALANCE",
        balance: sender.coinBalance,
      };
    }

    const recipient = this.ensure(input.recipientUserId);
    const updatedAt = this.now().toISOString();
    const updatedSender: UserAccountRecord = {
      ...sender,
      coinBalance: sender.coinBalance - input.amount,
      updatedAt,
    };
    const updatedRecipient: UserAccountRecord = {
      ...recipient,
      coinBalance: recipient.coinBalance + input.amount,
      experience: recipient.experience + input.recipientExperience,
      updatedAt,
    };
    this.accounts.set(input.senderUserId, updatedSender);
    this.accounts.set(input.recipientUserId, updatedRecipient);

    const result: Extract<RewardTransferResult, { ok: true }> = {
      ok: true,
      rewardId: input.rewardId,
      senderAccount: structuredClone(updatedSender),
      recipientAccount: structuredClone(updatedRecipient),
      replayed: false,
    };
    this.completedRewards.set(input.idempotencyKey, {
      senderUserId: input.senderUserId,
      recipientUserId: input.recipientUserId,
      amount: input.amount,
      result: structuredClone(result),
    });
    return result;
  }

  awardLikeExperience(userId: string): LikeExperienceResult {
    const dayKey = `${userId}:${this.now().toISOString().slice(0, 10)}`;
    const awardedToday = this.dailyLikeExperience.get(dayKey) ?? 0;
    const account = this.ensure(userId);
    if (awardedToday >= 50) {
      return { account, awarded: false };
    }

    const updated: UserAccountRecord = {
      ...account,
      experience: account.experience + 1,
      updatedAt: this.now().toISOString(),
    };
    this.accounts.set(userId, updated);
    this.dailyLikeExperience.set(dayKey, awardedToday + 1);
    return { account: structuredClone(updated), awarded: true };
  }
}
