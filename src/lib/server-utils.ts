import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const VIDEOS_DIR = path.join(process.cwd(), "raw_videos");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");

export function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  if (!fs.existsSync(EXPORTS_DIR))
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

export function getManifestPath() {
  ensureDirectories();
  return path.join(DATA_DIR, "clip_manifest.json");
}
export function getAnnotationsPath() {
  ensureDirectories();
  return path.join(DATA_DIR, "annotations.json");
}
export function getSegmentsPath() {
  ensureDirectories();
  return path.join(DATA_DIR, "segments.json");
}
export function getExportsDir() {
  ensureDirectories();
  return EXPORTS_DIR;
}
export function getVideosDir() {
  ensureDirectories();
  return VIDEOS_DIR;
}

export function sanitizeFileStem(value: unknown, fallback = "unknown"): string {
  const stem = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return stem || fallback;
}

export function resolveInsideDir(baseDir: string, unsafePath: string): string | null {
  const normalizedInput = unsafePath.replace(/^raw_videos[\\/]/i, "");
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(resolvedBase, normalizedInput);
  const relative = path.relative(resolvedBase, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolvedPath;
}

export function atomicWriteText(filePath: string, contents: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(tmpPath, contents, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export function atomicWriteJson(filePath: string, value: unknown) {
  atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readManifest(): any[] {
  try {
    const raw = fs.readFileSync(getManifestPath(), "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data) && data.length > 0 && data[0].clips) {
      const flat: any[] = [];
      data.forEach((m: any) => flat.push(...(m.clips || [])));
      return flat;
    }
    if (Array.isArray(data)) return data;
    if (data.clips && Array.isArray(data.clips)) return data.clips;
    return [];
  } catch {
    return [];
  }
}

export function readAnnotations(): any[] {
  return readAnnotationSession().annotations;
}

export function readAnnotationSession(): {
  annotations: any[];
  team_config?: any;
  match_config?: any;
  schema_version: string;
  dataset: string;
} {
  try {
    const raw = fs.readFileSync(getAnnotationsPath(), "utf-8");
    const data = JSON.parse(raw);
    if (data.annotations && Array.isArray(data.annotations))
      return {
        schema_version: data.schema_version || "1.0.0",
        dataset: data.dataset || "TACTIC-Bench",
        annotations: data.annotations,
        team_config: data.team_config,
        match_config: data.match_config,
      };
    if (Array.isArray(data))
      return {
        schema_version: "1.0.0",
        dataset: "TACTIC-Bench",
        annotations: data,
      };
    return {
      schema_version: "1.0.0",
      dataset: "TACTIC-Bench",
      annotations: [],
    };
  } catch {
    return {
      schema_version: "1.0.0",
      dataset: "TACTIC-Bench",
      annotations: [],
    };
  }
}

function dedupeAnnotationsByClipId(annotations: any[]) {
  const keyed = new Map<string, any>();
  const unkeyed: any[] = [];

  for (const annotation of annotations) {
    const clipId = annotation?.clip_id;
    if (typeof clipId === "string" && clipId.length > 0) {
      keyed.delete(clipId);
      keyed.set(clipId, annotation);
    } else {
      unkeyed.push(annotation);
    }
  }

  return [...unkeyed, ...Array.from(keyed.values())];
}

export function writeAnnotations(
  annotations: any[],
  teamConfig?: any,
  matchConfig?: any,
) {
  const uniqueAnnotations = dedupeAnnotationsByClipId(annotations);
  atomicWriteJson(getAnnotationsPath(), {
    schema_version: "1.0.0",
    dataset: "TACTIC-Bench",
    team_config: teamConfig,
    match_config: matchConfig,
    annotations: uniqueAnnotations,
  });
}

export function resetAnnotations() {
  atomicWriteJson(getAnnotationsPath(), {
    schema_version: "1.0.0",
    dataset: "TACTIC-Bench",
    annotations: [],
  });
}

// ─── Segments persistence ───

export function readSegments(): any[] {
  try {
    const raw = fs.readFileSync(getSegmentsPath(), "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

export function writeSegments(segments: any[]) {
  atomicWriteJson(getSegmentsPath(), segments);
}

export function deleteSegment(clipId: string) {
  const segments = readSegments();
  const filtered = segments.filter((s: any) => s.clip_id !== clipId);
  writeSegments(filtered);
}

export function deleteAnnotation(clipId: string) {
  const session = readAnnotationSession();
  const filtered = session.annotations.filter((a: any) => a.clip_id !== clipId);
  writeAnnotations(filtered, session.team_config, session.match_config);
}

export function resetGeneratedSessionFiles() {
  ensureDirectories();
  const safeUnlink = (target: string) => {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      fs.unlinkSync(target);
    }
  };
  const emptyDir = (target: string) => {
    if (!fs.existsSync(target)) return;
    for (const entry of fs.readdirSync(target)) {
      fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    }
  };

  safeUnlink(getManifestPath());
  safeUnlink(getSegmentsPath());
  emptyDir(EXPORTS_DIR);
  ensureDirectories();
  resetAnnotations();
}

export function getVideoPath(relativePath: string): string | null {
  const resolved = resolveInsideDir(VIDEOS_DIR, relativePath);
  if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return resolved;
  }
  return null;
}
