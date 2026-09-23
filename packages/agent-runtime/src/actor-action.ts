import type { MotivationProfile } from "@throne/shared-types";

export type ActorActionKind = "lobby" | "bribe" | "report" | "obey" | "defect";

export type ActorAction =
  | { readonly kind: "lobby"; readonly recipientId: string }
  | {
      readonly kind: "bribe";
      readonly recipientId: string;
      readonly offerAmount: number;
      readonly targetRef: string;
    }
  | { readonly kind: "report"; readonly subjectRef: string }
  | { readonly kind: "obey" }
  | { readonly kind: "defect" };

export type ActorActionContext = {
  readonly actorId: string;
  readonly influence: number;
  readonly motivations: MotivationProfile;
  readonly availableActions: readonly ActorActionKind[];
  readonly knownSubjectRefs: readonly string[];
};

export type ActorActionPolicy = {
  decide(context: ActorActionContext): Promise<ActorAction> | ActorAction;
};

export function assertActionAvailable(
  action: ActorAction,
  context: ActorActionContext,
): ActorAction {
  if (!context.availableActions.includes(action.kind)) {
    throw new Error(
      `Action ${action.kind} is not available to ${context.actorId}`,
    );
  }
  if (action.kind === "bribe") {
    if (action.offerAmount <= 0) {
      throw new Error("A bribe must offer a positive amount");
    }
    if (!context.knownSubjectRefs.includes(action.targetRef)) {
      throw new Error(
        `Actor ${context.actorId} cannot target an unknown subject ${action.targetRef}`,
      );
    }
  }
  if (
    action.kind === "report" &&
    !context.knownSubjectRefs.includes(action.subjectRef)
  ) {
    throw new Error(
      `Actor ${context.actorId} cannot report an unknown subject ${action.subjectRef}`,
    );
  }
  return action;
}
