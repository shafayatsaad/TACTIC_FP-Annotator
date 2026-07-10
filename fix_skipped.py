import re

with open('src/components/AnnotatorClient.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Change saveAnnotation function signature
content = content.replace(
    'const saveAnnotation = useCallback((skipped = false) => {',
    'const saveAnnotation = useCallback(() => {'
)

# Fix 2: Remove !skipped && from conditions
content = content.replace('if (!skipped && labelDur < 2)', 'if (labelDur < 2)')
content = content.replace('if (!skipped && labelDur > MAX_SEGMENT_DURATION)', 'if (labelDur > MAX_SEGMENT_DURATION)')

# Fix 3: Replace effectiveExclusion with just exclusion
content = content.replace(
    'const effectiveExclusion = skipped ? "ContestedPlay" : exclusion;',
    'const effectiveExclusion = exclusion;'
)

# Fix 4: Replace skipped-conditioned confidence/certainty values (all occurrences)
content = re.sub(r'confidence: skipped \? 0 : confidenceA,', 'confidence: confidenceA,', content)
content = re.sub(r'confidence: skipped \? 0 : confidenceB,', 'confidence: confidenceB,', content)
content = re.sub(r'certainty: skipped \? "low" : certaintyA,', 'certainty: certaintyA,', content)
content = re.sub(r'certainty: skipped \? "low" : certaintyB,', 'certainty: certaintyB,', content)

# Fix 5: Fix skipped shorthand property (",\n      skipped\n" pattern in objects)
content = re.sub(r',\s*\n\s+skipped\b(?!\s*:)', ',\n              skipped: false', content)

# Fix 6: Fix saveAnnotationRef type
content = content.replace(
    'const saveAnnotationRef = useRef<(s: boolean) => void>(saveAnnotation);',
    'const saveAnnotationRef = useRef<() => void>(saveAnnotation);'
)

# Fix 7: Remove keyboard S skip handler and change enter handler
content = content.replace(
    '      // Save / Skip\n      if (key === "s") {\n        e.preventDefault();\n        saveAnnotationRef.current(true); // skip\n        return;\n      }\n      if (key === "enter") {',
    '      // Submit\n      if (key === "enter") {'
)

# Fix 8: Fix saveAnnotationRef.current calls
content = content.replace('saveAnnotationRef.current(false);', 'saveAnnotationRef.current();')
content = content.replace('saveAnnotationRef.current(true);', 'saveAnnotationRef.current();')

# Fix 9: Fix onSubmit calls
content = content.replace('onSubmit={() => saveAnnotation(false)}', 'onSubmit={() => saveAnnotation()}')

# Fix 10: Remove onSkip from IntentLabels prop
content = content.replace(
    '            onSubmit={() => saveAnnotation()}\n            onSkip={() => saveAnnotation(true)}\n            exclusion={exclusion}',
    '            onSubmit={() => saveAnnotation()}\n            exclusion={exclusion}'
)

# Fix 11: Remove onSkip from AnnotationPanel prop
content = content.replace(
    '          onSkip={() => saveAnnotation(true)}\n          onSubmit={() => saveAnnotation()}',
    '          onSubmit={() => saveAnnotation()}'
)

# Fix 12: Remove "S - Skip clip" from help modal
content = content.replace(
    '                  ["1-9, 0, Q, W, R, T", "Pick intent for active team"],\n                  ["S", "Skip clip"],\n                  ["Enter", "Submit / confirm mark create segment"],',
    '                  ["1-9, 0, Q, W, R, T", "Pick intent for active team"],\n                  ["Enter", "Submit / confirm mark create segment"],'
)

with open('src/components/AnnotatorClient.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("All fixes applied successfully")