import { SOCKET_IO_PATH } from "@zhiliao/shared";
import { io } from "socket.io-client";
import { describe, expect, it, vi } from "vitest";

import { createAppSocket } from "./socket";

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({})),
}));

describe("socket client", () => {
  it("uses the API gateway path and polling-compatible deployment default", () => {
    createAppSocket();

    expect(io).toHaveBeenCalledWith(
      "/",
      expect.objectContaining({
        path: SOCKET_IO_PATH,
        transports: ["polling"],
        withCredentials: true,
        autoConnect: false,
      }),
    );
  });
});
