# TACTIC-FP Annotator — Technical Specification

## Dependencies

### Core
- next (App Router)
- react, react-dom
- typescript
- tailwindcss
- @tailwindcss/postcss (PostCSS integration)

### UI
- lucide-react (all icons)
- framer-motion (button hover/tap animations)

### Dev
- @types/node, @types/react, @types/react-dom
- eslint, eslint-config-next

---

## Component Inventory

### Layout (server components)
| Component | Source | Notes |
|-----------|--------|-------|
| layout.tsx | Custom | Root layout with fonts, metadata |
| page.tsx | Custom | Main page composing all sections |

### Client Components
| Component | Source | Notes |
|-----------|--------|-------|
| AnnotatorClient | Custom | Main client wrapper, all state + keyboard handler |
| Header | Custom | Progress, actions, status |
| ClipExplorer | Custom | Sidebar with list, search, filters |
| VideoPlayer | Custom | Video element + controls + progress bar |
| IntentLabels | Custom | 6-group grid of 14 label buttons |
| AnnotationPanel | Custom | Team toggle, confidence, submit, stats, export |

### Hooks
| Hook | Purpose |
|------|---------|
| useKeyboardShortcuts | Global keyboard event handler |
| useAnnotations | Annotation CRUD + sync |
| useVideoPlayer | Video playback state + controls |

### API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| /api/manifest | GET | Read clip_manifest.json |
| /api/annotations | GET, POST | Load/save annotations.json |
| /api/annotations/reset | POST | Clear all annotations |
| /api/pipeline/generate | POST | Run pipeline.py to generate manifest |
| /api/videos/convert | POST | Convert MKV to MP4 via ffmpeg |
| /api/export/json | POST | Generate JSON export file |
| /api/export/csv | POST | Generate CSV export file |
| /api/export/download/[filename] | GET | Download exported file |
| /api/videos/[...path] | GET | Serve video files from raw_videos/ |
| /api/raw-videos/[...path] | GET | Serve raw video files |

---

## Animation Implementation

| Animation | Library | Implementation | Complexity |
|-----------|---------|----------------|------------|
| Button hover scale | framer-motion | whileHover={{ scale: 1.05 }} | Low |
| Button tap scale | framer-motion | whileTap={{ scale: 0.95 }} | Low |
| Play button pulse | framer-motion | animate + repeat | Low |
| Loading spinner | CSS | animate-spin Tailwind | Low |
| Progress bar fill | CSS | transition-all duration-300 | Low |
| Status message pulse | CSS | animate-pulse Tailwind | Low |
| Active clip indicator | CSS | animate-pulse on dot | Low |
| Clip list scroll | CSS | scroll-behavior smooth | Low |

All animations are simple CSS/Framer Motion transitions. No complex effects.

---

## State Management

React useState/useRef only. No external state library needed.

**Top-level state** (in AnnotatorClient):
- clips: Clip[]
- annotations: Annotation[]
- currentClipIndex: number
- currentTeam: "A" | "B"
- confidence: number (1-5)
- selectedIntentA: string
- selectedIntentB: string
- isUncertain: boolean
- autoNext: boolean
- clipFilter: "all" | "todo" | "done"
- clipSearch: string
- isGenerating: boolean
- statusMessage: string
- loopClip: boolean
- playbackRate: number
- isMuted: boolean
- isPlaying: boolean
- videoProgress: number
- videoCurrentTime: number
- videoError: string
- isConverting: boolean
- isLoading: boolean

**Ref-based state** (for keyboard handler stability):
- clipsRef, currentTeamRef, annotationStartTimeRef

---

## Project File Structure

```
app/
  layout.tsx              # Root layout
  page.tsx                # Main page (composes AnnotatorClient)
  globals.css             # Global styles + Tailwind
  api/
    manifest/route.ts
    annotations/route.ts
    annotations/reset/route.ts
    pipeline/generate/route.ts
    videos/convert/route.ts
    export/json/route.ts
    export/csv/route.ts
    export/download/[filename]/route.ts
    videos/[...path]/route.ts
    raw-videos/[...path]/route.ts
components/
  AnnotatorClient.tsx     # Main client component (all state)
  Header.tsx              # Top bar
  ClipExplorer.tsx        # Left sidebar
  VideoPlayer.tsx         # Center video + controls
  IntentLabels.tsx        # 14-label grid
  AnnotationPanel.tsx     # Right panel
lib/
  constants.ts            # TACTIC_INTENTS, HOTKEY_MAP, types
  utils.ts                # formatTime, normalizeClip, etc.
  server-utils.ts         # fs helpers for API routes
public/
  (empty — videos served from API routes)
```

---

## Tailwind Configuration

Custom utilities needed:
- `.custom-scrollbar` — thin scrollbar with white/10 thumb
- `.selection:bg-indigo-500/30` — text selection color

No tailwind.config.js needed — use Tailwind v4 CSS-based config via `@theme`.
