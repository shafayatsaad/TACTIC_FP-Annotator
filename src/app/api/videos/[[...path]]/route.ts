import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getVideoPath, getVideosDir } from "@/lib/server-utils";

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".avi") return "video/x-msvideo";
  return "video/mp4";
}

function baseHeaders(videoPath: string, stat: fs.Stats) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename="${path
      .basename(videoPath)
      .replace(/"/g, "")}"`,
    "Content-Type": getContentType(videoPath),
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "Content-Length": String(stat.size),
  };
}

/**
 * Build a safely-cancellable Web ReadableStream from a Node Readable.
 *
 * Why this exists:
 *   The old implementation used `Readable.toWeb(stream)`, which is a thin
 *   bridge. When the client cancels (clip change, navigation, tab close),
 *   the underlying Node stream keeps emitting `data` events and tries to
 *   call `controller.enqueue` on a CLOSED controller — that throws
 *   ERR_INVALID_STATE and crashes the Node process (uncaughtException).
 *
 * This version:
 *   - Queues chunks and only enqueues when the controller is open.
 *   - Listens to the request abort signal and destroys the Node stream
 *     so the file descriptor is freed and no more `data` events fire.
 *   - Cleans up on stream `end` / `error` / `close` to avoid leaks.
 */
function createSafeStream(
  nodeStream: fs.ReadStream,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Buffer | Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          // Controller is closed/cancelled — stop pushing data.
          closed = true;
          destroy();
        }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const safeError = (err: Error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {
          /* already closed */
        }
      };
      const destroy = () => {
        try {
          nodeStream.destroy();
        } catch {
          /* ignore */
        }
      };

      nodeStream.on("data", (chunk: string | Buffer) => {
        if (typeof chunk === "string") {
          safeEnqueue(Buffer.from(chunk));
        } else {
          safeEnqueue(chunk);
        }
      });
      nodeStream.on("end", safeClose);
      nodeStream.on("close", safeClose);
      nodeStream.on("error", (err: Error) => safeError(err));

      const onAbort = () => {
        destroy();
        safeError(new DOMException("Request aborted", "AbortError"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    },
    cancel() {
      try {
        nodeStream.destroy();
      } catch {
        /* ignore */
      }
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path?: string[] } },
) {
  try {
    const relativePath = params.path?.join("/") || "";

    // Handle /api/videos/list - return available video files
    if (relativePath === "list") {
      const videosDir = getVideosDir();
      const files = fs.readdirSync(videosDir);
      const videoFiles = files.filter((f) =>
        /\.(mp4|webm|mov|mkv|avi)$/i.test(f),
      );
      return NextResponse.json({ videos: videoFiles });
    }

    const videoPath = getVideoPath(relativePath);
    if (!videoPath)
      return NextResponse.json({ error: "Video not found" }, { status: 404 });

    const stat = fs.statSync(videoPath);
    const range = request.headers.get("range");
    const headers = baseHeaders(videoPath, stat);

    if (!range) {
      const stream = fs.createReadStream(videoPath);
      return new NextResponse(createSafeStream(stream, request.signal), {
        headers,
      });
    }

    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (!match)
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });

    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : stat.size - 1;
    const end = Math.min(requestedEnd, stat.size - 1);
    if (start >= stat.size || end < start)
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(videoPath, { start, end });
    return new NextResponse(createSafeStream(stream, request.signal), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to serve video", detail: error.message },
      { status: 500 },
    );
  }
}

export async function HEAD(
  _request: NextRequest,
  { params }: { params: { path?: string[] } },
) {
  try {
    const relativePath = params.path?.join("/") || "";
    const videoPath = getVideoPath(relativePath);
    if (!videoPath)
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    return new NextResponse(null, {
      headers: baseHeaders(videoPath, fs.statSync(videoPath)),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to serve video", detail: error.message },
      { status: 500 },
    );
  }
}
