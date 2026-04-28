#!/usr/bin/env python3
"""
Compare prod dep tree (pnpm ls --prod) against asar contents.
Reports any prod transitive packages that are missing from the bundled asar.
"""
import json
import os
import re
import sys

import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--prod-tree', default='prod_tree.json')
parser.add_argument('--asar-list', default='asar_list.txt')
args = parser.parse_args()
PROD_TREE = args.prod_tree
ASAR_LIST = args.asar_list

with open(PROD_TREE) as f:
    data = json.load(f)
if isinstance(data, list):
    data = data[0]

prod = set()
def walk(node):
    deps = node.get('dependencies', {}) or {}
    for name, info in deps.items():
        prod.add(name)
        if isinstance(info, dict):
            walk(info)
walk(data)

with open(ASAR_LIST) as f:
    asar_lines = f.read().splitlines()

asar_pkgs = set()
# Match \node_modules\@scope\name OR \node_modules\name (no further required)
pattern = re.compile(r'\\node_modules\\((?:@[^\\]+\\[^\\]+)|[^\\]+)')
for line in asar_lines:
    for m in pattern.finditer(line):
        seg = m.group(1).replace('\\', '/')
        asar_pkgs.add(seg)

print(f'Prod deps (transitive total): {len(prod)}')
print(f'Distinct packages in asar:    {len(asar_pkgs)}')

missing = sorted(prod - asar_pkgs)
print()
print(f'== MISSING from asar: {len(missing)} ==')
for m in missing:
    print(' -', m)

if missing:
    sys.exit(1)
