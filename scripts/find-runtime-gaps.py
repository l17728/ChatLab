#!/usr/bin/env python3
"""
For each package missing from asar, show its top-level prod dep parent(s).
Filters out renderer-only / build-only roots — what remains is likely a real
runtime gap that will crash main-process code.
"""
import json
import re
import sys

with open('prod_tree.json') as f:
    data = json.load(f)
if isinstance(data, list):
    data = data[0]

# Roots that are renderer-side or build-only — anything pulled in ONLY by
# these is safe to ignore (Vite bundles renderer; build tools don't ship).
RENDERER_OR_BUILD_ROOTS = {
    'vue', '@vue/compiler-sfc', '@vue/runtime-dom', 'pinia', 'vue-router',
    'vue-i18n', '@nuxt/ui', '@vueuse/core', 'tailwindcss',
    'electron', 'electron-vite', 'vite',
    '@electron-toolkit/preload', '@electron-toolkit/utils',
    'electron-builder', '@electron/get', 'extract-zip',
    'typescript', 'vue-tsc',
}

# Renderer-bundled or types-only packages we should NEVER ship as prod dep
SKIP = {
    'electron', 'typescript', 'vue', 'csstype', 'postcss', 'magic-string',
    'estree-walker', '@jridgewell/sourcemap-codec', 'picocolors',
    'source-map', 'nanoid', 'undici-types',
}
SKIP_PREFIXES = ('@vue/', '@types/', '@babel/', '@node-rs/jieba-')

with open('asar_list.txt') as f:
    asar_lines = f.read().splitlines()

asar_pkgs = set()
pattern = re.compile(r'\\node_modules\\((?:@[^\\]+\\[^\\]+)|[^\\]+)')
for line in asar_lines:
    for m in pattern.finditer(line):
        asar_pkgs.add(m.group(1).replace('\\', '/'))

# Build reverse map: each pkg -> set of top-level prod roots that pull it in
parents = {}
def walk(node, root_name):
    deps = node.get('dependencies', {}) or {}
    for name, info in deps.items():
        parents.setdefault(name, set()).add(root_name)
        if isinstance(info, dict):
            walk(info, root_name)

# Top-level prod deps from the root
top_deps = data.get('dependencies', {}) or {}
for name, info in top_deps.items():
    if isinstance(info, dict):
        walk(info, name)
    parents.setdefault(name, set()).add(name)

all_prod = set(parents.keys())
missing = sorted(all_prod - asar_pkgs)

def should_skip(p):
    if p in SKIP:
        return True
    for pref in SKIP_PREFIXES:
        if p.startswith(pref):
            return True
    return False

real_gaps = []
for p in missing:
    if should_skip(p):
        continue
    pulls = parents.get(p, set())
    # If ALL parents are renderer/build only, also skip
    runtime_parents = pulls - RENDERER_OR_BUILD_ROOTS
    if not runtime_parents:
        continue
    real_gaps.append((p, sorted(runtime_parents)))

print(f'== Runtime gaps (pkg + which prod root pulls it in) ==')
print(f'Total: {len(real_gaps)}')
print()
for p, roots in real_gaps:
    print(f'  {p}')
    print(f'    pulled by: {", ".join(roots)}')
print()
print('-- pnpm add command --')
print('pnpm add ' + ' '.join(p for p, _ in real_gaps))
