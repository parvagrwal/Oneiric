"""Contrast check: reads the colour tokens from app/src/index.css and prints the WCAG 2.1 contrast ratio of every
text-on-surface pair the interface uses. Exits 1 if any pair is below 4.5:1.
Run from the repository root:  python3 app/scripts/contrast-check.py
"""
import re
import sys

css = open('app/src/index.css', encoding='utf-8').read()
tokens = dict(re.findall(r'--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})', css))


def luminance(hex_colour):
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def ratio(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


pairs = [(text, surface) for text in ('ink', 'dim', 'faint') for surface in ('void', 'base', 'panel', 'raised', 'hover')]
pairs += [(text, 'panel') for text in ('signal', 'sun', 'ridge', 'alert')]
pairs += [('void', verdict) for verdict in ('go', 'marginal', 'nogo')]

worst = 99.0
print(f"{'text':<10}{'on':<10}{'ratio':>7}")
for text, surface in pairs:
    value = ratio(tokens[text], tokens[surface])
    worst = min(worst, value)
    print(f"{text:<10}{surface:<10}{value:>7.2f}{'' if value >= 4.5 else '  BELOW 4.5'}")
print(f"pairs: {len(pairs)}, lowest ratio: {worst:.2f}, limit: 4.50")
sys.exit(0 if worst >= 4.5 else 1)
