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

# Fix 3-4: Replace skipped-conditional expressions (two instances each)
# Instance 1 (in auto-split block) and Instance 2 (in standard submit block)
count = 0
def replace_skipped_confidence(m):
    global count
    count += 1
    return 'confidence: confidenceA,'

content = re.sub(r'confidence: skipped \? 0 : confidenceA,', replace_skipped_confidence, content)

count = 0
def replace_skipped_confidenceB(m):
    global count
    count += 1
    return 'confidence: confidenceB,'

content = re.sub(r'confidence: skipped \? 0 : confidenceB,', replace_skipped_confidenceB, content)

# Fix certainties
content = re.sub(r'certainty: skipped \? "low" : certaintyA,', 'certainty: certaintyA,', content)
content = re.sub(r'certainty: skipped \? "low" : certaintyB,', 'certainty: certaintyB,', content)

# Fix effectiveExclusion
content = content.replace(
    "const effectiveExclusion = skipped ? \"ContestedPlay\" : exclusion;",
    "const effectiveExclusion = exclusion;"
)

# Fix skipped shorthand property in agreement objects
# Match ", skipped\n" (the shorthand) and replace with ", skipped: false\n"
# There are two instances - one in auto-split templateAnn, one in standard ann
content = re.sub(r',\s*\n\s+skipped\b(?!\s*:)', ',\n              skipped: false', content)

# Fix saveAnnotationRef type
content = content.replace(
    "const saveAnnotationRef = useRef<(s: boolean) => void>(saveAnnotation);",
    "const saveAnnotationRef = useRef<() => void>(saveAnnotation);"
)

# Remove keyboard S skip handler
old_skip_key = '''      // Save / Skip
      if (key === "s") {
        e.preventDefault();
        saveAnnotationRef.current(true); // skip
        return;
      }
      if (key === "enter") {'''
new_enter_key = '''      // Submit
      if (key === "enter") {'''

content = content.replace(old_skip_key, new_enter_key)

# Fix saveAnnotationRef.current calls - change from (false) to ()
content = content.replace('saveAnnotationRef.current(false);', 'saveAnnotationRef.current();')
content = content.replace('saveAnnotationRef.current(true);', 'saveAnnotationRef.current();')

# Fix onSubmit={() => saveAnnotation(false)} calls (3 places)
content = content.replace('onSubmit={() => saveAnnotation(false)}', 'onSubmit={() => saveAnnotation()}')

# Fix onSkip prop passing in IntentLabels (remove onSkip)
# First remove from IntentLabels component call
content = content.replace(
    `            onIntentClick={handleIntentClick}
            onSubmit={() => saveAnnotation()}
            onSkip={() => saveAnnotation(true)}`,
    `            onIntentClick={handleIntentClick}
            onSubmit={() => saveAnnotation()}`
)

# Fix AnnotationPanel onSkip 
content = content.replace('          onSkip={() => saveAnnotation(true)}\n          onSubmit={() => saveAnnotation()}', '          onSubmit={() => saveAnnotation()}')

# Fix help modal - remove "S - Skip clip" from shortcuts
old_help = '''                  ["1–9, 0, Q, W, R, T", "Pick intent for active team"],
                  ["S", "Skip clip"],
                  ["Enter", "Submit / confirm mark → create segment"],'''
new_help = '''                  ["1–9, 0, Q, W, R, T", "Pick intent for active team"],
                  ["Enter", "Submit / confirm mark → create segment"],'''
content = content.replace(old_help, new_help)

with open('src/components/AnnotatorClient.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("All fixes applied successfully")