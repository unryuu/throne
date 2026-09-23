import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import {
  applyFlow,
  createAccount,
  deriveBalance,
  deriveReportedBalance,
  deriveVerifiedBalance,
  emptyFiscalState,
  reduceFiscalEvent,
  totalOfKind,
  validateFiscalState,
  type FiscalState,
} from "./fiscal.ts";

function base(): FiscalState {
  let state = createAccount(emptyFiscalState, {
    id: "account:treasury",
    ownerId: "organization:court",
    kind: "money",
    balance: 100,
  });
  state = createAccount(state, {
    id: "account:payroll",
    ownerId: "organization:guard",
    kind: "money",
    balance: 0,
  });
  state = createAccount(state, {
    id: "account:north-granary",
    ownerId: "region:north",
    kind: "grain",
    balance: 250,
  });
  return state;
}

describe("fiscal layer", () => {
  it("transfers value between accounts without changing the kind total", () => {
    const next = applyFlow(base(), {
      id: "flow:payroll",
      kind: "payroll",
      fromAccountId: "account:treasury",
      toAccountId: "account:payroll",
      amount: 40,
      occurredAt: simTime(10),
      reason: "monthly guard payroll",
    });
    expect(deriveBalance(next, "account:treasury")).toBe(60);
    expect(deriveBalance(next, "account:payroll")).toBe(40);
    expect(totalOfKind(next, "money")).toBe(100);
  });

  it("rejects an overdraft", () => {
    expect(() =>
      applyFlow(base(), {
        id: "flow:over",
        kind: "transfer",
        fromAccountId: "account:treasury",
        toAccountId: "account:payroll",
        amount: 500,
        occurredAt: simTime(10),
        reason: "too much",
      }),
    ).toThrow("overdraws");
  });

  it("adds value on a levy and removes it on a loss", () => {
    const levied = applyFlow(base(), {
      id: "flow:levy",
      kind: "levy",
      toAccountId: "account:treasury",
      amount: 30,
      occurredAt: simTime(20),
      reason: "autumn land tax",
    });
    expect(deriveBalance(levied, "account:treasury")).toBe(130);

    const lost = applyFlow(levied, {
      id: "flow:loss",
      kind: "loss",
      fromAccountId: "account:north-granary",
      amount: 50,
      occurredAt: simTime(30),
      reason: "transport spoilage",
    });
    expect(deriveBalance(lost, "account:north-granary")).toBe(200);
    expect(totalOfKind(lost, "grain")).toBe(200);
  });

  it("keeps the reported figure separate from the objective balance", () => {
    let state = applyFlow(base(), {
      id: "flow:graft",
      kind: "graft",
      fromAccountId: "account:treasury",
      toAccountId: "account:payroll",
      amount: 25,
      occurredAt: simTime(40),
      reason: "silent diversion",
    });
    state = reduceFiscalEvent(
      state,
      event("fiscal.returned", "return:1", {
        returnId: "return:1",
        authorId: "actor:governor",
        subjectRef: "account:treasury",
        claimedBalance: 100,
        basis: "administrative_return",
      }),
    );
    expect(deriveBalance(state, "account:treasury")).toBe(75);
    expect(deriveReportedBalance(state, "account:treasury")).toBe(100);
    expect(deriveVerifiedBalance(state, "account:treasury")).toBeUndefined();

    state = reduceFiscalEvent(
      state,
      event("audit.recorded", "audit:1", {
        returnId: "return:1",
        verifiedBalance: 75,
      }),
    );
    expect(deriveVerifiedBalance(state, "account:treasury")).toBe(75);
  });

  it("rejects unknown events and damaged balances", () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() => reduceFiscalEvent(base(), unknown)).toThrow(
      "Unhandled fiscal event",
    );

    const damaged: FiscalState = {
      ...base(),
      accounts: {
        "account:treasury": {
          id: "account:treasury",
          ownerId: "organization:court",
          kind: "money",
          balance: -5,
        },
      },
    };
    expect(() => validateFiscalState(damaged)).toThrow("invalid balance");
  });
});

function event(
  eventType: string,
  id: string,
  payload: Record<string, unknown>,
): DomainEvent {
  return {
    id,
    occurredAt: simTime(50),
    eventType,
    payload: payload as never,
  };
}
