/**
 * Requests: how she asks an agent for work and sees its replies. Self-contained: the shell mounts
 * `RequestsView` at /requests and injects the store; any screen can open `RequestComposer` or drop
 * in an `AskButton`. See apps/web/INTEGRATION.md.
 */
export { AskButton, type AskButtonProps } from "./AskButton";
export { RequestComposer, type RequestComposerProps } from "./RequestComposer";
export { RequestsBadge } from "./RequestsBadge";
export { RequestsView } from "./RequestsView";
export { createHttpRequestsStore } from "./store/http";
export {
  createMockRequestsStore,
  type MockRequestsOptions,
  type MockRequestsStore,
} from "./store/mock";
export type {
  CreateRequestInput,
  RequestListQuery,
  RequestPage,
  RequestsMountContext,
  RequestsNavigation,
  RequestsStore,
  RequestsViewProps,
  SubmitRequest,
} from "./types";
export { useRequestsBadge } from "./ui/hooks";
