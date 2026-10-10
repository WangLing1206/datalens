"""Scan src/ for hardcoded English UI copy that never goes through t()."""

import io
import os
import re

LITERAL = re.compile(r"'([A-Za-z][A-Za-z0-9 ,.'’\-–—/%×²()\[\]]{6,60})'")
NOISE = (
    'className', 'import ', 'from ', 'require(', 'style', 'font-', 'grid-cols', 'flex ',
    'text-[', 'bg-', 'border-', 'rounded', 'px-', 'py-', 'mt-', 'mb-', 'gap-',
)


def main() -> None:
    seen = set()
    total = 0
    for root, _dirs, files in os.walk('src'):
        for name in files:
            if not (name.endswith('.tsx') or name.endswith('.ts')):
                continue
            path = os.path.join(root, name)
            rel = path.replace(os.sep, '/')
            if '/i18n/' in rel:
                continue
            for lineno, line in enumerate(io.open(path, encoding='utf-8'), 1):
                if any(n in line for n in NOISE):
                    continue
                for match in LITERAL.finditer(line):
                    text = match.group(1)
                    if ' ' not in text or text in seen:
                        continue
                    seen.add(text)
                    total += 1
                    print(f'{rel}:{lineno}: {text!r}')
    print('total unique:', total)


if __name__ == '__main__':
    main()
