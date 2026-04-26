import type { MessageRequest, MessageResponse } from "../shared/types";

export async function sendMessage<T>(request: MessageRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as MessageResponse<T>;
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.data;
}
