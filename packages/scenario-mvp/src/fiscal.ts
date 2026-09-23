import type {
  DomainEvent,
  FiscalReturn,
  JsonObject,
  ResourceAccount,
  ResourceFlow,
  ResourceFlowKind,
  SimTime,
} from "@throne/shared-types";

export type FiscalState = {
  readonly accounts: Readonly<Record<string, ResourceAccount>>;
  readonly flows: readonly ResourceFlow[];
  readonly returns: readonly FiscalReturn[];
  readonly audits: Readonly<Record<string, number>>;
};

export const emptyFiscalState: FiscalState = {
  accounts: {},
  flows: [],
  returns: [],
  audits: {},
};

export function createAccount(
  state: FiscalState,
  account: ResourceAccount,
): FiscalState {
  if (state.accounts[account.id]) {
    throw new Error(`Duplicate fiscal account: ${account.id}`);
  }
  if (account.balance < 0) {
    throw new Error(`Account ${account.id} cannot start negative`);
  }
  return { ...state, accounts: { ...state.accounts, [account.id]: account } };
}

export function applyFlow(
  state: FiscalState,
  flow: Omit<ResourceFlow, "occurredAt"> & { readonly occurredAt: SimTime },
): FiscalState {
  if (!(flow.amount > 0)) {
    throw new Error(`Flow ${flow.id} must move a positive amount`);
  }
  const source =
    flow.fromAccountId === undefined
      ? undefined
      : requiredAccount(state, flow.fromAccountId);
  const target =
    flow.toAccountId === undefined
      ? undefined
      : requiredAccount(state, flow.toAccountId);
  assertFlowShape(flow.kind, source, target);
  if (source && source.balance < flow.amount) {
    throw new Error(
      `Flow ${flow.id} overdraws ${source.id}: ${source.balance} < ${flow.amount}`,
    );
  }

  const accounts = { ...state.accounts };
  if (source) {
    accounts[source.id] = {
      ...source,
      balance: rounded(source.balance - flow.amount),
    };
  }
  if (target) {
    accounts[target.id] = {
      ...target,
      balance: rounded(target.balance + flow.amount),
    };
  }
  const recorded: ResourceFlow = {
    id: flow.id,
    kind: flow.kind,
    ...(flow.fromAccountId === undefined
      ? {}
      : { fromAccountId: flow.fromAccountId }),
    ...(flow.toAccountId === undefined
      ? {}
      : { toAccountId: flow.toAccountId }),
    amount: flow.amount,
    occurredAt: flow.occurredAt,
    reason: flow.reason,
  };
  return { ...state, accounts, flows: [...state.flows, recorded] };
}

export function recordReturn(
  state: FiscalState,
  fiscalReturn: FiscalReturn,
): FiscalState {
  if (state.returns.some((entry) => entry.id === fiscalReturn.id)) {
    throw new Error(`Duplicate fiscal return: ${fiscalReturn.id}`);
  }
  return { ...state, returns: [...state.returns, fiscalReturn] };
}

export function recordAudit(
  state: FiscalState,
  returnId: string,
  verifiedBalance: number,
): FiscalState {
  if (!state.returns.some((entry) => entry.id === returnId)) {
    throw new Error(`Unknown fiscal return: ${returnId}`);
  }
  return {
    ...state,
    audits: { ...state.audits, [returnId]: verifiedBalance },
  };
}

export function deriveBalance(state: FiscalState, accountId: string): number {
  return requiredAccount(state, accountId).balance;
}

export function deriveReportedBalance(
  state: FiscalState,
  subjectRef: string,
): number | undefined {
  return state.returns.filter((entry) => entry.subjectRef === subjectRef).at(-1)
    ?.claimedBalance;
}

export function deriveVerifiedBalance(
  state: FiscalState,
  subjectRef: string,
): number | undefined {
  const latest = state.returns
    .filter((entry) => entry.subjectRef === subjectRef)
    .at(-1);
  if (!latest) return undefined;
  return state.audits[latest.id];
}

export function totalOfKind(
  state: FiscalState,
  kind: ResourceAccount["kind"],
): number {
  let total = 0;
  for (const account of Object.values(state.accounts)) {
    if (account.kind === kind) total += account.balance;
  }
  return rounded(total);
}

export function reduceFiscalEvent(
  state: FiscalState,
  event: DomainEvent,
): FiscalState {
  switch (event.eventType) {
    case "resource.flowed":
      return applyFlow(state, flowFromEvent(event));
    case "fiscal.returned":
      return recordReturn(state, fiscalReturnFromEvent(event));
    case "audit.recorded":
      return recordAudit(
        state,
        String(event.payload.returnId),
        Number(event.payload.verifiedBalance),
      );
    default:
      throw new Error(
        `Unhandled fiscal event ${event.eventType} (${event.id})`,
      );
  }
}

export function validateFiscalState(state: FiscalState): void {
  for (const account of Object.values(state.accounts)) {
    if (!Number.isFinite(account.balance) || account.balance < 0) {
      throw new Error(`Account ${account.id} has an invalid balance`);
    }
  }
  for (const flow of state.flows) {
    if (flow.fromAccountId !== undefined)
      requiredAccount(state, flow.fromAccountId);
    if (flow.toAccountId !== undefined)
      requiredAccount(state, flow.toAccountId);
  }
}

export function flowKindOf(value: unknown): ResourceFlowKind {
  if (
    value === "levy" ||
    value === "harvest" ||
    value === "requisition" ||
    value === "payroll" ||
    value === "transfer" ||
    value === "loss" ||
    value === "graft"
  ) {
    return value;
  }
  throw new Error(`Invalid resource flow kind: ${String(value)}`);
}

function assertFlowShape(
  kind: ResourceFlowKind,
  source: ResourceAccount | undefined,
  target: ResourceAccount | undefined,
): void {
  const needsSource =
    kind === "requisition" ||
    kind === "payroll" ||
    kind === "transfer" ||
    kind === "loss" ||
    kind === "graft";
  const needsTarget =
    kind === "levy" ||
    kind === "harvest" ||
    kind === "requisition" ||
    kind === "payroll" ||
    kind === "transfer" ||
    kind === "graft";
  if (needsSource && !source)
    throw new Error(`Flow ${kind} requires a source account`);
  if (needsTarget && !target)
    throw new Error(`Flow ${kind} requires a target account`);
  if ((kind === "levy" || kind === "harvest") && source) {
    throw new Error(`Flow ${kind} cannot have a source account`);
  }
}

function flowFromEvent(event: DomainEvent): ResourceFlow {
  const payload = event.payload;
  const kind = flowKindOf(payload.kind);
  return {
    id: String(payload.flowId),
    kind,
    ...(payload.fromAccountId === undefined
      ? {}
      : { fromAccountId: String(payload.fromAccountId) }),
    ...(payload.toAccountId === undefined
      ? {}
      : { toAccountId: String(payload.toAccountId) }),
    amount: Number(payload.amount),
    occurredAt: event.occurredAt,
    reason: String(payload.reason),
  };
}

function fiscalReturnFromEvent(event: DomainEvent): FiscalReturn {
  const payload = event.payload;
  const basis = payload.basis;
  if (basis !== "administrative_return" && basis !== "independent_audit") {
    throw new Error(`Invalid fiscal return basis: ${String(basis)}`);
  }
  return {
    id: String(payload.returnId),
    authorId: String(payload.authorId),
    subjectRef: String(payload.subjectRef),
    claimedBalance: Number(payload.claimedBalance),
    basis,
  };
}

function requiredAccount(state: FiscalState, id: string): ResourceAccount {
  const account = state.accounts[id];
  if (!account) throw new Error(`Unknown fiscal account: ${id}`);
  return account;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export type FiscalJson = JsonObject;
