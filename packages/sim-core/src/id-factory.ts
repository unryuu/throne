export class DeterministicIdFactory {
  #counter: number;

  constructor(
    readonly prefix: string,
    start = 0,
  ) {
    this.#counter = start;
  }

  next(kind: "domain" | "scheduled"): string {
    const id = `${this.prefix}:${kind}:${this.#counter.toString().padStart(8, "0")}`;
    this.#counter += 1;
    return id;
  }
}
