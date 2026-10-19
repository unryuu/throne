import { expect, it, vi } from "vitest";
import { PressureMonitor } from "./pressure-monitor.ts";
it("alerts only after sustained pressure, reports queue vs model delay, and notifies recovery once", async () => {
  let time = 0,
    wait = 0,
    memory = 1000;
  const send = vi.fn(async () => {});
  const monitor = new PressureMonitor(
    () => ({
      waiting: wait ? 4 : 0,
      active: 3,
      oldestWaitMs: wait,
      oldestActiveMs: 180000,
    }),
    send,
    () => time,
    () => memory * 1024 * 1024,
  );
  await monitor.check();
  expect(send).not.toHaveBeenCalled();
  wait = 120000;
  await monitor.check();
  time = 299999;
  await monitor.check();
  expect(send).not.toHaveBeenCalled();
  time = 300000;
  await monitor.check();
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]).toBeDefined();
  time += 600000;
  await monitor.check();
  expect(send).toHaveBeenCalledOnce();
  wait = 0;
  await monitor.check();
  expect(send).toHaveBeenCalledTimes(2);
  await monitor.check();
  expect(send).toHaveBeenCalledTimes(2);
  memory = 100;
  await monitor.check();
  time += 300000;
  await monitor.check();
  expect(send).toHaveBeenCalledTimes(3);
});
it("notification failures do not escape and are retried without flooding", async () => {
  let time = 0;
  const send = vi.fn(async () => {
    throw new Error("unavailable");
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const monitor = new PressureMonitor(
      () => ({
        waiting: 1,
        active: 3,
        oldestWaitMs: 200000,
        oldestActiveMs: 200000,
      }),
      send,
      () => time,
      () => 1e9,
    );
    await monitor.check();
    time = 300000;
    await monitor.check();
    expect(send).toHaveBeenCalledOnce();
    time += 60000;
    await monitor.check();
    expect(send).toHaveBeenCalledOnce();
    time += 240000;
    await monitor.check();
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
  }
});
