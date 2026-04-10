export type EffectClass = "idempotent" | "reversible" | "append-only" | "destructive";

export type RunStatus =
  | "active"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated"
  | "partially_compensated";

export interface UnwindRun {
  id: string;
  agentId: string;
  parentRunId?: string;
  forkFromStep?: number;
  status: RunStatus;
  events: UnwindEvent[];
  createdAt: string;
  completedAt?: string;
}

interface BaseEvent {
  eventId: string;
  stepIndex: number;
  timestamp: string;
}

export interface ToolCallTracked extends BaseEvent {
  type: "ToolCallTracked";
  toolCallId: string;
  toolName: string;
  effectClass: EffectClass;
  args: Record<string, unknown>;
  stableArgs: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ToolCallCompleted extends BaseEvent {
  type: "ToolCallCompleted";
  toolCallId: string;
  result: unknown;
  durationMs: number;
}

export interface ToolCallFailed extends BaseEvent {
  type: "ToolCallFailed";
  toolCallId: string;
  error: unknown;
  reason: "execution_error" | "timeout_side_effect_unknown" | "approval_denied";
}

export interface CompensationStarted extends BaseEvent {
  type: "CompensationStarted";
  compensatingToolCallId: string;
  compensationAction: string;
  args: Record<string, unknown>;
}

export interface CompensationCompleted extends BaseEvent {
  type: "CompensationCompleted";
  compensatingToolCallId: string;
  result: unknown;
  durationMs: number;
}

export interface CompensationFailed extends BaseEvent {
  type: "CompensationFailed";
  compensatingToolCallId: string;
  reason:
    | "append_only_no_compensation"
    | "compensation_action_failed"
    | "destructive_escalation";
  detail: string;
}

export interface ApprovalRequested extends BaseEvent {
  type: "ApprovalRequested";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ApprovalReceived extends BaseEvent {
  type: "ApprovalReceived";
  toolCallId: string;
  approved: boolean;
}

export interface RunCompleted extends BaseEvent {
  type: "RunCompleted";
}

export interface RunFailed extends BaseEvent {
  type: "RunFailed";
  error: unknown;
  message: string;
}

export type UnwindEvent =
  | ToolCallTracked
  | ToolCallCompleted
  | ToolCallFailed
  | CompensationStarted
  | CompensationCompleted
  | CompensationFailed
  | ApprovalRequested
  | ApprovalReceived
  | RunCompleted
  | RunFailed;
