// A click while a LinkedIn share is still running is dropped, and the gate
// survives a task that throws or rejects.

import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { describe, it } from "node:test";
import { createSingleFlight } from "../src/components/organization/single-flight.ts";

describe("createSingleFlight", () => {
  it("drops calls while a task runs, and takes the next once it settles", async () => {
    const run = createSingleFlight();
    let finish!: () => void;
    const started: number[] = [];
    strictEqual(
      run(() => {
        started.push(1);
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      }),
      true,
    );
    strictEqual(
      run(async () => {
        started.push(2);
      }),
      false,
    );
    finish();
    await Promise.resolve();
    await Promise.resolve();
    strictEqual(
      run(() => {
        started.push(3);
        return Promise.reject(new Error("x"));
      }),
      true,
    );
    await Promise.resolve();
    await Promise.resolve();
    strictEqual(
      run(async () => {
        started.push(4);
      }),
      true,
    );
    deepStrictEqual(started, [1, 3, 4]);
  });

  it("releases and rethrows when the task throws before returning a promise", () => {
    const run = createSingleFlight();
    throws(
      () =>
        run(() => {
          throw new URIError("URI malformed");
        }),
      URIError,
    );
    strictEqual(
      run(async () => {}),
      true,
    );
  });
});
