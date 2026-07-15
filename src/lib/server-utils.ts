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

export function writeAnnotations(annotations: any[], teamConfig?: any, matchConfig?: any) {
  const uniqueAnnotations = dedupeAnnotationsByClipId(annotations);
  fs.writeFileSync(
    getAnnotationsPath(),
    JSON.stringify(
      {
        schema_version: "1.0.0",
        dataset: "TACTIC-Bench",
        team_config: teamConfig,
        match_config: matchConfig,
        annotations: uniqueAnnotations,
      },
      null,
      2,
    ),
  );
}

export function resetAnnotations() {
  fs.writeFileSync(
    getAnnotationsPath(),
    JSON.stringify(
      { schema_version: "1.0.0", dataset: "TACTIC-Bench", annotations: [] },
      null,
      2,
    ),
  );
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
  fs.writeFileSync(getSegmentsPath(), JSON.stringify(segments, null, 2));
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
  const safeRemove = (target: string) => {
    if (fs.existsSync(target))
      fs.rmSync(target, { recursive: true, force: true });
  };

  safeRemove(DATA_DIR);
  ensureDirectories();
  resetAnnotations();

  if (fs.existsSync(VIDEOS_DIR)) {
    for (const entry of fs.readdirSync(VIDEOS_DIR)) {
      if (/_720p\.mp4$/i.test(entry)) safeRemove(path.join(VIDEOS_DIR, entry));
    }
  }
}

export function getVideoPath(relativePath: string): string | null {
  const candidates = [
    path.join(process.cwd(), relativePath),
    path.join(VIDEOS_DIR, path.basename(relativePath)),
    path.join(process.cwd(), "raw_videos", path.basename(relativePath)),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
