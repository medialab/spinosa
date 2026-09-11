import { errorMessage } from "../util/error";
import { isRecord } from "../util/record";
import type { useSDK } from "../context/sdk";
import type { VisionTranscribe } from "@spinosa/core/import/vision-transcribe";

export function visionTranscribeResultText(result: unknown): string {
  if (!isRecord(result))
    throw new Error("Vision request returned an invalid response");
  if (result.error !== undefined && result.error !== null)
    throw new Error(errorMessage(result.error));

  const text =
    isRecord(result.data) && typeof result.data.text === "string"
      ? result.data.text.trim()
      : "";
  if (!text) throw new Error("Vision model returned no text");
  return text;
}

/**
 * Kernel vision transcribe callback shared by onboarding + add-files.
 * Sends only provider/model/prompt/mime+base64, never API keys.
 */
export function createVisionTranscriber(
  sdk: Pick<ReturnType<typeof useSDK>, "client">,
): VisionTranscribe {
  return async (request) => {
    const result = await sdk.client.provider.vision.transcribe({
      providerID: request.providerID,
      modelID: request.modelID,
      prompt: request.prompt,
      image: request.image,
    })
    return visionTranscribeResultText(result)
  }
}
