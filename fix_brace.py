with open('src/components/AnnotatorClient.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# The issue: there's a dangling closing brace } from the removed `if (!skipped)` block
# Pattern: after validation.valid check, there's `}\n      }\n      try {`
# Should be: `}\n      try {`
old = (
    '        if (!validation.valid) {\n'
    '          setStatusMessage(validation.error || "Validation failed.");\n'
    '          return;\n'
    '        }\n'
    '      }\n'
    '      try {'
)
new = (
    '        if (!validation.valid) {\n'
    '          setStatusMessage(validation.error || "Validation failed.");\n'
    '          return;\n'
    '        }\n'
    '      try {'
)

if old in content:
    content = content.replace(old, new)
    print("Fixed dangling brace before try")
else:
    print("Pattern not found - checking content around validation...")
    # Find the validation.valid block
    idx = content.find('validation.valid')
    if idx > 0:
        print(content[idx:idx+300])

with open('src/components/AnnotatorClient.tsx', 'w', encoding='utf-8') as f:
    f.write(content)