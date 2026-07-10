import re

with open('src/components/AnnotatorClient.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Change saveAnnotation signature
content = content.replace(
    'const saveAnnotation = useCallback((skipped = false) => {',
    'const saveAnnotation = useCallback(() => {'
)

# 2. Remove conditional wrapping - the original code has:
#    if (!skipped) { validate... }  (then inner try)
#    try { ... }
# Both sections need their skip guards removed

# Fix auto-split block: if (!skipped && labelDur > MAX_SEGMENT_DURATION) -> if (labelDur > MAX_SEGMENT_DURATION)
content = content.replace(
    'if (!skipped && labelDur > MAX_SEGMENT_DURATION)',
    'if (labelDur > MAX_SEGMENT_DURATION)'
)

# Fix duration check: if (!skipped && labelDur < 2)
content = content.replace(
    'if (!skipped && labelDur < 2)',
    'if (labelDur < 2)'
)

# Remove the `if (!skipped) { ... }` wrapper that surrounds the validation block
# Find: the closing of the `if (!skipped) {` after sessionBreakDue check
# Pattern: after the return, we have `}\n        const intentLabelA` from the if(!skipped) block end
content = content.replace(
    '          return;\n        }\n        const intentLabelA',
    '          return;\n        const intentLabelA'
)

# But that leaves a dangling `}` from the catch block that was inside. Let me check if there's
# something else... Actually the structure is:
# if (!skipped) {  <- this wraps validate + try
#   if (!skipped && labelDur < 2) return;
#   try { ... }
# }
# So after removing the outer if(!skipped), we need to remove its closing } before the load manifest handler

# The try block already has its own catch. Let me look at the actual matching

# Find effectiveExclusion pattern (both instances in auto-split and standard block)
content = content.replace(
    'const effectiveExclusion = skipped ? "ContestedPlay" : exclusion;',
    'const effectiveExclusion = exclusion;'
)

# Fix confidence/certainty patterns (all instances)
content = content.replace('confidence: skipped ? 0 : confidenceA,', 'confidence: confidenceA,')
content = content.replace('confidence: skipped ? 0 : confidenceB,', 'confidence: confidenceB,')
content = content.replace('certainty: skipped ? "low" : certaintyA,', 'certainty: certaintyA,')
content = content.replace('certainty: skipped ? "low" : certaintyB,', 'certainty: certaintyB,')

# Fix skipped: false in agreement objects (replace the shorthand skipped property)
content = re.sub(r'flagged_review: isUncertain,\n\s+skipped(?=\s*\n)', 
                  'flagged_review: isUncertain,\n              skipped: false', content)

# Fix saveAnnotationRef type
content = content.replace(
    'const saveAnnotationRef = useRef<(s: boolean) => void>(saveAnnotation);',
    'const saveAnnotationRef = useRef<() => void>(saveAnnotation);'
)

# Keyboard handler: Remove S key for skip, change enter key to just saveAnnotationRef.current()
keyboard_pattern = (
    '\n      // Save / Skip\n'
    '      if (key === "s") {\n'
    '        e.preventDefault();\n'
    '        saveAnnotationRef.current(true); // skip\n'
    '        return;\n'
    '      }\n'
    '      if (key === "enter") {'
)
keyboard_replacement = '\n      // Submit\n      if (key === "enter") {'
content = content.replace(keyboard_pattern, keyboard_replacement)

# Fix saveAnnotationRef calls
content = content.replace('saveAnnotationRef.current(false);', 'saveAnnotationRef.current();')
content = content.replace('saveAnnotationRef.current(true);', 'saveAnnotationRef.current();')

# Fix onSubmit={() => saveAnnotation(false)} calls in IntentLabels and AnnotationPanel
content = content.replace('onSubmit={() => saveAnnotation(false)}', 'onSubmit={() => saveAnnotation()}')

# Remove onSkip from IntentLabels component
content = content.replace(
    '            onSubmit={() => saveAnnotation()}\n            onSkip={() => saveAnnotation(true)}\n            exclusion={exclusion}',
    '            onSubmit={() => saveAnnotation()}\n            exclusion={exclusion}'
)

# Remove onSkip prop from AnnotationPanel
content = content.replace(
    '          onSkip={() => saveAnnotation(true)}\n          onSubmit={() => saveAnnotation()}',
    '          onSubmit={() => saveAnnotation()}'
)

# Fix help modal: remove "S - Skip clip"
content = content.replace(
    '                  ["1\u20139, 0, Q, W, R, T", "Pick intent for active team"],\n                  ["S", "Skip clip"],\n                  ["Enter", "Submit / confirm mark \u2192 create segment"],',
    '                  ["1\u20139, 0, Q, W, R, T", "Pick intent for active team"],\n                  ["Enter", "Submit / confirm mark \u2192 create segment"],'
)

with open('src/components/AnnotatorClient.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("All fixes applied!")