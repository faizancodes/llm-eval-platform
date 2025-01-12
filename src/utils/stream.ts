import { StreamUpdate } from "@/types/evaluation";
import { Logger } from "@/utils/logger";

const logger = new Logger("utils: stream");

const encoder = new TextEncoder();

interface StreamError extends Error {
  code?: string;
}

export async function writeStreamUpdate(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  update: StreamUpdate
): Promise<void> {
  logger.debug("Writing stream update", {
    model: update.model,
    hasError: !!update.error,
  });
  try {
    await writer.write(encoder.encode(`data: ${JSON.stringify(update)}\n\n`));
    logger.debug("Successfully wrote stream update", { model: update.model });
  } catch (error) {
    // Ignore write errors if they're due to a closed stream
    if ((error as StreamError)?.code !== "ERR_INVALID_STATE") {
      logger.error("Failed to write stream update", {
        error,
        model: update.model,
      });
      throw error;
    }
    logger.debug("Stream closed, ignoring write", { model: update.model });
  }
}

export function createResponseStream(): {
  stream: ReadableStream;
  writer: WritableStreamDefaultWriter<Uint8Array>;
} {
  logger.debug("Creating new response stream");
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  logger.debug("Successfully created response stream");
  return { stream: readable, writer };
}

export function createStreamResponse(
  stream: ReadableStream<Uint8Array>
): Response {
  logger.debug("Creating stream response");
  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
  logger.debug("Successfully created stream response");
  return response;
}
