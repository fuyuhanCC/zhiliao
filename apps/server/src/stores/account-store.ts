import { REWARD_AMOUNTS } from "@zhiliao/shared";

export type RewardAmount = (typeof REWARD_AMOUNTS)[number];

export interface UserAccountRecord {
  userId: string;
  coinBalance: number;
  experience: number;
  updatedAt: string;
}

export interface RewardTransferInput {
  idempotencyKey: string;
  rewardId: string;
  senderUserId: string;
  recipientUserId: string;
  amount: RewardAmount;
  recipientExperience: number;
}

export type RewardTransferResult =
  | {
      ok: true;
      rewardId: string;
      senderAccount: UserAccountRecord;
      recipientAccount: UserAccountRecord;
      replayed: boolean;
    }
  | {
      ok: false;
      reason: "INSUFFICIENT_BALANCE";
      balance: number;
    };

export interface LikeExperienceResult {
  account: UserAccountRecord;
  awarded: boolean;
}

export interface AccountStore {
  ensure(userId: string): UserAccountRecord;
  get(userId: string): UserAccountRecord | undefined;
  migrate(fromUserId: string, toUserId: string): UserAccountRecord;
  transferReward(input: RewardTransferInput): RewardTransferResult;
  awardLikeExperience(userId: string): LikeExperienceResult;
}
