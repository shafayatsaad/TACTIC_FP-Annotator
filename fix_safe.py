# Only make safe string replacements that don't affect brace structure
with open('src/components/AnnotatorClient.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. saveAnnotation signature - remove parameter (safe, no brace change)
content = content.replace(
    'const saveAnnotation = useCallback((skipped = false) => {',
    'const saveAnnotation = useCallback(() => {'
)

# 2. Remove !skipped && from conditions (since !undefined is true, code works same)
content = content.replace('if (!skipped && labelDur < 2)', 'if (labelDur < 2)')
content = content.replace('if (!skipped && labelDur > MAX_SEGMENT_DURATION)', 'if (labelDur > MAX_SEGMENT_DURATION)')

# 3. effectiveExclusion: skipped ? "ContestedPlay" : exclusion -> exclusion
content = content.replace(
    'const effectiveExclusion = skipped ? "ContestedPlay" : exclusion;',
    'const effectiveExclusion = exclusion;'
)

# 4. confidence/certainty ternaries (4 patterns each, safe)
content = content.replace('confidence: skipped ? 0 : confidenceA,', 'confidence: confidenceA,')
content = content.replace('confidence: skipped ? 0 : confidenceB,', 'confidence: confidenceB,')
content = content.replace('certainty: skipped ? "low" : certaintyA,', 'certainty: certaintyA,')
content = content.replace('certainty: skipped ? "low" : certaintyB,', 'certainty: certaintyB,')

# 5. skipped shorthand -> skipped: false (in agreement objects)
import re
content = re.sub(r',\n\s+skipped\b(?!\s*:)', ',\n              skipped: false', content)

# 6. saveAnnotationRef type
content = content.replace(
    'const saveAnnotationRef = useRef<(s: boolean) => void>(saveAnnotation);',
    'const saveAnnotationRef = useRef<() => void>(saveAnnotation);'
)

# 7. Remove keyboard S handler and fix Enter (safe)
old_key = '''      // Save / Skip
      if (key === "s") {
        e.preventDefault();
        saveAnnotationRef.current(true); // skip
        return;
      }
      if (key === "enter") {'''
new_key = '''      // Submit
      if (key === "enter") {'''
content = content.replace(old_key, new_key)

# 8. Fix ref calls
content = content.replace('saveAnnotationRef.current(false);', 'saveAnnotationRef.current();')
content = content.replace('saveAnnotationRef.current(true);', 'saveAnnotationRef.current();')

# 9. Fix onSubmit calls
content = content.replace('onSubmit={() => saveAnnotation(false)}', 'onSubmit={() => saveAnnotation()}')

# 10. Remove onSkip from IntentLabels
content = content.replace(
    '            onSubmit={() => saveAnnotation()}\n            onSkip={() => saveAnnotation(true)}\n            exclusion={exclusion}',
    '            onSubmit={() => saveAnnotation()}\n            exclusion={exclusion}'
)

# 11. Remove onSkip from AnnotationPanel
content = content.replace(
    '\n          onSkip={() => saveAnnotation(true)}\n          onSubmit={() => saveAnnotation()}',
    '\n          onSubmit={() => saveAnnotation()}'
)

# 12. Fix help modal - remove "S - Skip clip"
content = content.replace(
    '                  ["1\u20139, 0, Q, W, R, T", "Pick intent for active team"],\n                  ["S", "Skip clip"],\n                  ["Enter", "Submit / confirm mark \u2192 create segment"],',
    '                  ["1\u20139, 0, Q, W, R, T", "Pick intent for active team"],\n                  ["Enter", "Submit / confirm mark \u2192 create segment"],'
)

with open('src/components/AnnotatorClient.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("All safe fixes applied!")