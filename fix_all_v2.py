# Fix various issues in AnnotatorClient.tsx
with open('src/components/AnnotatorClient.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: saveAnnotation signature  
content = content.replace(
    'const saveAnnotation = useCallback((skipped = false) => {',
    'const saveAnnotation = useCallback(() => {'
)

# Fix 2: Remove !skipped && from conditions  
content = content.replace('if (!skipped && labelDur < 2)', 'if (labelDur < 2)')
content = content.replace('if (!skipped && labelDur > MAX_SEGMENT_DURATION)', 'if (labelDur > MAX_SEGMENT_DURATION)')

# Fix 3: effectiveExclusion  
content = content.replace(
    'const effectiveExclusion = skipped ? "ContestedPlay" : exclusion;',
    'const effectiveExclusion = exclusion;'
)

# Fix 4: Remove outer if(!skipped) wrapping validation block
# The original structure is:
#   if (!skipped) {
#       validate...
#       try { ... }
#   }
# We removed the `if (!skipped) {` already, but need to remove its closing `}`
# Look for the orphan `}` right before `// Load manifest`
old = '\n      }\n\n  // --- Load manifest'
new = '\n\n  // --- Load manifest'
content = content.replace(old, new)

# Wait, the orphan `}` is the closing brace of the if(!skipped) block
# Actually looking at the code, the structure is more nuanced
# Let me check by looking at where the `}` should be
# The try block has its own catch block and closing - so the extra } 
# is the closing of the removed if(!skipped). It sits between the 
# try/catch block's closing and the Load manifest section.

# Alternative approach: count brace depth
# The issue is specifically line 2201 which is a lone `}`
# Let me just find and remove it by context

# Remove the orphan } between the validate block and try
old_validate = (
    '        if (!validation.valid) {\n'
    '          setStatusMessage(validation.error || "Validation failed.");\n'
    '          return;\n'
    '        }\n'
    '      }\n'
    '      try {'
)
new_validate = (
    '        if (!validation.valid) {\n'
    '          setStatusMessage(validation.error || "Validation failed.");\n'
    '          return;\n'
    '        }\n'
    '      try {'
)
content = content.replace(old_validate, new_validate)

# Fix confidence/certainty (all remaining instances)
content = content.replace('confidence: skipped ? 0 : confidenceA,', 'confidence: confidenceA,')
content = content.replace('confidence: skipped ? 0 : confidenceB,', 'confidence: confidenceB,')
content = content.replace('certainty: skipped ? "low" : certaintyA,', 'certainty: certaintyA,')
content = content.replace('certainty: skipped ? "low" : certaintyB,', 'certainty: certaintyB,')

# Fix skipped shorthand in agreement (2 occurrences)
import re
content = re.sub(r',\n\s+skipped\b(?!\s*:)', ',\n              skipped: false', content)

# Fix saveAnnotationRef type  
content = content.replace(
    'const saveAnnotationRef = useRef<(s: boolean) => void>(saveAnnotation);',
    'const saveAnnotationRef = useRef<() => void>(saveAnnotation);'
)

# Remove keyboard S handler and fix Enter
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

# Fix ref calls
content = content.replace('saveAnnotationRef.current(false);', 'saveAnnotationRef.current();')
content = content.replace('saveAnnotationRef.current(true);', 'saveAnnotationRef.current();')

# Fix onSubmit calls 
content = content.replace('onSubmit={() => saveAnnotation(false)}', 'onSubmit={() => saveAnnotation()}')

# Remove onSkip from IntentLabels
content = content.replace(
    '            onSubmit={() => saveAnnotation()}\n            onSkip={() => saveAnnotation(true)}\n            exclusion={exclusion}',
    '            onSubmit={() => saveAnnotation()}\n            exclusion={exclusion}'
)

# Remove onSkip from AnnotationPanel  
content = content.replace(
    '\n          onSkip={() => saveAnnotation(true)}\n          onSubmit={() => saveAnnotation()}',
    '\n          onSubmit={() => saveAnnotation()}'
)

# Fix help modal
content = content.replace(
    '                  ["1\u20139, 0, Q, W, R, T", "Pick intent for active team"],\n                  ["S", "Skip clip"],\n                  ["Enter", "Submit / confirm mark \u2192 create segment"],',
    '                  ["1\u20139, 0, Q, W, R, T", "Pick intent for active team"],\n                  ["Enter", "Submit / confirm mark \u2192 create segment"],'
)

with open('src/components/AnnotatorClient.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("All fixes applied successfully")