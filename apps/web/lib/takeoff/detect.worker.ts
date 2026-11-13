import { runDetection, type DetectRequest } from "./detectRun";

// The finder off the page's thread (`detectOffThread.ts`): one request, one reply.
const scope = self as unknown as { onmessage: ((event: MessageEvent<DetectRequest>) => void) | null; postMessage: (message: unknown) => void };
scope.onmessage = (event) => {
  scope.postMessage(runDetection(event.data));
};
