import { USER_LEVELS, type PublicUser } from "@zhiliao/shared";
import type { components } from "@zhiliao/shared/openapi";

import type { UserAccountRecord } from "../../stores/account-store.js";

export type UserAccount = components["schemas"]["UserAccount"];
export type UserLevel = components["schemas"]["UserLevel"];
export type UserLevelTitle = components["schemas"]["UserLevelTitle"];

export interface UserProgression {
  level: UserLevel;
  levelTitle: UserLevelTitle;
  nextLevelExperience: number | null;
}

export function progressionForExperience(experience: number): UserProgression {
  let current: (typeof USER_LEVELS)[number] = USER_LEVELS[0];
  for (const definition of USER_LEVELS) {
    if (experience < definition.minimumExperience) {
      break;
    }
    current = definition;
  }

  const next = USER_LEVELS.at(current.level);
  return {
    level: current.level,
    levelTitle: current.title,
    nextLevelExperience: next?.minimumExperience ?? null,
  };
}

export function toUserAccount(record: UserAccountRecord): UserAccount {
  const progression = progressionForExperience(record.experience);
  return {
    coinBalance: record.coinBalance,
    experience: record.experience,
    ...progression,
  };
}

export function withAccountProgression(user: PublicUser, account: UserAccountRecord): PublicUser {
  const progression = progressionForExperience(account.experience);
  return {
    ...user,
    level: progression.level,
    levelTitle: progression.levelTitle,
  };
}
