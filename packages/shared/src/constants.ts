export const PRODUCT_NAME = "知了";
export const APP_VERSION = "0.1.0";

export const ROOM_RULES = {
  seatCount: 6,
  speechLimitSeconds: 120,
  cooldownSeconds: 60,
} as const;

export const USER_LEVELS = [
  { level: 1, title: "蛰伏", minimumExperience: 0 },
  { level: 2, title: "破土", minimumExperience: 500 },
  { level: 3, title: "蜕壳", minimumExperience: 2000 },
  { level: 4, title: "振翅", minimumExperience: 5000 },
  { level: 5, title: "鸣夏", minimumExperience: 12000 },
  { level: 6, title: "知秋", minimumExperience: 30000 },
] as const;

export const REWARD_AMOUNTS = [5, 10, 50] as const;
