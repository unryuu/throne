import type { SimTime } from "./time.ts";

export type ResourceKind =
  "money" | "grain" | "manpower" | "administrative_capacity" | "communication";

export type ResourceAccount = {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: ResourceKind;
  readonly balance: number;
  readonly locationId?: string;
};

export type ResourceFlowKind =
  | "levy"
  | "harvest"
  | "requisition"
  | "payroll"
  | "transfer"
  | "loss"
  | "graft";

export type ResourceFlow = {
  readonly id: string;
  readonly kind: ResourceFlowKind;
  readonly fromAccountId?: string;
  readonly toAccountId?: string;
  readonly amount: number;
  readonly occurredAt: SimTime;
  readonly reason: string;
};

export type FiscalReturnBasis = "administrative_return" | "independent_audit";

export type FiscalReturn = {
  readonly id: string;
  readonly authorId: string;
  readonly subjectRef: string;
  readonly claimedBalance: number;
  readonly basis: FiscalReturnBasis;
};
